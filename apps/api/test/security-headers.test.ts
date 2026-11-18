import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Logger } from "@nestjs/common";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAP_ORIGINS } from "../src/app.setup";
import { createApp, testConfig } from "./support/app";

/** Security review (alpha release): headers, HTTPS redirect behind the proxy, and logged refusals. */
describe("security headers and HTTPS", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends the security headers and keeps API answers out of caches", async () => {
    const app = await createApp(testConfig());
    const res = await request(app.getHttpServer()).get("/api/health");
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers["content-security-policy"]).toContain("object-src 'none'");
    // The aerial basemap's tiles must be allowed, or the browser blocks them.
    expect(res.headers["content-security-policy"]).toContain(
      "connect-src 'self' data: https://tiles.openfreemap.org https://tiles.maps.eox.at https://gibs.earthdata.nasa.gov",
    );
    expect(res.headers["strict-transport-security"]).toMatch(/max-age=\d+/);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(res.headers["permissions-policy"]).toContain("camera=()");
    expect(res.headers["permissions-policy"]).toContain("geolocation=()");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });

  it("allows every tile server the web app's basemaps load from", () => {
    const src = readFileSync(join(__dirname, "..", "..", "web", "src", "map", "basemaps.ts"), "utf8");
    const used = [...src.matchAll(/(?:styleUrl: |tiles: \[)"(https:\/\/[^/"]+)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    for (const o of used) expect(MAP_ORIGINS).toContain(o);
  });

  it("gives the static viewer the same tile servers in its Cloudflare Pages headers", () => {
    const build = readFileSync(
      join(__dirname, "..", "..", "..", "tools", "static-site", "build.mjs"),
      "utf8",
    );
    expect(build).toContain(`const MAP_ORIGINS = "${MAP_ORIGINS.join(" ")}"`);
    expect(build).toContain("frame-ancestors 'none'");
  });

  it("never answers a cross-origin read with CORS headers", async () => {
    const app = await createApp(testConfig());
    const res = await request(app.getHttpServer())
      .options("/api/auth/me")
      .set("Origin", "https://evil.example")
      .set("Access-Control-Request-Method", "GET");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
    await app.close();
  });

  it("redirects plain http to https when a trusted proxy says so, and only then", async () => {
    const https = testConfig({
      publicUrl: new URL("https://plans.example.org"),
      trustedProxies: ["loopback"],
    });
    const app = await createApp(https);
    const viaProxy = await request(app.getHttpServer())
      .get("/projects/x?tab=1")
      .set("X-Forwarded-Proto", "http");
    expect(viaProxy.status).toBe(308);
    expect(viaProxy.headers.location).toBe("https://plans.example.org/projects/x?tab=1");
    // A path that looks like another host stays on this one.
    const sneaky = await request(app.getHttpServer())
      .get("//evil.example/x")
      .set("X-Forwarded-Proto", "http");
    expect(sneaky.headers.location).toBe("https://plans.example.org//evil.example/x");
    // Already https at the proxy, or no proxy at all (the container's health check): served as is.
    const secure = await request(app.getHttpServer()).get("/api/health").set("X-Forwarded-Proto", "https");
    expect(secure.status).toBe(200);
    expect((await request(app.getHttpServer()).get("/api/health")).status).toBe(200);
    await app.close();

    // Without trusted proxies, X-Forwarded-Proto means nothing (no redirect loops behind an unlisted proxy).
    const untrusted = await createApp(testConfig({ publicUrl: new URL("https://plans.example.org") }));
    const r = await request(untrusted.getHttpServer()).get("/api/health").set("X-Forwarded-Proto", "http");
    expect(r.status).toBe(200);
    await untrusted.close();

    // A trusted list that does not cover the proxy: the header is ignored, never a 308 to the same URL.
    const wrongList = await createApp(
      testConfig({ publicUrl: new URL("https://plans.example.org"), trustedProxies: ["10.9.8.7"] }),
    );
    for (const proto of ["https", "http"]) {
      const w = await request(wrongList.getHttpServer()).get("/api/health").set("X-Forwarded-Proto", proto);
      expect(w.status).toBe(200);
    }
    await wrongList.close();
  });

  it("logs refused cross-origin writes as security warnings, with the client address hashed", async () => {
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const app = await createApp(testConfig());
    const res = await request(app.getHttpServer())
      .post("/api/auth/logout")
      .set("Origin", "https://evil.example");
    expect(res.status).toBe(403);
    const lines = warn.mock.calls.map((c) => String(c[0]));
    const line = lines.find((l) => l.includes("cross-origin request"));
    expect(line).toContain("POST /api/auth/logout");
    expect(line).not.toContain("127.0.0.1");
    expect(line).toMatch(/client [0-9a-f]{32}/);
    await app.close();
  });
});
