import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import { AuditService } from "../audit/audit.service";
import { type MslRequest, SessionService } from "../auth/session.service";
import { DATABASE, type Database, INSTANCE_ROLES, MAPPABLE_ROLES } from "../db/database";
import { Requires } from "../iam/requires";
import { mayManage } from "../iam/roles";
import { type AdminActor, UsersService } from "./users.service";

const uuid = z.uuid();
const listQuery = z.strictObject({
  status: z.enum(["pending", "active", "deleted"]).optional(),
  q: z.string().trim().max(200).optional(),
});
const approveBody = z.strictObject({ role: z.enum(INSTANCE_ROLES).optional() });
const updateBody = z
  .strictObject({ role: z.enum(INSTANCE_ROLES).optional(), roleOverride: z.boolean().optional() })
  .refine((b) => b.role !== undefined || b.roleOverride !== undefined, "nothing to change");
const deleteBody = z.strictObject({ reason: z.string().trim().max(500).optional() });
const domain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, "not a domain name");
const registrationBody = z.strictObject({
  autoRegistration: z.boolean(),
  defaultRole: z.enum(["user", "viewer"]),
  allowedEmailDomains: z.array(domain).max(100),
  allowedGroups: z.array(z.string().trim().min(1).max(200)).max(100),
});
const mappingBody = z.strictObject({
  group: z.string().trim().min(1).max(200),
  role: z.enum(MAPPABLE_ROLES),
  issuer: z
    .url({ protocol: /^https?$/ })
    .nullable()
    .optional(),
});
const auditQuery = z.strictObject({
  before: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Purpose: parse input with a zod schema; 400 with the issue messages on failure. */
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value ?? {});
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message));
  return r.data;
}

/**
 * Administration API (05 §3.2, §4): users, sign-up rules, group mappings and the audit log.
 * Owners and Admins only; only an Owner may create, change or remove Owners and Admins.
 */
