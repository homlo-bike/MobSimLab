import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/** Fields every log entry of one request carries (03 §6). */
export interface LogContext {
  requestId: string;
  /** Internal user ID (pseudonymous: no name or e-mail). */
  userId?: string;
  projectId?: string;
  runId?: string;
}

const storage = new AsyncLocalStorage<LogContext>();

/** Purpose: the context of the request being handled, if any. */
export function currentLogContext(): LogContext | undefined {
  return storage.getStore();
}

/**
 * Purpose: add fields to the current request's context (the access guard adds the user, project and run).
 * Side effects: changes the context every later log entry of this request reads. Does nothing outside a request.
 */
export function addToLogContext(fields: Partial<Omit<LogContext, "requestId">>): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  for (const [k, v] of Object.entries(fields))
    if (v !== undefined) (ctx as unknown as Record<string, string>)[k] = v;
}

/**
 * Purpose: Express middleware that gives each request a new request ID and a log context for everything it
 * runs. Registered after the body parsers, so the context reaches the route handlers.
 */
export function requestLogContext(_req: Request, _res: Response, next: NextFunction): void {
  storage.run({ requestId: randomUUID() }, next);
}
