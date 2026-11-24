import compression from "compression";
import type { Request, RequestHandler, Response } from "express";

/** Responses smaller than this are sent as they are: compressing them saves less than it costs. */
const THRESHOLD_BYTES = 1024;

/**
 * Purpose: whether a response is compressed. The app's files, the drawings and other JSON are; these are not:
 *  - `/mcp`: long agent calls send a space every few seconds to keep the connection open (agents/keep-alive.ts),
 *    which compression would hold back until the answer is complete;
 *  - `/api/auth/me`: it carries the CSRF token, and a secret compressed together with text an attacker can choose
 *    could be guessed from the response size (BREACH);
 *  - responses that are already compressed or binary: saved results (gzip), project and plugin files, images;
 *  - live streams (`text/event-stream`).
 * Inputs: the request and its response, with its headers set.
 */
export function shouldCompress(req: Request, res: Response): boolean {
  const path = req.path;
  if (path === "/mcp" || path.startsWith("/mcp/") || path === "/api/auth/me") return false;
  const type = (String(res.getHeader("Content-Type") ?? "").split(";")[0] ?? "").trim().toLowerCase();
  if (!type || type === "application/octet-stream" || type === "text/event-stream") return false;
  if (/^(image|video|audio|font)\//.test(type) && type !== "image/svg+xml") return false;
  if (/zip|gzip|protobuf|pdf/.test(type)) return false;
  return compression.filter(req, res);
}

/**
 * Purpose: middleware that gzip- or Brotli-compresses responses the browser accepts compressed, so large drawings
 * (several MB of JSON for a city network), the app's scripts and its WebAssembly engines download about 5 to 10
 * times smaller.
 */
export function compressResponses(): RequestHandler {
  return compression({ filter: shouldCompress, threshold: THRESHOLD_BYTES });
}
