import { Test } from "@nestjs/testing";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";

describe("GET /api/health", () => {
  it("returns ok", async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = mod.createNestApplication();
    await app.init();
    const res = await request(app.getHttpServer()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
    await app.close();
  });
});
