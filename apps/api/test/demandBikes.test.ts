import { describe, expect, it } from "vitest";
import {
  GbfsClient,
  GbfsError,
  gbfsStations,
  gbfsUrlAllowed,
  stationInformationUrl,
} from "../src/gateway/gbfs.client";
import { bikeAccess, bikeAccessQuery } from "../src/street-network/street-network.service";

const feed = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, text: async () => JSON.stringify(body) }) as unknown as Response;

describe("bike parkings and shared-bike stations from OpenStreetMap", () => {
  it("asks for both amenities with their centre", () => {
    const q = bikeAccessQuery(14, 8580, 5738);
    expect(q).toContain('"amenity"="bicycle_parking"');
    expect(q).toContain('"amenity"="bicycle_rental"');
    expect(q).toContain("out tags center");
  });

  it("keeps public parkings and stations, not private ones or shops that hire bikes", () => {
    const json = JSON.stringify({
      elements: [
        { type: "node", id: 1, lat: 47.1, lon: 8.1, tags: { amenity: "bicycle_parking" } },
        { type: "way", id: 2, center: { lat: 47.2, lon: 8.2 }, tags: { amenity: "bicycle_rental" } },
        { type: "node", id: 3, lat: 47.3, lon: 8.3, tags: { amenity: "bicycle_parking", access: "private" } },
        {
          type: "node",
          id: 4,
          lat: 47.4,
          lon: 8.4,
          tags: { amenity: "bicycle_rental", bicycle_rental: "shop" },
        },
        { type: "node", id: 5, tags: { amenity: "bicycle_parking" } },
      ],
    });
    expect(bikeAccess(json)).toEqual({ parking: [[8.1, 47.1]], rental: [[8.2, 47.2]] });
  });
});

describe("GBFS feeds", () => {
  it("reads only https addresses of public servers", () => {
    expect(gbfsUrlAllowed("https://gbfs.example.com/gbfs.json")).toBe(true);
    for (const bad of [
      "http://gbfs.example.com/gbfs.json",
      "https://127.0.0.1/gbfs.json",
      "https://[::1]/gbfs.json",
      "https://localhost/gbfs.json",
      "https://metadata/computeMetadata",
      "https://bikes.corp/gbfs.json",
      "https://user:pw@gbfs.example.com/gbfs.json",
      "not a url",
    ])
      expect(gbfsUrlAllowed(bad)).toBe(false);
  });

  it("finds station_information in version 2 (by language) and version 3 feeds", () => {
    const v2 = {
      data: { en: { feeds: [{ name: "station_information", url: "https://x.example/si.json" }] } },
    };
    const v3 = { data: { feeds: [{ name: "station_information", url: "https://y.example/si.json" }] } };
    expect(stationInformationUrl(v2)).toBe("https://x.example/si.json");
    expect(stationInformationUrl(v3)).toBe("https://y.example/si.json");
    expect(stationInformationUrl({ data: { feeds: [] } })).toBeNull();
  });

  it("reads the stations and skips those without a usable place", () => {
    const si = {
      data: { stations: [{ lat: 47.1, lon: 8.1 }, { lat: "47.2", lon: "8.2" }, { lat: 99, lon: 1 }, {}] },
    };
    expect(gbfsStations(si)).toEqual([
      [8.1, 47.1],
      [8.2, 47.2],
    ]);
    expect(() => gbfsStations({ data: {} })).toThrow(GbfsError);
  });

  it("follows the auto-discovery file to the stations, without redirects", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const client = new GbfsClient({
      fetchImpl: (async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return url.endsWith("gbfs.json")
          ? feed({ data: { feeds: [{ name: "station_information", url: "https://g.example/si.json" }] } })
          : feed({ data: { stations: [{ lat: 47, lon: 8 }] } });
      }) as typeof fetch,
    });
    await expect(client.stations("https://g.example/gbfs.json")).resolves.toEqual([[8, 47]]);
    expect(calls.map((c) => c.url)).toEqual(["https://g.example/gbfs.json", "https://g.example/si.json"]);
    expect(calls[0]!.init?.redirect).toBe("error");
  });

  it("says why a feed cannot be read", async () => {
    const notFound = new GbfsClient({ fetchImpl: (async () => feed({}, 404)) as typeof fetch });
    await expect(notFound.stations("https://g.example/gbfs.json")).rejects.toThrow("answered 404");
    const internal = new GbfsClient({
      fetchImpl: (async () =>
        feed({
          data: { feeds: [{ name: "station_information", url: "https://10.0.0.1/si.json" }] },
        })) as typeof fetch,
    });
    await expect(internal.stations("https://g.example/gbfs.json")).rejects.toThrow("public server");
  });
});
