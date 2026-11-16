import { Test } from "@nestjs/testing";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { CalendarModule } from "../src/calendar/calendar.module";
import { NagerClient, NagerError, nagerEndpoint } from "../src/gateway/nager.client";

const DE_2027 = [
  {
    date: "2027-01-01",
    localName: "Neujahr",
    name: "New Year's Day",
    global: true,
    counties: null,
    types: ["Public"],
  },
  {
    date: "2027-01-06",
    localName: "Heilige Drei Könige",
    name: "Epiphany",
    global: false,
    counties: ["DE-BW", "DE-BY"],
    types: ["Public"],
  },
  {
    date: "2027-12-24",
    localName: "Heiligabend",
    name: "Christmas Eve",
    global: true,
    counties: null,
    types: ["Observance"],
  },
  {
    date: "2027-03-26",
    localName: "Karfreitag",
    name: "Good Friday",
    global: true,
    counties: null,
    types: ["Public"],
  },
];

/** A fake Nager.Date host; counts requests and fails the ones listed. */
function fakeNager(fail: Set<number> = new Set()) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL) => {
    const u = String(url);
    calls.push(u);
    if (fail.has(calls.length)) return new Response("busy", { status: 503 });
    if (u.endsWith("/PublicHolidays/2027/DE"))
      return new Response(JSON.stringify(DE_2027), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    if (u.endsWith("/PublicHolidays/2027/ZZ")) return new Response(null, { status: 404 });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  const client = new NagerClient({ fetchImpl, sleep: async () => {}, endpoint: "https://nager.test/api/v3" });
  return { client, calls };
}

describe("Nager.Date client", () => {
  it("accepts only https endpoints", () => {
    expect(nagerEndpoint({})).toBe("https://date.nager.at/api/v3");
    expect(nagerEndpoint({ MOBSIMLAB_NAGER_URL: "https://mirror.example/api/v3/" })).toBe(
      "https://mirror.example/api/v3",
    );
    expect(() => nagerEndpoint({ MOBSIMLAB_NAGER_URL: "http://mirror.example" })).toThrow();
  });

  it("keeps public days off, sorted, with their regions, and caches them", async () => {
    const { client, calls } = fakeNager();
    const days = await client.holidays("de", 2027);
    expect(days.map((d) => d.date)).toEqual(["2027-01-01", "2027-01-06", "2027-03-26"]);
    expect(days[0]).toEqual({
      date: "2027-01-01",
      localName: "Neujahr",
      name: "New Year's Day",
      regions: null,
    });
    expect(days[1]!.regions).toEqual(["DE-BW", "DE-BY"]);
    await client.holidays("DE", 2027);
    expect(calls).toHaveLength(1);
  });

  it("retries a busy host and tells unknown countries apart", async () => {
    const { client, calls } = fakeNager(new Set([1]));
    expect(await client.holidays("DE", 2027)).toHaveLength(3);
    expect(calls).toHaveLength(2);
    await expect(client.holidays("ZZ", 2027)).rejects.toMatchObject({ status: 404 });
    await expect(client.holidays("XY", 2027)).rejects.toMatchObject({ status: 404 });
    expect(() => client.holidays("DEU", 2027)).toThrow(NagerError);
    expect(() => client.holidays("DE", 1800)).toThrow(NagerError);
  });
});

describe("calendar routes", () => {
  it("serve a country's public holidays of a year", async () => {
    const { client } = fakeNager();
    const mod = await Test.createTestingModule({ imports: [CalendarModule] })
      .overrideProvider(NagerClient)
      .useValue(client)
      .compile();
    const app = mod.createNestApplication();
    await app.init();
    const http = () => request(app.getHttpServer());
    const de = await http().get("/api/calendar/holidays?country=de&year=2027").expect(200);
    expect(de.body).toMatchObject({ country: "DE", year: 2027, source: { name: "Nager.Date" } });
    expect(de.body.holidays).toHaveLength(3);
    await http().get("/api/calendar/holidays?country=ZZ&year=2027").expect(404);
    await http().get("/api/calendar/holidays?country=DEU&year=2027").expect(400);
    await http().get("/api/calendar/holidays?country=DE&year=99").expect(400);
    await app.close();
  });
});
