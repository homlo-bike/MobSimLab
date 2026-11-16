import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import { currentLogContext } from "./context";
import { isSecretKey, REDACTED, redact, redactText } from "./redact";

/** Log levels, least severe first (03 §6). AUDIT is not one of them: audit records go to the audit module. */
export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "critical"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Numeric severity written with every entry (03 §6). */
export const SEVERITY: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  critical: 60,
};

/** Winston's priorities: lower is more severe. */
const WINSTON_LEVELS: Record<LogLevel, number> = {
  critical: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

/** Injection token of the application logger. */
export const LOGGER = Symbol("LOGGER");

/** Where an entry was written. */
export type LogOrigin = "backend" | "frontend" | "worker";

/** The application logger: Winston with the MobSimLab levels. */
export type AppLogger = winston.Logger & Record<LogLevel, winston.LeveledLogMethod>;

/** Logging settings (MOBSIMLAB_LOG_LEVEL, MOBSIMLAB_LOG_DIR). */
export interface LoggingConfig {
  /** Lowest level written to the console and the file. The database only ever takes WARN and above. */
  level: LogLevel;
  /** Directory of the rotating log file; absent: no file. */
  dir?: string;
  /** Write to stdout (default true; the tests turn it off). */
  console?: boolean;
}

/** Days a log file is kept, the same as the database (03 §6). */
export const FILE_RETENTION_DAYS = 30;

/** Fields the logger sets itself; everything else a caller passes goes into `context`. */
const OWN_FIELDS = new Set([
  "level",
  "message",
  "module",
  "origin",
  "requestId",
  "userId",
  "projectId",
  "runId",
]);

/** Winston's key for the finished line (triple-beam). */
const MESSAGE = Symbol.for("message");

/** Where the format leaves the finished line for the database sink. */
export const LOG_LINE = Symbol("mobsimlab.logLine");

/** The shape of one written entry (JSON line). The database sink reads the same fields. */
export interface LogLine {
  time: string;
  level: string;
  severity: number;
  origin: LogOrigin;
  module?: string;
  message: string;
  requestId?: string;
  userId?: string;
  projectId?: string;
  runId?: string;
  context?: Record<string, unknown>;
}

/**
 * Purpose: turn a Winston entry into a LogLine: fill in the request context, redact, and keep the fixed fields
 * apart from the rest. Inputs: the Winston info object. Output: the line.
 */
export function toLogLine(info: winston.Logform.TransformableInfo): LogLine {
  const ctx = currentLogContext();
  const level = String(info.level) as LogLevel;
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(info)) {
    if (OWN_FIELDS.has(k) || v === undefined) continue;
    extra[k] = isSecretKey(k) ? REDACTED : redact(v);
  }
  const raw = info.message;
  const message =
    typeof raw === "string" ? raw : raw instanceof Error ? raw.message : (JSON.stringify(redact(raw)) ?? "");
  return {
    time: new Date().toISOString(),
    level: level.toUpperCase(),
    severity: SEVERITY[level] ?? 0,
    origin: (str(info.origin) as LogOrigin | undefined) ?? "backend",
    module: str(info.module),
    message: redactText(message),
    requestId: str(info.requestId) ?? ctx?.requestId,
    userId: str(info.userId) ?? ctx?.userId,
    projectId: str(info.projectId) ?? ctx?.projectId,
    runId: str(info.runId) ?? ctx?.runId,
    context: Object.keys(extra).length ? extra : undefined,
  };
}

/** Winston format: writes the entry as one JSON line and keeps the line on the entry for other sinks. */
const jsonLine = winston.format((info) => {
  const line = toLogLine(info);
  (info as Record<string | symbol, unknown>)[MESSAGE] = JSON.stringify(line);
  (info as Record<string | symbol, unknown>)[LOG_LINE] = line;
  return info;
});

/**
 * Purpose: create the application logger (ADR-0022): JSON lines with the request context, redacted, to the
 * console and a daily rotating file. The database sink is added by the logging module once the database is up.
 * Inputs: logging settings. Output: the logger.
 */
export function createLogger(config: LoggingConfig): AppLogger {
  const transports: winston.transport[] = [];
  if (config.console !== false) transports.push(new winston.transports.Console());
  if (config.dir) {
    transports.push(
      new DailyRotateFile({
        dirname: config.dir,
        filename: "api-%DATE%.log",
        datePattern: "YYYY-MM-DD",
        utc: true,
        maxFiles: `${FILE_RETENTION_DAYS}d`,
      }),
    );
  }
  const logger = winston.createLogger({
    levels: WINSTON_LEVELS,
    level: config.level,
    format: jsonLine(),
    transports,
    // A sink that fails must never stop the API.
    exitOnError: false,
  });
  // Winston needs at least one transport to be quiet about it; a silent one keeps the tests quiet.
  if (!transports.length) logger.add(new winston.transports.Console({ silent: true }));
  return logger as AppLogger;
}
