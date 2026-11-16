// The browser build, named directly so the tests (which run under Node) use it too.
import pino from "pino/browser.js";
import type { LogEvent } from "pino";
import { redact } from "./redact";

/**
 * Browser logs (ADR-0022, FR-LOG-02, 03 §6): Pino's browser build. Entries of INFO and above are kept in a buffer
 * and sent to `POST /api/logs` every 10 seconds, or at once on ERROR and CRITICAL, while someone is signed in.
 * The API stores them like its own logs, with `origin` frontend. Fields are redacted here and again by the API.
 */

/** Levels, as the API names them. Pino's `fatal` is CRITICAL. */
export type WebLogLevel = "trace" | "debug" | "info" | "warn" | "error" | "critical";

/** One entry as `POST /api/logs` takes it (apps/api/src/logging/logs.controller.ts). */
export interface WebLogEntry {
  level: WebLogLevel;
  message: string;
  time: number;
  module?: string;
  projectId?: string;
  context?: Record<string, unknown>;
}

/** Milliseconds between sends. */
export const FLUSH_MS = 10_000;

/** Most entries in one request (the API's limit). */
const BATCH = 50;

/** Most entries held; older ones are dropped first. */
const MAX_BUFFER = 500;

/** Limits of the API's schema. */
const MAX_MESSAGE = 2000;
const MAX_CONTEXT = 4000;

let csrfToken: string | null = null;
let buffer: WebLogEntry[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Purpose: an entry for the API from a Pino log event. Strings become the message, objects the context;
 * `module` and `projectId` come from child logger bindings.
 */
export function toEntry(label: string, ev: LogEvent): WebLogEntry {
  const level: WebLogLevel = label === "fatal" ? "critical" : (label as WebLogLevel);
  const fields: Record<string, unknown> = {};
  for (const b of ev.bindings) Object.assign(fields, b);
  const words: string[] = [];
  for (const m of ev.messages) {
    if (m instanceof Error) fields.error = m;
    else if (m !== null && typeof m === "object") Object.assign(fields, m);
    else if (m !== undefined) words.push(String(m));
  }
  // Errors keep a short stack, so they fit the API's context limit.
  for (const [k, v] of Object.entries(fields)) {
    if (v instanceof Error)
      fields[k] = { name: v.name, message: v.message, stack: (v.stack ?? "").slice(0, 1500) };
  }
  const { module, projectId, ...rest } = fields;
  let context = Object.keys(rest).length ? (redact(rest) as Record<string, unknown>) : undefined;
  if (context && JSON.stringify(context).length > MAX_CONTEXT) context = { truncated: true };
  return {
    level,
    message: String(redact(words.join(" "))).slice(0, MAX_MESSAGE),
    time: ev.ts,
    module: typeof module === "string" ? module.slice(0, 100) : undefined,
    projectId: typeof projectId === "string" ? projectId : undefined,
    context,
  };
}

/** Purpose: add an entry to the buffer and plan the next send. */
function enqueue(entry: WebLogEntry): void {
  if (!csrfToken) return;
  buffer.push(entry);
  if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);
  if (entry.level === "error" || entry.level === "critical") void flushLogs();
  else timer ??= setTimeout(() => void flushLogs(), FLUSH_MS);
}

/**
 * Purpose: send the buffered entries now. Never throws: entries that cannot be sent are dropped, and a failure
 * is not logged (that would only fill the buffer again).
 */
export async function flushLogs(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  const token = csrfToken;
  const entries = buffer.splice(0);
  if (!token) return;
  for (let i = 0; i < entries.length; i += BATCH) {
    try {
      await fetch("/api/logs", {
        method: "POST",
        credentials: "same-origin",
        // keepalive lets the last batch go out while the page closes.
        keepalive: true,
        headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
        body: JSON.stringify({ entries: entries.slice(i, i + BATCH) }),
      });
    } catch {
      // Offline or the API is away: drop these entries.
    }
  }
}

/**
 * Purpose: tell the logger who is signed in. With a CSRF token, entries are sent; without one (signed out),
 * nothing is sent and waiting entries are dropped.
 */
export function setLogSession(token: string | null): void {
  csrfToken = token;
  if (!token) {
    buffer = [];
    if (timer) clearTimeout(timer);
    timer = null;
  }
}

const base = pino({
  level: "info",
  browser: {
    asObject: true,
    transmit: { level: "info", send: (level, ev) => enqueue(toEntry(level, ev)) },
  },
});

/** A logger with the MobSimLab level names. */
export interface WebLogger {
  trace(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  critical(...args: unknown[]): void;
}

/**
 * Purpose: a logger for one part of the web app.
 * Inputs: module name (and optionally the open project). Output: the logger.
 */
export function getLogger(module: string, projectId?: string): WebLogger {
  const l = base.child(projectId ? { module, projectId } : { module });
  const call =
    (fn: (...a: never[]) => void) =>
    (...args: unknown[]) =>
      (fn as (...a: unknown[]) => void).apply(l, args);
  return {
    trace: call(l.trace),
    debug: call(l.debug),
    info: call(l.info),
    warn: call(l.warn),
    error: call(l.error),
    critical: call(l.fatal),
  };
}

/**
 * Purpose: log errors nothing else caught (uncaught exceptions and unhandled promise rejections) as ERROR, and
 * send what is waiting when the page is hidden or closed. Call once at start-up.
 */
export function logUncaughtErrors(target: Window = window): void {
  const log = getLogger("web");
  target.addEventListener("error", (e: ErrorEvent) => {
    log.error(
      { error: e.error ?? undefined, source: e.filename, line: e.lineno },
      e.message || "uncaught error",
    );
  });
  target.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    const reason: unknown = e.reason;
    log.error({ error: reason instanceof Error ? reason : String(reason) }, "unhandled promise rejection");
  });
  target.addEventListener("pagehide", () => void flushLogs());
}
