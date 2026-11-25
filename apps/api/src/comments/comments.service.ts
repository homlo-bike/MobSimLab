import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { sql } from "kysely";
import { DATABASE, type Database } from "../db/database";
import { type ProjectActor, ProjectsService } from "../projects/projects.service";

/**
 * Objects a comment can be on (10 §1.2): the railway tool's stations, tracks, switches and signals, the street
 * lines, the railway tool's service lines and the depots. Ids are the ids those editors give their objects.
 */
export const COMMENT_OBJECT_TYPES = [
  "station",
  "track",
  "switch",
  "signal",
  "street-line",
  "service-line",
  "depot",
] as const;
export type CommentObjectType = (typeof COMMENT_OBJECT_TYPES)[number];

/** Most comments a project can hold, so one project cannot fill the database. */
export const MAX_COMMENTS_PER_PROJECT = 20_000;

/** One comment as the web app sees it. Replies carry `parentId`; only a thread's first comment can be resolved. */
export interface ProjectComment {
  id: string;
  objectType: CommentObjectType;
  objectId: string;
  parentId: string | null;
  body: string;
  author: { id: string; displayName: string | null } | null;
  createdAt: string;
  editedAt: string | null;
  resolvedAt: string | null;
  resolvedBy: { id: string; displayName: string | null } | null;
  /** Opened from a .mslab file: its author and resolver are the names the file kept (`fileAuthor`, `fileResolvedBy`). */
  fromFile: boolean;
  fileAuthor: string | null;
  fileResolvedBy: string | null;
}

/** How far back the notices of new comments look. */
export const NOTICE_DAYS = 30;
/** Most new comments one notices request lists (the total still counts them all, up to `NOTICE_COUNT_CAP`). */
export const MAX_NOTICES = 50;
/** The count of new comments stops here; the bell shows "99+" well before. */
export const NOTICE_COUNT_CAP = 1000;

