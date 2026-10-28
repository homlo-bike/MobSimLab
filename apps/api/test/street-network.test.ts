import { Test } from "@nestjs/testing";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { OverpassClient, overpassEndpoint } from "../src/gateway/overpass.client";
import { streetQuery, tileBbox } from "../src/street-network/street-network.service";
import { StreetNetworkModule } from "../src/street-network/street-network.module";

const XML = '<osm version="0.6"><node id="1" lat="50" lon="7"/></osm>';

function client(responses: Array<number | string>) {
  const fetchImpl = vi.fn(async () => {
    const r = responses.shift();
    return typeof r === "number" ? new Response("busy", { status: r }) : new Response(r ?? XML);
  });
  return {
    fetchImpl,
    c: new OverpassClient({ fetchImpl, sleep: async () => {}, minIntervalMs: 0, backoffMs: [1, 1] }),
  };
}

describe("street tiles", () => {
  it("computes tile bounds", () => {
    const [s, w, n, e] = tileBbox(14, 8508, 5489); // Köln
    expect(w).toBeCloseTo(6.9434, 3);
    expect(e - w).toBeCloseTo(360 / 2 ** 14, 9);
    expect(n).toBeGreaterThan(s);
    expect(s).toBeGreaterThan(50.9);
  });

  it("asks only for roads and their turn restrictions", () => {
    const q = streetQuery(14, 8508, 5489);
    expect(q).toContain('way["highway"~"^(motorway|');
    expect(q).toContain('rel(bw.w)["type"="restriction"]');
    expect(q).not.toContain('"building"');
  });

  it("serves a tile, caches it, and rejects invalid tiles", async () => {
    const { fetchImpl, c } = client([XML]);
    const mod = await Test.createTestingModule({ imports: [StreetNetworkModule] })
      .overrideProvider(OverpassClient)
      .useValue(c)
      .compile();
    const app = mod.createNestApplication();
    await app.init();
    const ok = await request(app.getHttpServer()).get("/api/street-network/tiles/14/8508/5489");
    expect(ok.status).toBe(200);
    expect(ok.headers["content-type"]).toContain("application/xml");
    expect(ok.text).toBe(XML);
    await request(app.getHttpServer()).get("/api/street-network/tiles/14/8508/5489").expect(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await request(app.getHttpServer()).get("/api/street-network/tiles/14/99999/1").expect(400);
    await request(app.getHttpServer()).get("/api/street-network/tiles/14/-1/1").expect(400);
    await app.close();
  });

  it("retries busy answers and gives up with 502", async () => {
    const ok = client([429, 504, XML]);
    await expect(ok.c.run("q")).resolves.toBe(XML);
    expect(ok.fetchImpl).toHaveBeenCalledTimes(3);
    const bad = client([503, 503, 503]);
    await expect(bad.c.run("q")).rejects.toMatchObject({ status: 502 });
    const notFound = client([400]);
    await expect(notFound.c.run("q")).rejects.toMatchObject({ status: 502 });
    expect(notFound.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("only accepts an https Overpass endpoint", () => {
    expect(overpassEndpoint({})).toContain("https://");
    expect(() => overpassEndpoint({ MOBSIMLAB_OVERPASS_URL: "http://example.org/api" })).toThrow();
  });
});
