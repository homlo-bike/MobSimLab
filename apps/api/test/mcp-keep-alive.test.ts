import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { keepAlive } from "../src/agents/keep-alive";

let server: Server | undefined;
afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

/** A server that answers like the MCP transport (writeHead, then end) after `delayMs`. */
async function serve(delayMs: number, status = 200): Promise<string> {
  server = createServer((_req, res) => {
    keepAlive(res, 20);
    setTimeout(() => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }));
    }, delayMs);
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
}

describe("MCP keep-alive", () => {
  it("sends spaces while a slow call runs, and the body stays valid JSON", async () => {
    const res = await fetch(await serve(120));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(text.startsWith(" ")).toBe(true);
    expect(JSON.parse(text)).toEqual({ jsonrpc: "2.0", id: 1, result: { ok: true } });
  });

  it("leaves a quick answer untouched", async () => {
    const res = await fetch(await serve(0, 400));
    expect(res.status).toBe(400);
    expect((await res.text()).startsWith("{")).toBe(true);
  });
});