@Controller("api/admin")
export class AdminController {
  constructor(
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  private actor(req: MslRequest): AdminActor {
    const s = req.session;
    if (!s) throw new ForbiddenException();
    return {
      userId: s.actor.userId,
      role: s.actor.role,
      ipHash: this.sessions.ipHash(req.ip),
      requestId: req.requestId ?? null,
    };
  }

  /** Purpose: list users. Query: `status` (pending, active, deleted), `q` (search text). */
  @Get("users")
  @Requires("users.manage")
  async listUsers(@Query() query: unknown) {
    return { users: await this.users.list(parse(listQuery, query)) };
  }

  /** Purpose: approve a pending user. Body: `{ role? }`. */
  @Post("users/:id/approve")
  @HttpCode(200)
  @Requires("users.manage")
  async approve(@Param("id") id: string, @Body() body: unknown, @Req() req: MslRequest) {
    await this.users.approve(this.actor(req), parse(uuid, id), parse(approveBody, body).role);
    return { ok: true };
  }

  /** Purpose: change role and/or pin. Body: `{ role?, roleOverride? }`. */
  @Patch("users/:id")
  @Requires("users.manage")
  async update(@Param("id") id: string, @Body() body: unknown, @Req() req: MslRequest) {
    await this.users.update(this.actor(req), parse(uuid, id), parse(updateBody, body));
    return { ok: true };
  }

  /** Purpose: delete a user or reject a pending one. Body: `{ reason? }`. */
  @Delete("users/:id")
  @Requires("users.manage")
  async remove(@Param("id") id: string, @Body() body: unknown, @Req() req: MslRequest) {
    await this.users.remove(this.actor(req), parse(uuid, id), parse(deleteBody, body).reason ?? null);
    return { ok: true };
  }

  /** Purpose: auto-registration rules. */
  @Get("registration")
  @Requires("users.manage")
  async registration() {
    const i = await this.db
      .selectFrom("iam.instance")
      .select(["auto_registration", "default_role", "allowed_email_domains", "allowed_groups"])
      .executeTakeFirstOrThrow();
    return {
      autoRegistration: i.auto_registration,
      defaultRole: i.default_role,
      allowedEmailDomains: i.allowed_email_domains,
      allowedGroups: i.allowed_groups,
    };
  }

  /** Purpose: set the auto-registration rules. Body: all four fields of `GET registration`. */
  @Put("registration")
  @Requires("users.manage")
  async setRegistration(@Body() body: unknown, @Req() req: MslRequest) {
    const b = parse(registrationBody, body);
    const after = {
      auto_registration: b.autoRegistration,
      default_role: b.defaultRole,
      allowed_email_domains: [...new Set(b.allowedEmailDomains)],
      allowed_groups: [...new Set(b.allowedGroups)],
    };
    const a = this.actor(req);
    await this.db.transaction().execute(async (tx) => {
      const before = await tx
        .selectFrom("iam.instance")
        .select(["auto_registration", "default_role", "allowed_email_domains", "allowed_groups"])
        .forUpdate()
        .executeTakeFirstOrThrow();
      await tx
        .updateTable("iam.instance")
        .set({ ...after, updated_at: new Date() })
        .execute();
      await this.audit.append(
        {
          action: "instance.registration_updated",
          objectType: "instance",
          actorId: a.userId,
          actorIpHash: a.ipHash,
          requestId: a.requestId,
          before,
          after,
        },
        tx,
      );
    });
    return this.registration();
  }

  /** Purpose: list group mappings. */
  @Get("group-mappings")
  @Requires("users.manage")
  async mappings() {
    const rows = await this.db
      .selectFrom("iam.group_mapping")
      .select(["id", "issuer", "group_value as group", "instance_role as role"])
      .orderBy("group_value")
      .execute();
    return { mappings: rows };
  }

  /** Purpose: add a mapping. Body: `{ group, role, issuer? }`. Only an Owner may map a group to Admin. */
  @Post("group-mappings")
  @Requires("users.manage")
  async addMapping(@Body() body: unknown, @Req() req: MslRequest) {
    const b = parse(mappingBody, body);
    const a = this.actor(req);
    if (!mayManage(a.role, "viewer", b.role)) throw new ForbiddenException();
    return this.db.transaction().execute(async (tx) => {
      const row = await tx
        .insertInto("iam.group_mapping")
        .values({ group_value: b.group, instance_role: b.role, issuer: b.issuer ?? null })
        .onConflict((oc) => oc.doNothing())
        .returning("id")
        .executeTakeFirst();
      if (!row) throw new ConflictException("this group is already mapped");
      await this.audit.append(
        {
          action: "group_mapping.created",
          objectType: "group_mapping",
          objectId: row.id,
          actorId: a.userId,
          actorIpHash: a.ipHash,
          requestId: a.requestId,
          after: { group: b.group, role: b.role, issuer: b.issuer ?? null },
        },
        tx,
      );
      return { id: row.id };
    });
  }

  /** Purpose: remove a mapping. Users keep their current role until their next sign-in. */
  @Delete("group-mappings/:id")
  @Requires("users.manage")
  async removeMapping(@Param("id") id: string, @Req() req: MslRequest) {
    const a = this.actor(req);
    const key = parse(uuid, id);
    await this.db.transaction().execute(async (tx) => {
      const m = await tx
        .selectFrom("iam.group_mapping")
        .selectAll()
        .where("id", "=", key)
        .forUpdate()
        .executeTakeFirst();
      if (!m) throw new NotFoundException();
      if (!mayManage(a.role, m.instance_role)) throw new ForbiddenException();
      await tx.deleteFrom("iam.group_mapping").where("id", "=", key).execute();
      await this.audit.append(
        {
          action: "group_mapping.deleted",
          objectType: "group_mapping",
          objectId: key,
          actorId: a.userId,
          actorIpHash: a.ipHash,
          requestId: a.requestId,
          before: { group: m.group_value, role: m.instance_role, issuer: m.issuer },
        },
        tx,
      );
    });
    return { ok: true };
  }

  /**
   * Purpose: page through the instance audit chain, newest first, and verify the chain.
   * Query: `before` (sequence number), `limit` (max 200). Output: records and `brokenAt` (null if intact).
   */
  @Get("audit")
  @Requires("audit.read")
  async auditLog(@Query() query: unknown) {
    const q = parse(auditQuery, query);
    let sel = this.db
      .selectFrom("audit.record as r")
      .leftJoin("iam.user as u", "u.id", "r.actor_id")
      .select([
        "r.seq",
        "r.at",
        "r.actor_id as actorId",
        "u.email as actorEmail",
        "r.action",
        "r.object_type as objectType",
        "r.object_id as objectId",
        "r.before",
        "r.after",
        "r.reason",
      ])
      .where("r.chain", "=", "instance");
    if (q.before) sel = sel.where("r.seq", "<", String(q.before));
    const records = await sel.orderBy("r.seq", "desc").limit(q.limit).execute();
    return { records, brokenAt: await this.audit.verify() };
  }
}
