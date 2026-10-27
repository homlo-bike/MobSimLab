import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp, testConfig } from "./support/app";

describe("GET /api/health", () => {
  it("returns ok without a session or database", async () => {
    const app = await createApp(testConfig());
    const res = await request(app.getHttpServer()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    await app.close();
  });
});
