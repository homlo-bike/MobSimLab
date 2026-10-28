import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { sql } from "kysely";
import { AuditService } from "../audit/audit.service";
import { DATABASE, type Database, type InstanceRole } from "../db/database";
import { mayManage } from "../iam/roles";

/** Who is acting, for permission checks and the audit log. */
export interface AdminActor {
  userId: string;
  role: InstanceRole;
  ipHash: string | null;
  requestId: string | null;
}

/** One row of the user list (05 §4: admins see last login and IdP groups). */
export interface UserRow {
  id: string;
  email: string | null;
  displayName: string | null;
  role: InstanceRole;
  status: "pending" | "active" | "deleted";
  roleOverride: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
  identities: { issuer: string; groups: string[] }[];
}

type UserStatus = UserRow["status"];

/**
 * User administration (05 §4): list, approve, change role (including restrict and restore), pin a role
 * against group mappings, and delete (pseudonymise). Every change is audited. Mutations lock the instance
 * row so concurrent changes cannot remove the last Owner.
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /**
   * Purpose: list users, pending first, then by creation.
   * Inputs: optional status filter (deleted users only when asked for) and a search text matched against
   * e-mail and display name. Output: up to 500 rows.
   */
  async list(filter: { status?: UserStatus; q?: string }): Promise<UserRow[]> {
    let query = this.db
      .selectFrom("iam.user as u")
      .select([
        "u.id",
        "u.email",
        "u.display_name as displayName",
        "u.instance_role as role",
        "u.status",
        "u.role_override as roleOverride",
        "u.created_at as createdAt",
        "u.last_login_at as lastLoginAt",
        sql<UserRow["identities"]>`coalesce((
          SELECT json_agg(json_build_object('issuer', i.issuer, 'groups', i.groups) ORDER BY i.issuer)
          FROM iam.identity i WHERE i.user_id = u.id), '[]')`.as("identities"),
      ]);
    query = filter.status
      ? query.where("u.status", "=", filter.status)
      : query.where("u.status", "<>", "deleted");
    if (filter.q) {
      const pattern = `%${filter.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      query = query.where((eb) =>
        eb.or([eb("u.email", "ilike", pattern), eb("u.display_name", "ilike", pattern)]),
      );
    }
    return query
      .orderBy(sql`u.status = 'pending'`, "desc")
      .orderBy("u.created_at")
      .limit(500)
      .execute();
  }

  /**
   * Purpose: let a pending user in.
   * Inputs: actor, user id, optional role (default: the role proposed at registration).
   * Side effects: status active; audit `user.approved`.
   */
  async approve(actor: AdminActor, id: string, role?: InstanceRole): Promise<void> {
    await this.mutate(actor, id, async (tx, u) => {
      if (u.status !== "pending") throw new ConflictException("user is not waiting for approval");
      const next = role ?? u.instance_role;
      if (!mayManage(actor.role, u.instance_role, next)) throw new ForbiddenException();
      await tx
        .updateTable("iam.user")
        .set({ status: "active", instance_role: next, role_override: role !== undefined })
        .where("id", "=", id)
        .execute();
      return {
        action: "user.approved",
        before: { status: "pending", instance_role: u.instance_role },
        after: { status: "active", instance_role: next },
      };
    });
  }

  /**
   * Purpose: change an active user's role and/or whether it is pinned against group mappings.
   * Inputs: actor, user id, new role and/or override flag. Setting a role pins it unless `roleOverride`
   * is given as false. Restrict = role "restricted"; restore = any other role.
   * Side effects: updates the user; audit `user.role_changed`. Refuses to remove the last Owner.
   */
  async update(
    actor: AdminActor,
    id: string,
    change: { role?: InstanceRole; roleOverride?: boolean },
  ): Promise<void> {
    await this.mutate(actor, id, async (tx, u) => {
      if (u.status !== "active") throw new ConflictException("only active users can be changed");
      const role = change.role ?? u.instance_role;
      const override = change.roleOverride ?? (change.role !== undefined ? true : u.role_override);
      if (!mayManage(actor.role, u.instance_role, role)) throw new ForbiddenException();
      if (u.instance_role === "owner" && role !== "owner") await this.assertAnotherOwner(tx, id);
      await tx
        .updateTable("iam.user")
        .set({ instance_role: role, role_override: override })
        .where("id", "=", id)
        .execute();
      return {
        action: "user.role_changed",
        before: { instance_role: u.instance_role, role_override: u.role_override },
        after: { instance_role: role, role_override: override },
      };
    });
  }

  /**
   * Purpose: delete a user, or reject a pending one. Personal data (e-mail, name, groups) is removed;
   * the row and the (issuer, subject) pair stay so audit records keep their actor and the account cannot
   * silently sign up again.
   * Side effects: ends all sessions; audit `user.deleted`.
   */
  async remove(actor: AdminActor, id: string, reason: string | null): Promise<void> {
    await this.mutate(
      actor,
      id,
      async (tx, u) => {
        if (u.status === "deleted") throw new ConflictException("user is already deleted");
        if (!mayManage(actor.role, u.instance_role)) throw new ForbiddenException();
        if (u.instance_role === "owner") await this.assertAnotherOwner(tx, id);
        const now = new Date();
        await tx
          .updateTable("iam.user")
          .set({ status: "deleted", email: null, display_name: null, role_override: false, deleted_at: now })
          .where("id", "=", id)
          .execute();
        await tx
          .updateTable("iam.identity")
          .set({ email: null, groups: "[]" })
          .where("user_id", "=", id)
          .execute();
        await tx
          .updateTable("iam.session")
          .set({ revoked_at: now })
          .where("user_id", "=", id)
          .where("revoked_at", "is", null)
          .execute();
        return {
          action: "user.deleted",
          before: { status: u.status, instance_role: u.instance_role },
          after: { status: "deleted" },
        };
      },
      reason,
    );
  }

  /** Purpose: shared frame for a change: lock, load, refuse self-changes, apply, audit. */
  private async mutate(
    actor: AdminActor,
    id: string,
    apply: (
      tx: Database,
      u: { instance_role: InstanceRole; status: UserStatus; role_override: boolean },
    ) => Promise<{ action: string; before: unknown; after: unknown }>,
    reason: string | null = null,
  ): Promise<void> {
    if (id === actor.userId) throw new ConflictException("you cannot change your own account here");
    await this.db.transaction().execute(async (tx) => {
      await tx.selectFrom("iam.instance").select("id").forUpdate().execute();
      const u = await tx
        .selectFrom("iam.user")
        .select(["instance_role", "status", "role_override"])
        .where("id", "=", id)
        .executeTakeFirst();
      if (!u) throw new NotFoundException();
      const entry = await apply(tx, u);
      await this.audit.append(
        {
          ...entry,
          objectType: "user",
          objectId: id,
          actorId: actor.userId,
          actorIpHash: actor.ipHash,
          requestId: actor.requestId,
          reason,
        },
        tx,
      );
    });
  }

  private async assertAnotherOwner(tx: Database, exceptId: string): Promise<void> {
    const other = await tx
      .selectFrom("iam.user")
      .select("id")
      .where("instance_role", "=", "owner")
      .where("status", "=", "active")
      .where("id", "<>", exceptId)
      .executeTakeFirst();
    if (!other) throw new ConflictException("at least one Owner must remain");
  }
}
