import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
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
            ? { resolved_at: new Date(), resolved_by: actor.userId }
            : { resolved_at: null, resolved_by: null },
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
    };
  }
}
