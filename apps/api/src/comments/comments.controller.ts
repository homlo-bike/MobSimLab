import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import { type MslRequest, SessionService } from "../auth/session.service";
import { Requires } from "../iam/requires";
import type { ProjectActor } from "../projects/projects.service";
import { COMMENT_OBJECT_TYPES, CommentsService } from "./comments.service";

const uuid = z.uuid();
/** Plain text with line breaks; the web app shows it as text, never as HTML. */
const body = z.string().trim().min(1, "a comment needs some text").max(4000);
const addBody = z.strictObject({
  objectType: z.enum(COMMENT_OBJECT_TYPES),
  objectId: z.string().trim().min(1).max(100),
  body,
  parentId: uuid.optional(),
});
const editBody = z.strictObject({ body });
const resolveBody = z.strictObject({ resolved: z.boolean() });

/** Purpose: parse input with a zod schema; 400 with the issue messages on failure. */
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value ?? {});
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message));
  return r.data;
}

/**
 * Comments on project objects (10 §1.2): list, add, edit, resolve and delete. Project roles are checked in
 * CommentsService; instance roles by the global guard.
 */
@Controller("api/projects/:id/comments")
export class CommentsController {
  constructor(
    private readonly comments: CommentsService,
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

  /** Purpose: every comment of the project, oldest first. */
  @Get()
  @Requires("projects.read")
  async list(@Param("id") id: string, @Req() req: MslRequest) {
    return { comments: await this.comments.list(this.actor(req), parse(uuid, id)) };
  }

  /** Purpose: start a thread on an object or reply to one. Body: `{ objectType, objectId, body, parentId? }`. */
  @Post()
  @Requires("projects.read")
  async add(@Param("id") id: string, @Body() b: unknown, @Req() req: MslRequest) {
    return { comment: await this.comments.add(this.actor(req), parse(uuid, id), parse(addBody, b)) };
  }

  /** Purpose: change the text of one's own comment. Body: `{ body }`. */
  @Patch(":commentId")
  @Requires("projects.read")
  async edit(
    @Param("id") id: string,
    @Param("commentId") commentId: string,
    @Body() b: unknown,
    @Req() req: MslRequest,
  ) {
    const { body: text } = parse(editBody, b);
    return {
      comment: await this.comments.edit(this.actor(req), parse(uuid, id), parse(uuid, commentId), text),
    };
  }

  /** Purpose: mark a thread resolved or open it again. Body: `{ resolved }`. */
  @Put(":commentId/resolved")
  @Requires("projects.read")
  async resolve(
    @Param("id") id: string,
    @Param("commentId") commentId: string,
    @Body() b: unknown,
    @Req() req: MslRequest,
  ) {
    const { resolved } = parse(resolveBody, b);
    return {
      comment: await this.comments.resolve(
        this.actor(req),
        parse(uuid, id),
        parse(uuid, commentId),
        resolved,
      ),
    };
  }

  /** Purpose: delete a comment (and its replies, when it starts a thread). */
  @Delete(":commentId")
  @Requires("projects.read")
  async remove(@Param("id") id: string, @Param("commentId") commentId: string, @Req() req: MslRequest) {
    await this.comments.remove(this.actor(req), parse(uuid, id), parse(uuid, commentId));
    return { ok: true };
  }
}
