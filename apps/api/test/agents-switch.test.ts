import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp, testConfig } from "./support/app";

/** Desktop local mode starts with AI agents switched off: the MCP and OAuth endpoints do not exist. */
describe("AI agents switch", () => {
  it("answers 404 on the agent endpoints when agents are switched off", async () => {
    const app = await createApp(testConfig({ agentsDisabled: true }));
    try {
      for (const path of [
        "/mcp",
        "/oauth/token",
        "/.well-known/oauth-protected-resource/mcp",
        "/.well-known/oauth-authorization-server",
      ]) {
        const res = await request(app.getHttpServer()).post(path).set("Origin", "http://127.0.0.1:8080");
        expect(res.status, path).toBe(404);
      }
      expect((await request(app.getHttpServer()).get("/.well-known/oauth-protected-resource")).status).toBe(
        404,
      );
    } finally {
      await app.close();
    }
  });

  it("keeps the agent endpoints when agents are on", async () => {
    const app = await createApp(testConfig());
    try {
      const res = await request(app.getHttpServer()).post("/mcp");
      expect(res.status).toBe(401);
    } finally {
      await app.close();
    }
  });
});
