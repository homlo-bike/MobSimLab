import { request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gunzipSync } from "node:zlib";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { keepAlive } from "../src/agents/keep-alive";
import { compressResponses } from "../src/compress";

const BIG = JSON.stringify({ lines: Array.from({ length: 2000 }, (_, i) => ({ id: i, name: `Line ${i}` })) });

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(compressResponses());
  app.get("/api/projects/x/drawings", (_req, res) => {
    res.type("application/json").send(BIG);
  });
  app.get("/api/projects/x/small", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/api/auth/me", (_req, res) => {
    res.type("application/json").send(BIG);
  });
  app.get("/api/projects/x/results/noise", (_req, res) => {
    res.type("application/octet-stream").send(Buffer.from(BIG));
  });
  app.get("/assets/engine.wasm", (_req, res) => {
    res.type("application/wasm").send(Buffer.alloc(50_000, 7));
  });
  app.post("/mcp", (_req, res) => {
    keepAlive(res, 20);
    setTimeout(() => res.end(BIG), 120);
  });
  server = await new Promise<Server>((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((done) => server.close(() => done())));

/** A raw request (no automatic decompression): its status, Content-Encoding and body bytes. */
function get(path: string, method = "GET", encoding = "gzip"): Promise<{ enc?: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${base}${path}`, { method, headers: { "Accept-Encoding": encoding } }, (res) => {
      const parts: Buffer[] = [];
      res.on("data", (c: Buffer) => parts.push(c));
      res.on("end", () =>
        resolve({ enc: res.headers["content-encoding"] as string | undefined, body: Buffer.concat(parts) }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

describe("response compression", () => {
  it("compresses large JSON such as drawings", async () => {
    const r = await get("/api/projects/x/drawings");
    expect(r.enc).toBe("gzip");
    expect(r.body.length).toBeLessThan(BIG.length / 4);
    expect(gunzipSync(r.body).toString()).toBe(BIG);
  });

  it("compresses the app's WebAssembly engines", async () => {
    expect((await get("/assets/engine.wasm")).enc).toBe("gzip");
  });

  it("sends uncompressed when the browser does not accept it", async () => {
    const r = await get("/api/projects/x/drawings", "GET", "identity");
    expect(r.enc).toBeUndefined();
    expect(r.body.toString()).toBe(BIG);
  });

  it("leaves small answers, saved results and the session answer as they are", async () => {
    expect((await get("/api/projects/x/small")).enc).toBeUndefined();
    expect((await get("/api/projects/x/results/noise")).enc).toBeUndefined();
    expect((await get("/api/auth/me")).enc).toBeUndefined();
  });

  it("does not hold back the MCP keep-alive spaces", async () => {
    const r = await get("/mcp", "POST");
    expect(r.enc).toBeUndefined();
    const text = r.body.toString();
    expect(text.startsWith(" ")).toBe(true);
    expect(JSON.parse(text)).toEqual(JSON.parse(BIG));
  });
});
