import type { ServerResponse } from "node:http";

/** How often a long MCP call sends a byte, ms. Reverse proxies end an upstream that sends nothing for 60 s. */
export const KEEP_ALIVE_MS = 15_000;

/**
 * Purpose: keep a long JSON-RPC answer (an analysis tool that runs for minutes) from being cut by a reverse proxy's
 * read timeout, which otherwise answers the agent with an HTML 504 and may drop the call half done. If the answer
 * is not under way after `everyMs`, the response is committed as `200 application/json` and a space is sent every
 * `everyMs` until the real answer is written; JSON allows leading white space, so the agent reads the same answer.
 * Tool results (errors included) are always 200 in MCP, so committing to 200 changes nothing the agent sees.
 * Inputs: the Node response; the interval (tests use a short one).
 * Output: a function that stops the heartbeat. Side effects: writes to the response; once committed, later
 * `writeHead` calls (the transport's own) are ignored, and the body follows the spaces.
 */
export function keepAlive(res: ServerResponse, everyMs = KEEP_ALIVE_MS): () => void {
  let committed = false;
  const timer = setInterval(() => {
    if (res.writableEnded || res.destroyed) return stop();
    if (!committed) {
      if (res.headersSent) return stop();
      committed = true;
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        // Nginx: pass the spaces on as they come.
        "X-Accel-Buffering": "no",
      });
      res.writeHead = (() => res) as unknown as ServerResponse["writeHead"];
    }
    res.write(" ");
  }, everyMs);
  const stop = () => clearInterval(timer);
  res.on("close", stop);
  res.on("finish", stop);
  return stop;
}
