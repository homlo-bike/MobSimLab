import {
  Global,
  Inject,
  Injectable,
  Module,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { sql } from "kysely";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig } from "../config/env";
import { DATABASE, type Database } from "../db/database";
import { DatabaseTransport } from "./db.transport";
import { type AppLogger, createLogger, LOGGER } from "./logger";
import { LogsController } from "./logs.controller";
import { NestWinstonLogger } from "./nest-logger";

/** How often the log partitions are created ahead and old ones dropped. */
const MAINTAIN_EVERY_MS = 60 * 60 * 1000;

/**
 * Connects the logger to the database once the app is up, and keeps the daily log partitions: makes the next
 * days' partitions and drops those older than 30 days (`logs.maintain`, db/migrations/0009_logs.sql).
 */
@Injectable()
export class LogMaintenance implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly transport: DatabaseTransport;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> = Promise.resolve();

  constructor(
    @Inject(LOGGER) private readonly logger: AppLogger,
    @Inject(DATABASE) private readonly db: Database,
  ) {
    this.transport = new DatabaseTransport(db);
  }

  onApplicationBootstrap(): void {
    this.logger.add(this.transport);
    this.running = this.maintain();
    this.timer = setInterval(() => {
      this.running = this.maintain();
    }, MAINTAIN_EVERY_MS).unref();
  }

  /** Runs before any module's shutdown hook, so the database is still open for the last entries. */
  async beforeApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
    this.logger.remove(this.transport);
    await this.transport.flush();
  }

  /** Purpose: write waiting entries now (tests use it). */
  flush(): Promise<void> {
    return this.transport.flush();
  }

  /** Purpose: run `logs.maintain()`. Never throws: a failure is logged. */
  async maintain(): Promise<void> {
    try {
      const { rows } = await sql<{ dropped: number }>`SELECT logs.maintain() AS dropped`.execute(this.db);
      const dropped = Number(rows[0]?.dropped ?? 0);
      if (dropped)
        this.logger.info(`dropped ${dropped} log partitions older than 30 days`, { module: "logging" });
    } catch (e) {
      this.logger.warn(`log partition upkeep failed: ${e instanceof Error ? e.message : String(e)}`, {
        module: "logging",
      });
    }
  }
}

/**
 * Logging (ADR-0022, 03 §4 `logging`): the Winston logger every module can inject as LOGGER, the Nest adapter
 * that sends Nest's own and every `new Logger()` message through it, the database sink, and the browser log
 * endpoint.
 */
@Global()
@Module({
  controllers: [LogsController],
  providers: [
    {
      provide: LOGGER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createLogger(config.logging ?? { level: "info" }),
    },
    {
      provide: NestWinstonLogger,
      inject: [LOGGER],
      useFactory: (logger: AppLogger) => new NestWinstonLogger(logger),
    },
    LogMaintenance,
  ],
  exports: [LOGGER, NestWinstonLogger],
})
export class LoggingModule {}