/** A new comment or reply on one of the caller's projects, for the bell (`GET /api/comments/new`). */
export interface CommentNotice extends ProjectComment {
  projectId: string;
  projectName: string;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * Comments on the objects of a project. Everyone who can read a project reads its comments; Owners, Editors and
 * Commenters write (05 §3.2). Authors edit and delete their own comments, Owners delete any. Every change is
 * audited on the project's chain with the object and the text length, not the text.
 */
@Injectable()
export class CommentsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projects: ProjectsService,
  ) {}

  /** Purpose: every comment of a project the caller may read, oldest first. */
  async list(actor: ProjectActor, projectId: string): Promise<ProjectComment[]> {
    await this.projects.access(actor, projectId, "read");
    const rows = await this.query(this.db)
      .where("c.project_id", "=", projectId)
      .orderBy("c.created_at")
      .orderBy("c.id")
      .limit(MAX_COMMENTS_PER_PROJECT)
      .execute();
    return rows.map((r) => this.comment(r));
  }

  /**
   * Purpose: add a comment: a new thread on an object, or a reply to a thread (`parentId`, its first comment).
   * Owners, Editors and Commenters. A reply takes the object of its thread. Audit `comment.added`.
   */
  async add(
    actor: ProjectActor,
    projectId: string,
    input: { objectType: CommentObjectType; objectId: string; body: string; parentId?: string },
  ): Promise<ProjectComment> {
    const id = await this.db.transaction().execute(async (tx) => {
      await this.projects.access(actor, projectId, "comment", tx, true);
      let objectType = input.objectType;
      let objectId = input.objectId;
      if (input.parentId) {
        const parent = await this.row(tx, projectId, input.parentId);
        if (parent.parent_id) throw new BadRequestException("reply to the first comment of the thread");
        objectType = parent.object_type as CommentObjectType;
        objectId = parent.object_id;
      }
      const count = await tx
        .selectFrom("collab.comment")
        .select((eb) => eb.fn.countAll<number>().as("n"))
        .where("project_id", "=", projectId)
        .executeTakeFirstOrThrow();
      if (Number(count.n) >= MAX_COMMENTS_PER_PROJECT)
        throw new BadRequestException("this project has too many comments");
      const c = await tx
        .insertInto("collab.comment")
        .values({
          project_id: projectId,
          object_type: objectType,
          object_id: objectId,
          parent_id: input.parentId ?? null,
          body: input.body,
          author_id: actor.userId,
          edited_at: null,
          resolved_at: null,
          resolved_by: null,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await this.projects.logProject(
        actor,
        projectId,
        "comment.added",
        null,
        { id: c.id, objectType, objectId, parentId: input.parentId ?? null, length: input.body.length },
        tx,
      );
      return c.id;
    });
    return this.one(projectId, id);
  }

  /** Purpose: change the text of one's own comment. The author only, while they may still comment. */
  async edit(actor: ProjectActor, projectId: string, id: string, body: string): Promise<ProjectComment> {
    await this.db.transaction().execute(async (tx) => {
      await this.projects.access(actor, projectId, "comment", tx, true);
      const c = await this.row(tx, projectId, id);
      if (c.author_id !== actor.userId) throw new ForbiddenException("you can only edit your own comments");
      await tx
        .updateTable("collab.comment")
        .set({ body, edited_at: new Date() })
        .where("id", "=", id)
        .execute();
      await this.projects.logProject(
        actor,
        projectId,
        "comment.edited",
        { id, length: c.body.length },
        { id, length: body.length },
        tx,
      );
    });
    return this.one(projectId, id);
  }

  /**
   * Purpose: mark a thread resolved, or open it again. Anyone who may comment. `id` must be the thread's first
   * comment. Audit `comment.resolved` or `comment.reopened`.
   */
  async resolve(
    actor: ProjectActor,
    projectId: string,
    id: string,
    resolved: boolean,
  ): Promise<ProjectComment> {
    await this.db.transaction().execute(async (tx) => {
      await this.projects.access(actor, projectId, "comment", tx, true);
      const c = await this.row(tx, projectId, id);
      if (c.parent_id) throw new BadRequestException("only a whole thread can be resolved");
      if ((c.resolved_at !== null) === resolved) return;
      await tx
        .updateTable("collab.comment")
        .set(
          resolved
            ? { resolved_at: new Date(), resolved_by: actor.userId, file_resolved_by: null }
            : { resolved_at: null, resolved_by: null, file_resolved_by: null },
        )
        .where("id", "=", id)
        .execute();
      await this.projects.logProject(
        actor,
        projectId,
        resolved ? "comment.resolved" : "comment.reopened",
        null,
        { id, objectType: c.object_type, objectId: c.object_id },
        tx,
      );
    });
    return this.one(projectId, id);
  }

  /**
   * Purpose: delete a comment. Its author (while they may comment) or the project's Owner. Deleting a thread's
   * first comment deletes its replies. Audit `comment.deleted` with the number of replies removed.
   */
  async remove(actor: ProjectActor, projectId: string, id: string): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      const role = await this.projects.access(actor, projectId, "comment", tx, true);
      const c = await this.row(tx, projectId, id);
      if (c.author_id !== actor.userId && role !== "owner")
        throw new ForbiddenException("you can only delete your own comments");
      const replies = await tx
        .selectFrom("collab.comment")
        .select((eb) => eb.fn.countAll<number>().as("n"))
        .where("parent_id", "=", id)
        .executeTakeFirstOrThrow();
      await tx.deleteFrom("collab.comment").where("id", "=", id).execute();
      await this.projects.logProject(
        actor,
        projectId,
        "comment.deleted",
        {
          id,
          objectType: c.object_type,
          objectId: c.object_id,
          authorId: c.author_id,
          replies: Number(replies.n),
        },
        null,
        tx,
      );
    });
  }

  /**
   * Purpose: the new comments and replies on the projects the caller is a member of: written by someone else in
   * the last `NOTICE_DAYS` days, after the caller joined the project, and not yet read by the caller. Projects in
   * the bin or archived are left out, and so are public projects the caller only opens through their link.
   * Output: up to `MAX_NOTICES`, newest first, and the total (capped at `NOTICE_COUNT_CAP`). Reads only.
   */
  async notices(userId: string): Promise<{ total: number; comments: CommentNotice[] }> {
    const base = this.db
      .selectFrom("collab.comment as c")
      .innerJoin("project.member as m", (j) =>
        j.onRef("m.project_id", "=", "c.project_id").on("m.user_id", "=", userId),
      )
      .innerJoin("project.project as p", "p.id", "c.project_id")
      .where("p.deleted_at", "is", null)
      .where("p.archived_at", "is", null)
      .where((eb) => eb.or([eb("c.author_id", "is", null), eb("c.author_id", "!=", userId)]))
      .whereRef("c.created_at", ">", "m.created_at")
      .where("c.created_at", ">", sql<Date>`now() - make_interval(days => ${NOTICE_DAYS})`)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom("collab.comment_read as r")
              .select("r.comment_id")
              .whereRef("r.comment_id", "=", "c.id")
              .where("r.user_id", "=", userId),
          ),
        ),
      );
    const counted = await this.db
      .selectFrom(base.select("c.id").limit(NOTICE_COUNT_CAP).as("x"))
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .executeTakeFirstOrThrow();
    const rows = await base
      .leftJoin("iam.user as a", "a.id", "c.author_id")
      .leftJoin("iam.user as rb", "rb.id", "c.resolved_by")
      .select([
        "c.id",
        "c.project_id",
        "p.name as project_name",
        "c.object_type",
        "c.object_id",
        "c.parent_id",
        "c.body",
        "c.author_id",
        "c.created_at",
        "c.edited_at",
        "c.resolved_at",
        "c.resolved_by",
        "a.display_name as author_name",
        "rb.display_name as resolved_by_name",
        "c.from_file",
        "c.file_author",
        "c.file_resolved_by",
      ])
      .orderBy("c.created_at", "desc")
      .orderBy("c.id", "desc")
      .limit(MAX_NOTICES)
      .execute();
    return {
      total: Number(counted.n),
      comments: rows.map((r) => ({
        ...this.comment(r),
        projectId: r.project_id,
        projectName: r.project_name,
      })),
    };
  }

  /**
   * Purpose: mark comments as read by the caller, so they leave the bell: the given ids, or every new comment
   * (`all`). Ids of comments on projects the caller is not a member of are ignored. Side effect: writes
   * `collab.comment_read` rows (once per comment).
   */
  async markRead(userId: string, input: { ids?: string[]; all?: boolean }): Promise<void> {
    let ids = input.ids ?? [];
    if (input.all) {
      // Every comment that can be new, not only the first page the bell shows.
      const rest = await this.db
        .selectFrom("collab.comment as c")
        .innerJoin("project.member as m", (j) =>
          j.onRef("m.project_id", "=", "c.project_id").on("m.user_id", "=", userId),
        )
        .select("c.id")
        .where((eb) => eb.or([eb("c.author_id", "is", null), eb("c.author_id", "!=", userId)]))
        .whereRef("c.created_at", ">", "m.created_at")
        .where("c.created_at", ">", sql<Date>`now() - make_interval(days => ${NOTICE_DAYS})`)
        .limit(NOTICE_COUNT_CAP)
        .execute();
      ids = [...new Set([...ids, ...rest.map((r) => r.id)])];
    }
    if (ids.length === 0) return;
    const allowed = await this.db
      .selectFrom("collab.comment as c")
      .innerJoin("project.member as m", (j) =>
        j.onRef("m.project_id", "=", "c.project_id").on("m.user_id", "=", userId),
      )
      .select("c.id")
      .where("c.id", "in", ids)
      .execute();
    if (allowed.length === 0) return;
    await this.db
      .insertInto("collab.comment_read")
      .values(allowed.map((r) => ({ user_id: userId, comment_id: r.id })))
      .onConflict((oc) => oc.columns(["user_id", "comment_id"]).doNothing())
      .execute();
  }

  // ---------------------------------------------------------------------------------------------------------

  private async one(projectId: string, id: string): Promise<ProjectComment> {
    const r = await this.query(this.db)
      .where("c.project_id", "=", projectId)
      .where("c.id", "=", id)
      .executeTakeFirstOrThrow();
    return this.comment(r);
  }

  private async row(db: Database, projectId: string, id: string) {
    const c = await db
      .selectFrom("collab.comment")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("id", "=", id)
      .executeTakeFirst();
    if (!c) throw new NotFoundException("comment not found");
    return c;
  }

  private query(db: Database) {
    return db
      .selectFrom("collab.comment as c")
      .leftJoin("iam.user as a", "a.id", "c.author_id")
      .leftJoin("iam.user as rb", "rb.id", "c.resolved_by")
      .select([
        "c.id",
        "c.object_type",
        "c.object_id",
        "c.parent_id",
        "c.body",
        "c.author_id",
        "c.created_at",
        "c.edited_at",
        "c.resolved_at",
        "c.resolved_by",
        "a.display_name as author_name",
        "rb.display_name as resolved_by_name",
        "c.from_file",
        "c.file_author",
        "c.file_resolved_by",
      ]);
  }

  private comment(r: {
    id: string;
    object_type: string;
    object_id: string;
    parent_id: string | null;
    body: string;
    author_id: string | null;
    created_at: Date;
    edited_at: Date | null;
    resolved_at: Date | null;
    resolved_by: string | null;
    author_name: string | null;
    resolved_by_name: string | null;
    from_file: boolean;
    file_author: string | null;
    file_resolved_by: string | null;
  }): ProjectComment {
    return {
      id: r.id,
      objectType: r.object_type as CommentObjectType,
      objectId: r.object_id,
      parentId: r.parent_id,
      body: r.body,
      author: r.author_id ? { id: r.author_id, displayName: r.author_name } : null,
      createdAt: r.created_at.toISOString(),
      editedAt: iso(r.edited_at),
      resolvedAt: iso(r.resolved_at),
      resolvedBy: r.resolved_by ? { id: r.resolved_by, displayName: r.resolved_by_name } : null,
      fromFile: r.from_file,
      fileAuthor: r.file_author,
      fileResolvedBy: r.file_resolved_by,
    };
  }
}
