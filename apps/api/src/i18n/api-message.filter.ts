import { type ArgumentsHost, Catch, HttpException, HttpStatus, Logger } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import { API_MESSAGES } from "./messages";

/** A message of the API for the app: a key of {@link API_MESSAGES} and the values of its placeholders. */
export interface ApiMsg {
  key: string;
  args?: Record<string, string>;
}

const EXACT = new Map<string, string>();
const PATTERNS: { key: string; re: RegExp; names: string[] }[] = [];
for (const [key, text] of Object.entries(API_MESSAGES)) {
  const names = [...text.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]!);
  if (!names.length) {
    EXACT.set(text, key);
    continue;
  }
  const source = text
    .split(/\{[A-Za-z0-9_]+\}/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("(.+?)");
  PATTERNS.push({ key, re: new RegExp(`^${source}$`, "s"), names });
}
// The most specific texts first, so a short pattern does not take a longer text's message.
PATTERNS.sort((a, b) => b.re.source.length - a.re.source.length);

/**
 * Purpose: the message key and values of an English API error text.
 * Output: null for a text that is not in {@link API_MESSAGES} (it is shown in English).
 */
export function apiMsgOf(text: string): ApiMsg | null {
  const key = EXACT.get(text);
  if (key) return { key };
  for (const p of PATTERNS) {
    const m = p.re.exec(text);
    if (m) return { key: p.key, args: Object.fromEntries(p.names.map((n, i) => [n, m[i + 1]!])) };
  }
  return null;
}

/**
 * Adds `msg` to HTTP error responses whose `message` is a known English text, so the app can show it in its
 * language. Everything else about the response, and every other error, is left as it is.
 * Refused input (400) is also logged as a warning with the route and the reason, so an operator can see why the
 * app could not save something; the request body is never logged.
 */
@Catch()
export class ApiMessageFilter extends BaseExceptionFilter {
  private readonly log = new Logger("http");

  override catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof HttpException && exception.getStatus() === HttpStatus.BAD_REQUEST)
      this.log.warn(badRequestLine(exception, host));
    super.catch(exception instanceof HttpException ? withMsg(exception) : exception, host);
  }
}

/** Purpose: one log line for a refused request: method, path without the query, and the reason given. */
export function badRequestLine(e: HttpException, host: ArgumentsHost): string {
  const req =
    host.getType() === "http"
      ? host.switchToHttp().getRequest<{ method?: string; originalUrl?: string; url?: string }>()
      : null;
  const path = (req?.originalUrl ?? req?.url ?? "").split("?")[0]!.slice(0, 200);
  const body = e.getResponse();
  const raw = typeof body === "string" ? body : (body as { message?: unknown }).message;
  const reason = (Array.isArray(raw) ? raw.join("; ") : typeof raw === "string" ? raw : e.message).slice(
    0,
    300,
  );
  return `400 ${req?.method ?? "?"} ${path}: ${reason}`;
}

/** Purpose: the exception with `msg` in its response body when its message is known. */
export function withMsg(e: HttpException): HttpException {
  const body = e.getResponse();
  const obj: Record<string, unknown> =
    typeof body === "string" ? { statusCode: e.getStatus(), message: body } : { ...(body as object) };
  if (obj.msg !== undefined || typeof obj.message !== "string") return e;
  const msg = apiMsgOf(obj.message);
  if (!msg) return e;
  return new HttpException({ ...obj, msg }, e.getStatus(), { cause: e });
}
