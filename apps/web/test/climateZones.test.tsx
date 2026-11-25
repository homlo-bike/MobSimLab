import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AreaPolygon } from "../src/features/area/api";
import { weatherPeriods } from "../src/features/calendar-run/model";
import { variantShares, weatherSettings } from "../src/features/calendar-run/weather";
import { JobsBar, JobsProvider } from "../src/shell/jobs";
import type { FetchedClimate, MonthClimate, ProjectClimate } from "../src/workspace/climate";
import { ClimateKeeper } from "../src/workspace/ClimateKeeper";
import { ClimateSection } from "../src/workspace/ClimateSection";
import {
  climateZones,
  MAX_ZONES,
  sameZones,
  weightedClimates,
  withZonePlaces,
  zoneShares,
} from "../src/workspace/climateZones";
import type { PreferencesDoc } from "../src/workspace/preferences";

afterEach(cleanup);

const box = (id: string, name: string, w: number, s: number, e: number, n: number): AreaPolygon => ({
  id,
  name,
  detail: "full",
  ring: [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
    [w, s],
  ],
});
/** A city: about 20 km across. */
const city = box("a1", "Berlin", 13.2, 52.4, 13.6, 52.6);
/** A country: about 4° by 4°. */
const country = box("a2", "Syria", 36, 32.5, 40, 36.5);

/** Twelve months with the same lows and highs, the coast mild and the desert hot. */
const months = (max: number, min: number): MonthClimate[] =>
  Array.from({ length: 12 }, () => ({
    mean_c: (max + min) / 2,
    max_c: max,
    min_c: min,
    max_sd_c: 3,
    min_sd_c: 3,
  }));
const fetched = (lat: number, lon: number, m: MonthClimate[]): FetchedClimate => ({
  lat,
  lon,
  from_year: 1991,
  to_year: 2020,
  months: m,
});

describe("climate zones of a project area", () => {
  it("keeps one climate for a city", () => {
    expect(climateZones([city])).toHaveLength(1);
    expect(withZonePlaces({}, climateZones([city])).zones).toBeUndefined();
  });

  it("gives each polygon its zone, and splits a large polygon into parts of about 100 km", () => {
    const zones = climateZones([city, country]);
    expect(zones[0]).toMatchObject({ id: "a1", name: "Berlin", at: [13.4, 52.5] });
    const parts = zones.filter((z) => z.id.startsWith("a2-"));
    // 4° of latitude in 1° rows; 4° of longitude at 34.5° N in cells of about 1.2°.
    expect(parts.length).toBeGreaterThanOrEqual(12);
    expect(parts[0]!.name).toBe("Syria 1");
    expect(zones.every((z) => z.at[0] === Math.round(z.at[0] * 10) / 10)).toBe(true);
  });

  it("follows a corridor along a route", () => {
    // A strip 0.1° wide along 3° of longitude: no cell centre falls inside it.
    const corridor = box("a3", "Coast line", 35, 34.0, 38, 34.1);
    const zones = climateZones([corridor]);
    expect(zones.length).toBeGreaterThan(1);
    expect(zones.every((z) => z.at[1] >= 34 && z.at[1] <= 34.1)).toBe(true);
  });

  it("keeps to the most zones a project may have", () => {
    const continent = box("a4", "Continent", 0, 30, 40, 60);
    expect(climateZones([continent]).length).toBeLessThanOrEqual(MAX_ZONES);
  });

  it("keeps a zone's climate and own values when the zones are worked out again", () => {
    const places = climateZones([city, country]);
    const c = withZonePlaces({}, places);
    c.zones![0] = {
      ...c.zones![0]!,
      fetched: fetched(52.5, 13.4, months(20, 10)),
      own: { "7": { max_c: 33 } },
    };
    expect(sameZones(c, places)).toBe(true);
    const again = withZonePlaces(c, places);
    expect(again.zones![0]!.own).toEqual({ "7": { max_c: 33 } });
    expect(sameZones(again, climateZones([city]))).toBe(false);
    expect(withZonePlaces(again, climateZones([city])).zones).toBeUndefined();
  });

  it("weighs each zone by the length of the lines nearest to it, the same for all without lines", () => {
    const zones = [{ at: [35.5, 33.9] as [number, number] }, { at: [38.3, 35.0] as [number, number] }];
    // 3 short hops near the first zone, one long line near the second.
    const near1: [number, number][] = [
      [35.4, 33.8],
      [35.5, 33.9],
      [35.6, 34.0],
    ];
    const near2: [number, number][] = [
      [38.0, 35.0],
      [38.6, 35.0],
    ];
    const [a, b] = zoneShares(zones, [near1, near2]);
    expect(a! + b!).toBeCloseTo(1, 9);
    expect(b).toBeGreaterThan(a!);
    expect(zoneShares(zones, [])).toEqual([0.5, 0.5]);
  });

  it("counts each zone's hot days in a calendar run by its share, not the climates averaged", () => {
    const w = weatherSettings(null);
    const coast = months(28, 18);
    const desert = months(40, 22);
    const c: ProjectClimate = {
      zones: [
        { id: "a-1", name: "Coast", at: [35.5, 33.9], fetched: fetched(33.9, 35.5, coast) },
        { id: "a-2", name: "Desert", at: [38.3, 35], fetched: fetched(35, 38.3, desert) },
      ],
    };
    const climates = weightedClimates(c, [])!;
    expect(climates.map((x) => x.weight)).toEqual([0.5, 0.5]);
    const span = { date: "2027-07-14" };
    const [p] = weatherPeriods("date", {}, span, {
      months: coast,
      climates,
      settings: w,
      hvacFullKwhPerDay: null,
      switchKwhPerFrostDay: 0,
    });
    const hot = (p!.counts["weekday.hot"] ?? 0) + (p!.counts["weekday.very_hot"] ?? 0);
    const expected =
      (variantShares(coast[6]!, w).hot +
        variantShares(coast[6]!, w).very_hot +
        variantShares(desert[6]!, w).hot +
        variantShares(desert[6]!, w).very_hot) /
      2;
    expect(hot).toBeCloseTo(expected, 2);
    // A zone without its climate yet: no weather in the run.
    expect(
      weightedClimates({ zones: [c.zones![0]!, { ...c.zones![1]!, fetched: undefined }] }, []),
    ).toBeNull();
  });
});

