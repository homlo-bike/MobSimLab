import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import { type MslRequest, SessionService } from "../auth/session.service";
import { Requires } from "../iam/requires";
import { type ProjectActor, ProjectsService } from "./projects.service";

/** Modes a project can plan for (assumptions/parameters/modes.yaml plus the street modes). */
export const PROJECT_MODES = [
  "bus",
  "brt",
  "trolleybus",
  "intercity_bus",
  "tram",
  "light_rail",
  "metro",
  "commuter_rail",
  "regional_rail",
  "intercity_rail",
  "high_speed_rail",
] as const;

const uuid = z.uuid();
const name = z.string().trim().min(1, "a project needs a name").max(200);
const description = z.string().trim().max(2000);
const areaName = z.string().trim().max(200).nullable();
const modes = z
  .array(z.enum(PROJECT_MODES))
  .max(20)
  .transform((m) => [...new Set(m)]);
const memberRole = z.enum(["editor", "commenter", "viewer"]);

const listQuery = z.strictObject({ archived: z.enum(["true", "false"]).optional() });
const createBody = z.strictObject({
  name,
  description: description.optional(),
  areaName: areaName.optional(),
  modes: modes.optional(),
});
const updateBody = z
  .strictObject({
    name: name.optional(),
    description: description.optional(),
    areaName: areaName.optional(),
    modes: modes.optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "nothing to change");
const duplicateBody = z.strictObject({ name: name.optional() });
const deleteBody = z.strictObject({ confirmName: z.string().max(200) });
const addMemberBody = z.strictObject({ email: z.email().max(320), role: memberRole });
const roleBody = z.strictObject({ role: memberRole });
const linkBody = z.strictObject({ linkAccess: z.boolean() });

/** Purpose: parse input with a zod schema; 400 with the issue messages on failure. */
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value ?? {});
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message));
  return r.data;
}

/**
 * Projects API for the projects home and the project header: list, create, rename, duplicate, archive, delete,
 * and manage access. Project roles are checked in ProjectsService; instance roles by the global guard.
 */
@Controller("api/projects")
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly sessions: SessionService,
  ) {}

  private actor(req: MslRequest): ProjectActor {
    const s = req.session;
    if (!s) throw new ForbiddenException();
    return {
      userId: s.actor.userId,
      role: s.actor.role,
      ipHash: this.sessions.ipHash(req.ip),
      requestId: req.requestId ?? null,
    };
  }

  /** Purpose: the caller's projects. Query: `archived=true` lists archived projects instead. */
  @Get()
  @Requires("projects.read")
  async list(@Query() query: unknown, @Req() req: MslRequest) {
    const q = parse(listQuery, query);
    return { projects: await this.projects.list(this.actor(req), q.archived === "true") };
  }

  /** Purpose: create a project. Body: `{ name, description?, areaName?, modes? }`. */
  @Post()
  @Requires("projects.create")
  async create(@Body() body: unknown, @Req() req: MslRequest) {
    return { project: await this.projects.create(this.actor(req), parse(createBody, body)) };
  }

  /** Purpose: one project. */
  @Get(":id")
  @Requires("projects.read")
  async get(@Param("id") id: string, @Req() req: MslRequest) {
    return { project: await this.projects.get(this.actor(req), parse(uuid, id)) };
  }

  /** Purpose: rename or change details. Body: `{ name?, description?, areaName?, modes? }`. */
  @Patch(":id")
  @Requires("projects.read")
  async update(@Param("id") id: string, @Body() body: unknown, @Req() req: MslRequest) {
    return { project: await this.projects.update(this.actor(req), parse(uuid, id), parse(updateBody, body)) };
  }

  /** Purpose: copy into a new project the caller owns. Body: `{ name? }`. */
  @Post(":id/duplicate")
  @Requires("projects.create")
  async duplicate(@Param("id") id: string, @Body() body: unknown, @Req() req: MslRequest) {
    const { name: n } = parse(duplicateBody, body);
    return { project: await this.projects.duplicate(this.actor(req), parse(uuid, id), n) };
  }

  /** Purpose: archive a project for everyone. */
  @Post(":id/archive")
  @HttpCode(200)
  @Requires("projects.read")
  async archive(@Param("id") id: string, @Req() req: MslRequest) {
    return { project: await this.projects.setArchived(this.actor(req), parse(uuid, id), true) };
  }

  /** Purpose: bring an archived project back. */
  @Post(":id/unarchive")
  @HttpCode(200)
  @Requires("projects.read")
  async unarchive(@Param("id") id: string, @Req() req: MslRequest) {
    return { project: await this.projects.setArchived(this.actor(req), parse(uuid, id), false) };
  }

  /** Purpose: move to the bin. Body: `{ confirmName }`, the project name typed by the person. */
  @Delete(":id")
  @Requires("projects.read")
  async remove(@Param("id") id: string, @Body() body: unknown, @Req() req: MslRequest) {
    await this.projects.remove(this.actor(req), parse(uuid, id), parse(deleteBody, body).confirmName);
    return { ok: true };
  }

  /** Purpose: people with access. */
  @Get(":id/members")
  @Requires("projects.read")
  async members(@Param("id") id: string, @Req() req: MslRequest) {
    return { members: await this.projects.members(this.actor(req), parse(uuid, id)) };
  }

  /** Purpose: give someone access. Body: `{ email, role }`. */
  @Post(":id/members")
  @Requires("projects.read")
  async addMember(@Param("id") id: string, @Body() body: unknown, @Req() req: MslRequest) {
    const b = parse(addMemberBody, body);
    return { members: await this.projects.addMember(this.actor(req), parse(uuid, id), b.email, b.role) };
  }

  /** Purpose: change someone's role. Body: `{ role }`. */
  @Put(":id/members/:userId")
  @Requires("projects.read")
  async setRole(
    @Param("id") id: string,
    @Param("userId") userId: string,
    @Body() body: unknown,
    @Req() req: MslRequest,
  ) {
    const { role } = parse(roleBody, body);
    return {
      members: await this.projects.setMemberRole(this.actor(req), parse(uuid, id), parse(uuid, userId), role),
    };
  }

  /** Purpose: remove someone's access, or leave the project (own user id). */
  @Delete(":id/members/:userId")
  @Requires("projects.read")
  async removeMember(@Param("id") id: string, @Param("userId") userId: string, @Req() req: MslRequest) {
    await this.projects.removeMember(this.actor(req), parse(uuid, id), parse(uuid, userId));
    return { ok: true };
  }

  /** Purpose: switch the view-only link on or off. Body: `{ linkAccess }`. */
  @Put(":id/link")
  @Requires("projects.read")
  async setLink(@Param("id") id: string, @Body() body: unknown, @Req() req: MslRequest) {
    const { linkAccess } = parse(linkBody, body);
    return { project: await this.projects.setLinkAccess(this.actor(req), parse(uuid, id), linkAccess) };
  }
}
