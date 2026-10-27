import { Inject, Injectable } from "@nestjs/common";
import { type Kysely, sql } from "kysely";
import { DATABASE, type Database, type DB } from "../db/database";

/** Chain for instance-level (admin) actions; projects get their own chain later. */
export const INSTANCE_CHAIN = "instance";

/** One audit entry (04 §3.4). */
export interface AuditEntry {
  action: string;
  objectType: string;
  objectId?: string | null;
  actorId?: string | null;
  actorIpHash?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  requestId?: string | null;
  chain?: string;
}

/** Writes and verifies the hash-chained audit log through the `audit.append` database function. */
@Injectable()
export class AuditService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Purpose: append an entry, inside the caller's transaction when one is given.
   * Output: the record id. Side effects: inserts into audit.record and moves the chain head.
   */
  async append(entry: AuditEntry, tx: Kysely<DB> = this.db): Promise<string> {
    const json = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));
    const { rows } = await sql<{ id: string }>`
      SELECT audit.append(${entry.chain ?? INSTANCE_CHAIN}, ${entry.actorId ?? null}::uuid, ${entry.actorIpHash ?? null},
        ${entry.action}, ${entry.objectType}, ${entry.objectId ?? null}, NULL::uuid,
        ${json(entry.before)}::jsonb, ${json(entry.after)}::jsonb, ${entry.reason ?? null}, ${entry.requestId ?? null}) AS id`.execute(
      tx,
    );
    return String(rows[0]?.id);
  }

  /**
   * Purpose: verify one chain.
   * Output: null if intact, otherwise the sequence number of the first broken record.
   */
  async verify(chain = INSTANCE_CHAIN): Promise<number | null> {
    const { rows } = await sql<{ broken: string | null }>`SELECT audit.verify(${chain}) AS broken`.execute(
      this.db,
    );
    const b = rows[0]?.broken;
    return b === null || b === undefined ? null : Number(b);
  }
}
