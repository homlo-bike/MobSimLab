import { Test } from "@nestjs/testing";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { geocoderEndpoint, PhotonClient, toPlace } from "../src/gateway/photon.client";
import { PlacesModule } from "../src/places/places.module";

const ZURICH = {
  type: "Feature",
  geometry: { type: "Point", coordinates: [8.5417, 47.3769] },
  properties: {
    name: "Zürich",
    state: "Zürich",
    country: "Switzerland",
    osm_key: "place",
    osm_value: "city",
    extent: [8.448, 47.4348, 8.6254, 47.3202],
  },
};
const HB = {
  type: "Feature",
  geometry: { type: "Point", coordinates: [8.5403, 47.3779] },
  properties: {
    name: "Zürich HB",
    street: "Bahnhofplatz",
    city: "Zürich",
    country: "Switzerland",
    osm_key: "railway",
    osm_value: "station",
  },
};

/** A fake Photon answering every search with the two places; counts requests. */
function fakePhoton(status = 200) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL) => {
    calls.push(String(url));
    if (status !== 200) return new Response("busy", { status });
    return new Response(JSON.stringify({ type: "FeatureCollection", features: [ZURICH, HB, { bad: 1 }] }), {
      status: 200,
    });
  }) as typeof fetch;
  const client = new PhotonClient({ fetchImpl, sleep: async () => {}, endpoint: "https://photon.test" });
  return { client, calls };
}

describe("Photon client", () => {
  it("reads places, areas with their box and points without", () => {
    expect(toPlace(ZURICH)).toEqual({
      name: "Zürich",
      context: "Switzerland",
      kind: "place/city",
      lonLat: [8.5417, 47.3769],
      bbox: [8.448, 47.3202, 8.6254, 47.4348],
    });
    expect(toPlace(HB)).toMatchObject({ context: "Bahnhofplatz, Zürich, Switzerland", bbox: null });
    expect(toPlace({ geometry: { type: "Point", coordinates: [0, 0] }, properties: {} })).toBeNull();
  });

  it("asks once per search, near the map centre, in the reader's language where Photon has it", async () => {
    const { client, calls } = fakePhoton();
    expect(await client.search("zurich", { lang: "de-CH", near: [8.5, 47.4] })).toHaveLength(2);
    await client.search("zurich", { lang: "de-CH", near: [8.5, 47.4] });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("lang=de");
    expect(calls[0]).toContain("lat=47.400");
    await client.search("zurich", { lang: "ja" });
    expect(calls[1]).not.toContain("lang=");
    expect(await client.search("   ")).toEqual([]);
  });

  it("retries once when the service is busy, then gives up", async () => {
    const { client, calls } = fakePhoton(503);
    await expect(client.search("zurich")).rejects.toMatchObject({ status: 502 });
    expect(calls).toHaveLength(2);
  });

  it("accepts only an https endpoint", () => {
    expect(geocoderEndpoint({})).toBe("https://photon.komoot.io");
    expect(geocoderEndpoint({ MOBSIMLAB_GEOCODER_URL: "https://geo.example/" })).toBe("https://geo.example");
    expect(() => geocoderEndpoint({ MOBSIMLAB_GEOCODER_URL: "http://geo.example" })).toThrow();
  });
});

describe("place search route", () => {
  it("answers places with their source and refuses bad queries", async () => {
    const { client } = fakePhoton();
    const mod = await Test.createTestingModule({ imports: [PlacesModule] })
      .overrideProvider(PhotonClient)
      .useValue(client)
      .compile();
    const app = mod.createNestApplication();
    await app.init();
    const http = () => request(app.getHttpServer());
    const r = await http().get("/api/places/search?q=zurich&lon=8.5&lat=47.4").expect(200);
    expect(r.body.places.map((p: { name: string }) => p.name)).toEqual(["Zürich", "Zürich HB"]);
    expect(r.body.source.licence).toContain("OpenStreetMap");
    await http().get("/api/places/search?q=z").expect(400);
    await http().get("/api/places/search?q=zurich&lat=95").expect(400);
    await app.close();
  });

  it("passes an unavailable service on as 502", async () => {
    const { client } = fakePhoton(500);
    const mod = await Test.createTestingModule({ imports: [PlacesModule] })
      .overrideProvider(PhotonClient)
      .useValue(client)
      .compile();
    const app = mod.createNestApplication();
    await app.init();
    await request(app.getHttpServer()).get("/api/places/search?q=zurich").expect(502);
    await app.close();
  });
});
