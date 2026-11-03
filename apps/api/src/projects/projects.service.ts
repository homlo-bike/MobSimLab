import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { sql } from "kysely";
import { AuditService, projectChain } from "../audit/audit.service";
import { DATABASE, type Database, type InstanceRole, type ProjectRole } from "../db/database";

/** Who is acting, with what they need for the audit record. */
export interface ProjectActor {
  userId: string;
  role: InstanceRole;
  ipHash: string | null;
  requestId: string | null;
}

/** One project as the projects home and the project header see it. */
export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  areaName: string | null;
  modes: string[];
  /** The caller's effective role: project role capped by the instance role (05 §3.2). */
  myRole: ProjectRole;
  /** True when the caller reaches the project only through its view-only link. */
  viaLink: boolean;
  owner: { id: string; displayName: string | null };
  memberCount: number;
  linkAccess: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

/** One person with access, for the share dialog. */
export interface ProjectMember {
  userId: string;
  displayName: string | null;
  email: string | null;
  role: ProjectRole;
}

/** What each project role may do. Owners manage access, archive and delete. */
type ProjectAction = "read" | "edit" | "manage";
const ALLOWED: Record<ProjectAction, readonly ProjectRole[]> = {
  read: ["owner", "editor", "commenter", "viewer"],
  edit: ["owner", "editor"],
  manage: ["owner"],
};

/**
 * Purpose: effective project role, the intersection of the instance role ceiling and the project role (05 §3.2).
 * An instance Viewer stays read-only on any project; a Restricted user has no project access.
 */
export function effectiveRole(instance: InstanceRole, project: ProjectRole): ProjectRole | null {
  if (instance === "restricted") return null;
  if (instance === "viewer") return "viewer";
  return project;
}

