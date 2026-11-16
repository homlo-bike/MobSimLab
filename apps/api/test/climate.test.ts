import { Test } from "@nestjs/testing";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { CalendarModule } from "../src/calendar/calendar.module";
import { NagerClient } from "../src/gateway/nager.client";
import { monthlyClimate, OpenMeteoClient, openMeteoSettings } from "../src/gateway/openmeteo.client";

/** Two years of daily temperatures: each month's mean is its number, max 5 °C above, min 5 °C below ±1. */
function daily() {
  const time: string[] = [];
  const mean: number[] = [];
  const max: number[] = [];
  const min: number[] = [];
  for (const y of [1991, 1992])
    for (let m = 1; m <= 12; m++)
      for (let d = 1; d <= 28; d++) {
        time.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
        mean.push(m);
        max.push(m + 5 + (d % 2 ? 1 : -1));
        min.push(m - 5 + (d % 2 ? 1 : -1));
      }
  return { time, temperature_2m_mean: mean, temperature_2m_max: max, temperature_2m_min: min };
}

function fakeOpenMeteo(fail: Set<number> = new Set()) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL) => {
    calls.push(String(url));
    if (fail.has(calls.length)) return new Response("busy", { status: 503 });
    return new Response(JSON.stringify({ latitude: 52.5, longitude: 13.4, daily: daily() }), { status: 200 });
  }) as typeof fetch;
  const client = new OpenMeteoClient({
    fetchImpl,
    sleep: async () => {},
    endpoint: "https://meteo.test/v1/archive",
    apiKey: null,
  });
  return { client, calls };
}

describe("Open-Meteo client", () => {
  it("takes the endpoint and key from the environment, https only", () => {
    expect(openMeteoSettings({})).toEqual({
      endpoint: "https://archive-api.open-meteo.com/v1/archive",
      apiKey: null,
    });
    expect(
      openMeteoSettings({
        MOBSIMLAB_OPENMETEO_URL: "https://customer-archive-api.open-meteo.com/v1/archive/",
        MOBSIMLAB_OPENMETEO_APIKEY: "k",
      }),
    ).toEqual({ endpoint: "https://customer-archive-api.open-meteo.com/v1/archive", apiKey: "k" });
    expect(() => openMeteoSettings({ MOBSIMLAB_OPENMETEO_URL: "http://meteo.example" })).toThrow();
  });

  it("works out each month's averages and spreads, skipping missing days", () => {
    const d = daily();
    const months = monthlyClimate(
      d.time,
      d.temperature_2m_mean.map((v, i) => (i === 0 ? null : v)),
      d.temperature_2m_max,
      d.temperature_2m_min,
    );
    expect(months).toHaveLength(12);
    expect(months[6]).toEqual({ mean_c: 7, max_c: 12, min_c: 2, max_sd_c: 1, min_sd_c: 1 });
    expect(() => monthlyClimate([], [], [], [])).toThrow();
  });

  it("rounds the place, asks for 1991–2020, retries a busy host and caches", async () => {
    const { client, calls } = fakeOpenMeteo(new Set([1]));
    const c = await client.climate(52.5213, 13.4049);
    expect(c).toMatchObject({ lat: 52.5, lon: 13.4, from_year: 1991, to_year: 2020 });
    expect(calls).toHaveLength(2);
    const u = new URL(calls[0]!);
    expect(u.searchParams.get("latitude")).toBe("52.5");
    expect(u.searchParams.get("start_date")).toBe("1991-01-01");
    expect(u.searchParams.get("end_date")).toBe("2020-12-31");
    expect(u.searchParams.has("apikey")).toBe(false);
    await client.climate(52.49, 13.41);
    expect(calls).toHaveLength(2);
    expect(() => client.climate(91, 0)).toThrow();
  });
});

describe("climate route", () => {
  it("serves the monthly climate with its source and licence", async () => {
    const { client } = fakeOpenMeteo();
    const mod = await Test.createTestingModule({ imports: [CalendarModule] })
      .overrideProvider(OpenMeteoClient)
      .useValue(client)
      .overrideProvider(NagerClient)
      .useValue({})
      .compile();
    const app = mod.createNestApplication();
    await app.init();
    const http = () => request(app.getHttpServer());
    const r = await http().get("/api/calendar/climate?lat=52.52&lon=13.40").expect(200);
    expect(r.body.months).toHaveLength(12);
    expect(r.body.source).toMatchObject({ name: "Open-Meteo", licence: "CC BY 4.0" });
    await http().get("/api/calendar/climate?lat=95&lon=0").expect(400);
    await http().get("/api/calendar/climate?lat=x&lon=0").expect(400);
    await app.close();
  });
});
