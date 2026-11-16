import { BadRequestException, Body, Controller, HttpCode, Inject, Post } from "@nestjs/common";
import { z } from "zod";
import { Requires } from "../iam/requires";
import { type AppLogger, LOG_LEVELS, LOGGER } from "./logger";

/** Most entries in one batch from a browser. */
export const MAX_FRONTEND_BATCH = 50;

/** One browser log entry, as the web app's logger sends it (apps/web/src/logging/logger.ts). */
const entrySchema = z.object({
  level: z.enum(LOG_LEVELS),
  message: z.string().max(2000),
  /** When the browser wrote it (ms since 1970). */
  time: z.number().int().min(0).max(8.64e15).optional(),
  module: z.string().max(100).optional(),
  projectId: z.uuid().optional(),
  context: z
    .record(z.string().max(100), z.unknown())
    .refine((c) => JSON.stringify(c).length <= 4000, "context is larger than 4,000 characters")
    .optional(),
});

const batchSchema = z.object({ entries: z.array(entrySchema).min(1).max(MAX_FRONTEND_BATCH) });

/**
 * Browser logs (FR-LOG-02, 03 §6): the web app sends its entries here in batches. They are stored like the
 * API's own, with `origin` frontend and the signed-in user, after the same redaction.
 */
@Controller("api/logs")
export class LogsController {
  constructor(@Inject(LOGGER) private readonly logger: AppLogger) {}

  /**
   * Purpose: take a batch of browser log entries.
   * Inputs: `{ entries }`, at most 50, schema-checked; the body size cap is the API's 100 kB.
   * Side effects: writes each entry through the logger. Authenticated, CSRF-checked and rate-limited by the
   * global guard like every other write.
   */
  @Post()
  @HttpCode(204)
  @Requires("session.own")
  ingest(@Body() body: unknown): void {
    const parsed = batchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((i) => i.message).join("; "));
    for (const e of parsed.data.entries) {
      this.logger.log(e.level, e.message, {
        origin: "frontend",
        module: e.module ?? "web",
        projectId: e.projectId,
        clientTime: e.time === undefined ? undefined : new Date(e.time).toISOString(),
        // Kept under its own key, so a browser cannot set the user, request or origin of an entry.
        details: e.context,
      });
    }
  }
}