/** Purpose: whether a project role allows an action. */
export function allows(role: ProjectRole | null, action: ProjectAction): boolean {
  return role !== null && ALLOWED[action].includes(role);
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Projects, their memberships and the actions on the projects home (rename, share, duplicate, archive, delete). */
@Injectable()
export class ProjectsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /**
   * Purpose: the projects the caller is a member of, newest change first.
   * Inputs: actor; `archived` selects archived projects instead of active ones. Deleted projects never show.
   */
  async list(actor: ProjectActor, archived: boolean): Promise<ProjectSummary[]> {
    const rows = await this.baseQuery()
      .innerJoin("project.member as me", (j) =>
        j.onRef("me.project_id", "=", "p.id").on("me.user_id", "=", actor.userId),
      )
      .select("me.role as my_role")
      .where("p.archived_at", archived ? "is not" : "is", null)
      .orderBy("p.updated_at", "desc")
      .limit(500)
      .execute();
    return rows.flatMap((r) => {
      const role = effectiveRole(actor.role, r.my_role);
      return role ? [this.summary(r, role, false)] : [];
    });
  }

  /** Purpose: one project the caller may read (as a member or through its view-only link). 404 otherwise. */
  async get(actor: ProjectActor, id: string): Promise<ProjectSummary> {
    const { row, role, viaLink } = await this.load(actor, id, "read");
    return this.summary(row, role, viaLink);
  }

  /**
   * Purpose: create a project owned by the caller.
   * Side effects: inserts the project and the owner membership; audit `project.created`.
   */
  async create(
    actor: ProjectActor,
    input: { name: string; description?: string; areaName?: string | null; modes?: string[] },
  ): Promise<ProjectSummary> {
    const id = await this.db.transaction().execute(async (tx) => {
      const p = await tx
        .insertInto("project.project")
        .values({
          name: input.name,
          description: input.description ?? "",
          area_name: input.areaName ?? null,
          modes: input.modes ?? [],
          copied_from: null,
          updated_at: new Date(),
          archived_at: null,
          deleted_at: null,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await tx
        .insertInto("project.member")
        .values({ project_id: p.id, user_id: actor.userId, role: "owner", added_by: actor.userId })
        .execute();
      await this.log(
        actor,
        p.id,
        "project.created",
        null,
        { name: input.name, modes: input.modes ?? [] },
        tx,
      );
      return p.id;
    });
    return this.get(actor, id);
  }

  /** Purpose: rename or describe a project. Owners and Editors. Audit `project.updated`. */
  async update(
    actor: ProjectActor,
    id: string,
    patch: { name?: string; description?: string; areaName?: string | null; modes?: string[] },
  ): Promise<ProjectSummary> {
    await this.db.transaction().execute(async (tx) => {
      const { row } = await this.load(actor, id, "edit", tx, true);
      const before = {
        name: row.name,
        description: row.description,
        areaName: row.area_name,
        modes: row.modes,
      };
      await tx
        .updateTable("project.project")
        .set({
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.description !== undefined && { description: patch.description }),
          ...(patch.areaName !== undefined && { area_name: patch.areaName }),
          ...(patch.modes !== undefined && { modes: patch.modes }),
          updated_at: new Date(),
        })
        .where("id", "=", id)
        .execute();
      await this.log(actor, id, "project.updated", before, patch, tx);
    });
    return this.get(actor, id);
  }

  /**
   * Purpose: copy a project the caller can read into a new project the caller owns. Members are not copied.
   * Side effects: audit `project.duplicated` on the source chain and `project.created` on the new one.
   */
  async duplicate(actor: ProjectActor, id: string, name?: string): Promise<ProjectSummary> {
    const newId = await this.db.transaction().execute(async (tx) => {
      const { row } = await this.load(actor, id, "read", tx);
      const copyName = name ?? `${row.name} (copy)`.slice(0, 200);
      const p = await tx
        .insertInto("project.project")
        .values({
          name: copyName,
          description: row.description,
          area_name: row.area_name,
          modes: row.modes,
          copied_from: id,
          updated_at: new Date(),
          archived_at: null,
          deleted_at: null,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await tx
        .insertInto("project.member")
        .values({ project_id: p.id, user_id: actor.userId, role: "owner", added_by: actor.userId })
        .execute();
      await this.log(actor, id, "project.duplicated", null, { copyId: p.id }, tx);
      await this.log(actor, p.id, "project.created", null, { name: copyName, copiedFrom: id }, tx);
      return p.id;
    });
    return this.get(actor, newId);
  }

  /** Purpose: archive (hide from everyone's home, keep everything) or bring back. Owners only. */
  async setArchived(actor: ProjectActor, id: string, archived: boolean): Promise<ProjectSummary> {
    await this.db.transaction().execute(async (tx) => {
      const { row } = await this.load(actor, id, "manage", tx, true);
      if (Boolean(row.archived_at) === archived)
        throw new ConflictException(archived ? "project is already archived" : "project is not archived");
      await tx
        .updateTable("project.project")
        .set({ archived_at: archived ? new Date() : null })
        .where("id", "=", id)
        .execute();
      await this.log(actor, id, archived ? "project.archived" : "project.unarchived", null, null, tx);
    });
    return this.get(actor, id);
  }

  /**
   * Purpose: move a project to the bin, for everyone. Owners only; the caller must type the project name.
   * Side effects: sets deleted_at (a purge job removes binned projects after 30 days); audit `project.deleted`.
   */
  async remove(actor: ProjectActor, id: string, confirmName: string): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      const { row } = await this.load(actor, id, "manage", tx, true);
      if (confirmName.trim() !== row.name.trim())
        throw new BadRequestException("the name you typed does not match the project name");
      await tx.updateTable("project.project").set({ deleted_at: new Date() }).where("id", "=", id).execute();
      await this.log(actor, id, "project.deleted", { name: row.name }, null, tx);
    });
  }

  /** Purpose: the people with access, owner first. Any member may see who else has access. */
  async members(actor: ProjectActor, id: string): Promise<ProjectMember[]> {
    await this.load(actor, id, "read");
    const rows = await this.db
      .selectFrom("project.member as m")
      .innerJoin("iam.user as u", "u.id", "m.user_id")
      .select(["m.user_id", "m.role", "u.display_name", "u.email"])
      .where("m.project_id", "=", id)
      .where("u.status", "<>", "deleted")
      .orderBy(sql`array_position(array['owner','editor','commenter','viewer'], m.role)`)
      .orderBy("u.display_name")
      .execute();
    return rows.map((r) => ({
      userId: r.user_id,
      displayName: r.display_name,
      email: r.email,
      role: r.role,
    }));
  }

  /**
   * Purpose: give a person access, by the e-mail they sign in with. Owners only. The person must have signed
   * in to this instance at least once. Audit `project.member_added`.
   */
  async addMember(
    actor: ProjectActor,
    id: string,
    email: string,
    role: Exclude<ProjectRole, "owner">,
  ): Promise<ProjectMember[]> {
    await this.db.transaction().execute(async (tx) => {
      await this.load(actor, id, "manage", tx, true);
      const user = await tx
        .selectFrom("iam.user")
        .select(["id", "status", "instance_role"])
        .where(sql`lower(email)`, "=", email.toLowerCase())
        .where("status", "=", "active")
        .executeTakeFirst();
      if (!user) throw new NotFoundException("nobody with that e-mail has signed in to this MobSimLab yet");
      if (user.instance_role === "restricted") throw new ConflictException("that account is restricted");
      const existing = await tx
        .selectFrom("project.member")
        .select("role")
        .where("project_id", "=", id)
        .where("user_id", "=", user.id)
        .executeTakeFirst();
      if (existing) throw new ConflictException("that person already has access");
      await tx
        .insertInto("project.member")
        .values({ project_id: id, user_id: user.id, role, added_by: actor.userId })
        .execute();
      await this.log(actor, id, "project.member_added", null, { userId: user.id, role }, tx);
    });
    return this.members(actor, id);
  }

  /** Purpose: change a member's role. Owners only; the owner's own role cannot change here. */
  async setMemberRole(
    actor: ProjectActor,
    id: string,
    userId: string,
    role: Exclude<ProjectRole, "owner">,
  ): Promise<ProjectMember[]> {
    await this.db.transaction().execute(async (tx) => {
      await this.load(actor, id, "manage", tx, true);
      const m = await this.member(tx, id, userId);
      if (m.role === "owner") throw new ConflictException("the owner's role cannot be changed");
      await tx
        .updateTable("project.member")
        .set({ role })
        .where("project_id", "=", id)
        .where("user_id", "=", userId)
        .execute();
      await this.log(
        actor,
        id,
        "project.member_role_changed",
        { userId, role: m.role },
        { userId, role },
        tx,
      );
    });
    return this.members(actor, id);
  }

  /** Purpose: remove a member. Owners remove anyone but themselves; any other member may leave. */
  async removeMember(actor: ProjectActor, id: string, userId: string): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      const self = userId === actor.userId;
      await this.load(actor, id, self ? "read" : "manage", tx, true);
      const m = await this.member(tx, id, userId);
      if (m.role === "owner") throw new ConflictException("the owner cannot be removed");
      await tx
        .deleteFrom("project.member")
        .where("project_id", "=", id)
        .where("user_id", "=", userId)
        .execute();
      await this.log(
        actor,
        id,
        self ? "project.member_left" : "project.member_removed",
        { userId, role: m.role },
        null,
        tx,
      );
    });
  }

  /** Purpose: switch the view-only link on or off. Owners only. */
  async setLinkAccess(actor: ProjectActor, id: string, on: boolean): Promise<ProjectSummary> {
    await this.db.transaction().execute(async (tx) => {
      await this.load(actor, id, "manage", tx, true);
      await tx.updateTable("project.project").set({ link_access: on }).where("id", "=", id).execute();
      await this.log(actor, id, "project.link_access_changed", null, { linkAccess: on }, tx);
    });
    return this.get(actor, id);
  }

  // ---------------------------------------------------------------------------------------------------------

  private baseQuery(db: Database = this.db) {
    return db
      .selectFrom("project.project as p")
      .innerJoin("project.member as o", (j) =>
        j.onRef("o.project_id", "=", "p.id").on("o.role", "=", "owner"),
      )
      .innerJoin("iam.user as ou", "ou.id", "o.user_id")
      .select([
        "p.id",
        "p.name",
        "p.description",
        "p.area_name",
        "p.modes",
        "p.link_access",
        "p.created_at",
        "p.updated_at",
        "p.archived_at",
        "o.user_id as owner_id",
        "ou.display_name as owner_name",
        sql<number>`(SELECT count(*)::int FROM project.member c WHERE c.project_id = p.id)`.as(
          "member_count",
        ),
      ])
      .where("p.deleted_at", "is", null);
  }

  /**
   * Purpose: load a project and check the caller may perform `action`. Projects the caller cannot read are a
   * 404, so their existence does not leak; readable projects the caller may not change are a 403.
   * `lock` takes a row lock so concurrent changes to one project are serialised.
   */
  private async load(
    actor: ProjectActor,
    id: string,
    action: ProjectAction,
    db: Database = this.db,
    lock = false,
  ) {
    let q = this.baseQuery(db)
      .leftJoin("project.member as me", (j) =>
        j.onRef("me.project_id", "=", "p.id").on("me.user_id", "=", actor.userId),
      )
      .select("me.role as my_role")
      .where("p.id", "=", id);
    if (lock) q = q.forUpdate("p");
    const row = await q.executeTakeFirst();
    if (!row) throw new NotFoundException("project not found");
    const viaLink = !row.my_role && row.link_access;
    const role = row.my_role
      ? effectiveRole(actor.role, row.my_role)
      : viaLink
        ? effectiveRole(actor.role, "viewer")
        : null;
    if (!allows(role, "read") || !role) throw new NotFoundException("project not found");
    if (!allows(role, action)) throw new ForbiddenException("your role on this project does not allow this");
    return { row, role, viaLink };
  }

  private async member(db: Database, projectId: string, userId: string) {
    const m = await db
      .selectFrom("project.member")
      .select("role")
      .where("project_id", "=", projectId)
      .where("user_id", "=", userId)
      .executeTakeFirst();
    if (!m) throw new NotFoundException("that person has no access to this project");
    return m;
  }

  private summary(
    r: {
      id: string;
      name: string;
      description: string;
      area_name: string | null;
      modes: string[];
      link_access: boolean;
      created_at: Date;
      updated_at: Date;
      archived_at: Date | null;
      owner_id: string;
      owner_name: string | null;
      member_count: number;
    },
    role: ProjectRole,
    viaLink: boolean,
  ): ProjectSummary {
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      areaName: r.area_name,
      modes: r.modes,
      myRole: role,
      viaLink,
      owner: { id: r.owner_id, displayName: r.owner_name },
      memberCount: Number(r.member_count),
      linkAccess: r.link_access,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
      archivedAt: iso(r.archived_at),
    };
  }

  private log(
    actor: ProjectActor,
    projectId: string,
    action: string,
    before: unknown,
    after: unknown,
    tx: Database,
  ): Promise<string> {
    return this.audit.append(
      {
        chain: projectChain(projectId),
        action,
        objectType: "project",
        objectId: projectId,
        projectId,
        actorId: actor.userId,
        actorIpHash: actor.ipHash,
        requestId: actor.requestId,
        before,
        after,
      },
      tx,
    );
  }
}