describe("climate zones in the project", () => {
  it("fetches each zone's climate in turn, shows how many in the bottom bar and keeps them all", async () => {
    let answer: (c: FetchedClimate) => void = () => {};
    const fetcher = vi.fn(
      (lat: number, lon: number) =>
        new Promise<FetchedClimate>((r) => (answer = () => r(fetched(lat, lon, months(30, 15))))),
    );
    let latest: PreferencesDoc | null = null;
    function Host() {
      const [prefs, setPrefs] = useState<PreferencesDoc | null>(null);
      latest = prefs;
      return (
        <JobsProvider>
          <ClimateKeeper
            place={null}
            bbox={null}
            polygons={[city, box("b", "Leipzig", 12.2, 51.2, 12.5, 51.4)]}
            preferences={prefs}
            onPreferences={setPrefs}
            fetcher={fetcher}
          />
          <JobsBar />
        </JobsProvider>
      );
    }
    render(<Host />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/Fetching the climate of the zones: 0 of 2/)).toBeTruthy();
    answer(fetched(0, 0, []));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    answer(fetched(0, 0, []));
    await waitFor(() => expect(latest?.climate?.zones?.every((z) => z.fetched)).toBe(true));
    expect(latest!.climate!.zones!.map((z) => z.name)).toEqual(["Berlin", "Leipzig"]);
    await waitFor(() => expect(screen.queryByRole("progressbar")).toBeNull());
  });

  it("shows one zone's table at a time in Preferences, with its share of the lines, and keeps a change to it", () => {
    const c: ProjectClimate = {
      zones: [
        { id: "a-1", name: "Coast", at: [35.5, 33.9], fetched: fetched(33.9, 35.5, months(28, 18)) },
        { id: "a-2", name: "Desert", at: [38.3, 35], fetched: fetched(35, 38.3, months(40, 22)) },
      ],
    };
    let prefs: PreferencesDoc = { values: {}, climate: c };
    render(
      <ClimateSection
        preferences={prefs}
        editable
        onPreferences={(d) => (prefs = d)}
        place={null}
        lines={[
          [
            [38.0, 35.0],
            [38.6, 35.0],
          ],
        ]}
        fetcher={vi.fn()}
      />,
    );
    expect(screen.getByText(/each of its 2 zones keeps its own climate/)).toBeTruthy();
    expect(screen.getByText("0 % of the network's line length is in this zone.")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "a-2" } });
    expect(screen.getByText("100 % of the network's line length is in this zone.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Jul · Average high (°C)"), { target: { value: "44" } });
    expect(prefs.climate!.zones![1]!.own).toEqual({ "7": { max_c: 44 } });
    expect(prefs.climate!.zones![0]!.own).toBeUndefined();
  });
});
