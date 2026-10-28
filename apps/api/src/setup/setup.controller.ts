import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import { AuditService } from "../audit/audit.service";
import type { MslRequest } from "../auth/session.service";
import { SessionService } from "../auth/session.service";
import { DATABASE, type Database } from "../db/database";
import { Requires } from "../iam/requires";

const instanceSchema = z.strictObject({ name: z.string().trim().min(1).max(100) });

/**
 * Setup wizard, first step (05 §3.1): instance name, then "Finish setup", which lets other users in.
 * Later steps (providers, group mappings, auto-registration, basemaps, defaults) are added to this controller.
 */
@Controller("api/setup")
export class SetupController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  /** Purpose: wizard state. */
  @Get()
  @Requires("setup.manage")
  async state() {
    return this.db
      .selectFrom("iam.instance")
      .select(["mode", "name", "setup_finished_at"])
      .executeTakeFirstOrThrow();
  }

  /** Purpose: set the instance name while in setup mode. Input: `{ name }`. */
  @Put("instance")
  @Requires("setup.manage")
  async setInstance(@Body() body: unknown, @Req() req: MslRequest) {
    const parsed = instanceSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((i) => i.message));
    return this.db.transaction().execute(async (tx) => {
      const before = await tx
        .selectFrom("iam.instance")
        .select(["mode", "name"])
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (before.mode !== "setup") throw new ConflictException("setup is already finished");
      await tx.updateTable("iam.instance").set({ name: parsed.data.name, updated_at: new Date() }).execute();
      await this.audit.append(
        {
          action: "instance.updated",
          objectType: "instance",
          actorId: req.session?.actor.userId,
          actorIpHash: this.sessions.ipHash(req.ip),
          requestId: req.requestId,
          before: { name: before.name },
          after: { name: parsed.data.name },
        },
        tx,
      );
      return { name: parsed.data.name };
    });
  }

  /** Purpose: finish setup. Other users can sign in from now on. */
  @Post("finish")
  @HttpCode(200)
  @Requires("setup.manage")
  async finish(@Req() req: MslRequest) {
    return this.db.transaction().execute(async (tx) => {
      const inst = await tx.selectFrom("iam.instance").select("mode").forUpdate().executeTakeFirstOrThrow();
      if (inst.mode !== "setup") throw new ConflictException("setup is already finished");
      await tx
        .updateTable("iam.instance")
        .set({ mode: "open", setup_finished_at: new Date(), updated_at: new Date() })
        .execute();
      await this.audit.append(
        {
          action: "instance.setup_finished",
          objectType: "instance",
          actorId: req.session?.actor.userId,
          actorIpHash: this.sessions.ipHash(req.ip),
          requestId: req.requestId,
          before: { mode: "setup" },
          after: { mode: "open" },
        },
        tx,
      );
      return { mode: "open" };
    });
  }
}
