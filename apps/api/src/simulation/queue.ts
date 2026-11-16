import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { sql } from "kysely";
import type { PgBoss } from "pg-boss" with { "resolution-mode": "import" };
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig } from "../config/env";
import { DATABASE, type Database } from "../db/database";

/**
 * The pg-boss queue simulation runs go through (ADR-0023). The Python sim-worker takes jobs from it with the
 * SQL in `worker/src/mobsim_worker/queue.py`; the two sides share these settings.
 */
export const RUN_QUEUE = "simulation-run";

/** pg-boss schema (db/migrations/0007_simulation_runs.sql creates it and lets the app role install into it). */
export const QUEUE_SCHEMA = "pgboss";

/**
 * Queue settings. A run is deterministic, so a failed run is not retried. The worker beats every
 * `heartbeatSeconds / 4`; a job whose worker stops beating is failed by pg-boss's supervisor, and the API then
 * marks its run failed.
 */
export const RUN_QUEUE_OPTIONS = {
  retryLimit: 0,
  expireInSeconds: 6 * 3600,
  heartbeatSeconds: 120,
  retentionSeconds: 7 * 24 * 3600,
  deleteAfterSeconds: 7 * 24 * 3600,
} as const;

/** What a job carries: the run to do. Everything else is read from `simulation.run`. */
export interface RunJob {
  runId: string;
}

/** pg-boss job states, as the API reads them to tell whether a worker stopped. */
export type JobState = "created" | "retry" | "active" | "completed" | "cancelled" | "failed";

/**
 * Sends simulation runs to the background workers through pg-boss. pg-boss starts on the first use, so the API
 * starts (and its tests run) without touching the queue; starting installs or upgrades pg-boss's tables and
 * lets the worker role take and settle jobs.
 */
@Injectable()
export class RunQueue implements OnApplicationShutdown {
  private readonly log = new Logger("RunQueue");
  private boss: Promise<PgBoss> | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  /** Purpose: queue one run. Output: the pg-boss job ID. Throws when the queue cannot be reached. */
  async send(job: RunJob): Promise<string> {
    const boss = await this.started();
    const id = await boss.send(RUN_QUEUE, { ...job });
    if (!id) throw new Error("the queue did not take the job");
    return id;
  }

  /** Purpose: cancel a job that no worker has taken yet. Ignores jobs already taken or settled. */
  async cancel(jobId: string): Promise<void> {
    const boss = await this.started();
    await boss.cancel(RUN_QUEUE, jobId);
  }

  /**
   * Purpose: states of jobs, by ID, read straight from the job table. Jobs pg-boss has deleted are absent.
   * Before the first send there is no job table yet, and the answer is empty.
   */
  async states(jobIds: string[]): Promise<Map<string, JobState>> {
    const out = new Map<string, JobState>();
    if (!jobIds.length) return out;
    const exists = await sql<{ t: string | null }>`SELECT to_regclass('pgboss.job')::text AS t`.execute(
      this.db,
    );
    if (!exists.rows[0]?.t) return out;
    const { rows } = await sql<{ id: string; state: JobState }>`
      SELECT id::text AS id, state::text AS state FROM pgboss.job
      WHERE name = ${RUN_QUEUE} AND id = ANY(${jobIds}::uuid[])`.execute(this.db);
    for (const r of rows) out.set(r.id, r.state);
    return out;
  }

  async onApplicationShutdown(): Promise<void> {
    const b = this.boss;
    this.boss = null;
    if (b) await (await b.catch(() => null))?.stop({ graceful: false, close: true, timeout: 5000 });
  }

  private started(): Promise<PgBoss> {
    this.boss ??= this.start().catch((e: unknown) => {
      this.boss = null;
      throw e;
    });
    return this.boss;
  }

  private async start(): Promise<PgBoss> {
    const { PgBoss } = await import("pg-boss");
    const boss = new PgBoss({
      host: this.config.db.host,
      port: this.config.db.port,
      database: this.config.db.name,
      user: "mobsimlab_app",
      password: this.config.secrets.db_app_password,
      application_name: "mobsimlab-api-queue",
      schema: QUEUE_SCHEMA,
      max: 3,
      createSchema: false,
      migrate: true,
      supervise: true,
      schedule: false,
    });
    boss.on("error", (e: unknown) => this.log.warn(`queue: ${e instanceof Error ? e.message : String(e)}`));
    await boss.start();
    if (!(await boss.getQueue(RUN_QUEUE))) await boss.createQueue(RUN_QUEUE, { ...RUN_QUEUE_OPTIONS });
    // The tables belong to the app role, which pg-boss's own upgrades run as; the worker may only take and
    // settle jobs (worker/src/mobsim_worker/queue.py).
    await sql`GRANT SELECT, UPDATE ON pgboss.job TO mobsimlab_worker`.execute(this.db);
    return boss;
  }
}
