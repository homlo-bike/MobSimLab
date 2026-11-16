import Transport from "winston-transport";
import type { Database } from "../db/database";
import { LOG_LINE, type LogLine } from "./logger";

/** Entries written in one INSERT at most. */
const BATCH = 100;

/** Milliseconds an entry waits before the batch is written. */
const FLUSH_MS = 1000;

/** Most entries held while the database is slow or away; older ones are dropped first. */
const MAX_PENDING = 5000;

/** Levels the database takes (C-13: WARN and above only). */
const STORED = new Set(["WARN", "ERROR", "CRITICAL"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Largest stored context, in characters of JSON; a bigger one is replaced by a note. */
const MAX_CONTEXT = 12_000;

/** A row of logs.entry (db/migrations/0009_logs.sql). */
export interface LogRow {
  at: string;
  level: string;
  origin: string;
  module: string | null;
  message: string;
  request_id: string | null;
  user_id: string | null;
  project_id: string | null;
  run_id: string | null;
  context: string | null;
}

/**
 * Purpose: the logs.entry row for a log line, with every field cut to what the table accepts.
 * Inputs: the line. Output: the row, or null for levels the database does not take.
 */
export function toLogRow(line: LogLine): LogRow | null {
  if (!STORED.has(line.level)) return null;
  const uuid = (v?: string) => (v && UUID.test(v) ? v : null);
  let context = line.context ? JSON.stringify(line.context) : null;
  if (context && context.length > MAX_CONTEXT)
    context = JSON.stringify({ truncated: true, size: context.length });
  return {
    at: line.time,
    level: line.level,
    origin: line.origin,
    module: line.module?.slice(0, 100) ?? null,
    message: line.message.slice(0, 4000),
    request_id: line.requestId?.slice(0, 100) ?? null,
    user_id: uuid(line.userId),
    project_id: uuid(line.projectId),
    run_id: uuid(line.runId),
    context,
  };
}

/**
 * The PostgreSQL log sink (ADR-0022): WARN and above into logs.entry, in batches. A failed write is reported
 * once on stderr (never through the logger, which would loop) and the batch is dropped; logging never stops
 * or slows the API.
 */
export class DatabaseTransport extends Transport {
  private pending: LogRow[] = [];
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();
  private failing = false;

  constructor(private readonly db: Database) {
    super({ level: "warn" });
  }

  override log(info: Record<string | symbol, unknown>, next: () => void): void {
    const line = info[LOG_LINE] as LogLine | undefined;
    const row = line ? toLogRow(line) : null;
    if (row) {
      this.pending.push(row);
      if (this.pending.length > MAX_PENDING) this.pending.splice(0, this.pending.length - MAX_PENDING);
      if (this.pending.length >= BATCH) void this.flush();
      else this.timer ??= setTimeout(() => void this.flush(), FLUSH_MS).unref();
    }
    next();
  }

  /** Purpose: write what is waiting. Resolves when it is written or dropped. */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const rows = this.pending.splice(0);
    if (!rows.length) return this.writing;
    this.writing = this.writing.then(() => this.store(rows));
    return this.writing;
  }

  override close(): void {
    void this.flush();
  }

  private async store(rows: LogRow[]): Promise<void> {
    for (let i = 0; i < rows.length; i += BATCH) {
      try {
        await this.db
          .insertInto("logs.entry")
          .values(rows.slice(i, i + BATCH))
          .execute();
        this.failing = false;
      } catch (e) {
        if (!this.failing) {
          process.stderr.write(
            `${JSON.stringify({
              time: new Date().toISOString(),
              level: "ERROR",
              severity: 50,
              origin: "backend",
              module: "logging",
              message: `could not store log entries in the database: ${e instanceof Error ? e.message : String(e)}`,
            })}\n`,
          );
        }
        this.failing = true;
      }
    }
  }
}
