import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateRawSync } from "node:zlib";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as wasm from "../src/wasm/gtfs/gtfs_wasm.js";
import { loadWasmGtfs } from "../src/features/gtfs/engine";
import { feedFileName, gtfsAvailable, isoDate, pluginRouteTypes } from "../src/features/gtfs/GtfsSection";
import type { GtfsFeed } from "../src/features/gtfs/types";
import { crc32, readZip, writeZip } from "../src/features/gtfs/zip";
import { JourneyPlanner } from "../src/features/journey-planner/JourneyPlanner";
import type { PlannerEngine, PlannerLoader, Timetable } from "../src/features/journey-planner/types";

afterEach(cleanup);

beforeAll(async () => {
  // Built by tools/wasm/build-gtfs.sh; load its bytes from disk.
  const file = resolve(__dirname, "../src/wasm/gtfs/gtfs_wasm_bg.wasm");
  await wasm.default({ module_or_path: readFileSync(file) });
});

/** A small feed: one bus line with two trips on weekdays. */
const FEED: Record<string, string> = {
  "agency.txt":
    "agency_id,agency_name,agency_url,agency_timezone\nA,Harbour Buses,https://example.org,Europe/Berlin\n",
  "stops.txt": "stop_id,stop_name,stop_lat,stop_lon\ns1,Quay,50.0,10.0\ns2,Market,50.01,10.01\n",
  "routes.txt": "route_id,agency_id,route_short_name,route_type\nR,A,7,3\n",
  "trips.txt": "route_id,service_id,trip_id\nR,WD,a\nR,WD,b\n",
  "stop_times.txt":
    "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n" +
    "a,07:00:00,07:00:00,s1,1\na,07:06:00,07:06:00,s2,2\n" +
    "b,08:00:00,08:00:00,s1,1\nb,08:06:00,08:06:00,s2,2\n",
  "calendar.txt":
    "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n" +
    "WD,1,1,1,1,1,0,0,20260101,20261231\n",
};

/** A zip with one deflated entry, as most feeds come. */
function deflatedZip(name: string, text: string): Uint8Array {
  const n = new TextEncoder().encode(name);
  const raw = new TextEncoder().encode(text);
  const data = new Uint8Array(deflateRawSync(raw));
  const out = new Uint8Array(30 + n.length + data.length + 46 + n.length + 22);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x04034b50, true);
  v.setUint16(8, 8, true);
  v.setUint32(14, crc32(raw), true);
  v.setUint32(18, data.length, true);
  v.setUint32(22, raw.length, true);
  v.setUint16(26, n.length, true);
  out.set(n, 30);
  out.set(data, 30 + n.length);
  const dir = 30 + n.length + data.length;
  v.setUint32(dir, 0x02014b50, true);
  v.setUint16(dir + 10, 8, true);
  v.setUint32(dir + 16, crc32(raw), true);
  v.setUint32(dir + 20, data.length, true);
  v.setUint32(dir + 24, raw.length, true);
  v.setUint16(dir + 28, n.length, true);
  out.set(n, dir + 46);
  const end = dir + 46 + n.length;
  v.setUint32(end, 0x06054b50, true);
  v.setUint16(end + 8, 1, true);
  v.setUint16(end + 10, 1, true);
  v.setUint32(end + 12, 46 + n.length, true);
  v.setUint32(end + 16, dir, true);
  return out;
}

describe("GTFS zip files", () => {
  it("writes and reads stored entries and reads deflated ones", async () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    const zip = writeZip({ "a.txt": "x,y\n1,2\n", "ü.txt": "é" });
    expect(await readZip(zip)).toEqual({ "a.txt": "x,y\n1,2\n", "ü.txt": "é" });
    expect(await readZip(deflatedZip("feed/stops.txt", "stop_id\nA\n"))).toEqual({
      "feed/stops.txt": "stop_id\nA\n",
    });
    await expect(readZip(new Uint8Array(40))).rejects.toThrow("not a zip file");
  });
});

describe("GTFS plugin", () => {
  it("offers its importer and exporter and names the download", () => {
    const { importer, exporter } = gtfsAvailable();
    expect(importer?.function).toBe("import_gtfs");
    expect(exporter?.function).toBe("export_gtfs");
    expect(pluginRouteTypes().ferry).toBe(4);
    expect(feedFileName("Harbour Loop 2")).toBe("harbour-loop-2-gtfs.zip");
    expect(feedFileName("")).toBe("mobsimlab-gtfs.zip");
    expect(isoDate("20260107")).toBe("2026-01-07");
  });

  it("imports a feed and writes it back in WebAssembly", async () => {
    const engine = await loadWasmGtfs();
    const got = engine.import(FEED, {});
    expect(got.summary).toMatchObject({ date: "20260107", routes: 1, stops: 2, trips: 2 });
    expect(got.summary.agencies).toEqual(["Harbour Buses"]);
    const files = engine.export(got.timetable, {
      agency_name: "Study",
      agency_url: "https://example.org",
      agency_timezone: "Europe/Berlin",
      lang: "en",
      start_date: "20270101",
      end_date: "20271231",
      route_types: {},
      feed_version: "1",
    });
    const back = engine.import(await readZip(writeZip(files)), { date: "20270106" });
    expect(back.summary.trips).toBe(2);
    expect(back.timetable.trips[0]!.stop_times[1]!.arrival_time).toBe(7 * 3600 + 360);
    expect(() => engine.import({}, {})).toThrow("stops.txt");
  });
});

/** A planner that only records the timetables it is given. */
function fakeLoader() {
  const calls: Timetable[] = [];
  const loader: PlannerLoader = async (timetable) => {
    calls.push(timetable);
    return {
      summary: () => ({
        stops: timetable.stops.length,
        routes: timetable.routes.length,
        trips: timetable.trips.length,
        raptor_routes: 1,
        footpaths: 0,
        first_departure_s: null,
        last_arrival_s: null,
        warnings: [],
      }),
      plan: () => ({ journeys: [] }),
      profile: () => [],
      dispose: () => {},
    } as unknown as PlannerEngine;
  };
  return { loader, calls };
}

describe("GTFS in the journey planner", () => {
  it("imports a feed from a zip, rides it, and can leave it out or remove it", async () => {
    const { loader, calls } = fakeLoader();
    const engine = await loadWasmGtfs();
    const onFeeds = vi.fn();
    const { rerender } = render(
      <JourneyPlanner map={null} loadPlanner={loader} onGtfsFeeds={onFeeds} projectName="Harbour" />,
    );
    const input = screen.getByLabelText("Import GTFS feed…") as HTMLInputElement;
    const file = new File([writeZip(FEED) as BlobPart], "harbour.zip", { type: "application/zip" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(onFeeds).toHaveBeenCalled());
    const feed = (onFeeds.mock.calls[0]![0] as { feeds: GtfsFeed[] }).feeds[0]!;
    expect(feed).toMatchObject({ name: "harbour.zip", summary: { trips: 2 } });
    expect(feed.timetable.trips).toHaveLength(2);

    rerender(
      <JourneyPlanner
        map={null}
        loadPlanner={loader}
        onGtfsFeeds={onFeeds}
        gtfsFeeds={[feed]}
        projectName="Harbour"
        loadGtfs={async () => engine}
      />,
    );
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]!.trips.map((t) => t.trip_id)).toEqual([`gtfs:${feed.id}:a`, `gtfs:${feed.id}:b`]);
    const use = screen.getByRole("checkbox", {
      name: /Harbour Buses: 1 lines, 2 stops, 2 trips on 2026-01-07/,
    });
    fireEvent.click(use);
    expect(screen.getByText(/No timetable yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onFeeds).toHaveBeenLastCalledWith({ feeds: [] });
  });

  it("shows a feed it cannot read", async () => {
    const { loader } = fakeLoader();
    render(<JourneyPlanner map={null} loadPlanner={loader} onGtfsFeeds={() => {}} />);
    const input = screen.getByLabelText("Import GTFS feed…") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["hello"], "notes.zip")] } });
    expect((await screen.findByRole("alert")).textContent).toBe("The feed could not be read: not a zip file");
  });

  it("downloads the project's lines as a GTFS zip", async () => {
    const { loader } = fakeLoader();
    const lines: Timetable = {
      stops: [
        { stop_id: "p1", stop_name: "Quay", stop_lat: 50, stop_lon: 10 },
        { stop_id: "p2", stop_name: "Market", stop_lat: 50.01, stop_lon: 10.01 },
      ],
      routes: [{ route_id: "S1", route_short_name: "S1", mode: "regional_rail" }],
      trips: [
        {
          trip_id: "t",
          route_id: "S1",
          stop_times: [
            { stop_id: "p1", stop_sequence: 1, arrival_time: 21600, departure_time: 21600 },
            { stop_id: "p2", stop_sequence: 2, arrival_time: 22200, departure_time: 22200 },
          ],
        },
      ],
    } as unknown as Timetable;
    const blobs: Blob[] = [];
    const create = vi.fn((b: Blob) => {
      blobs.push(b);
      return "blob:gtfs";
    });
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: () => {} });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<JourneyPlanner map={null} loadPlanner={loader} railLines={lines} projectName="Harbour" />);
    expect(screen.queryByLabelText("Import GTFS feed…")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Download my lines as GTFS" }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    const files = await readZip(new Uint8Array(await blobs[0]!.arrayBuffer()));
    expect(files["routes.txt"]).toContain("lines:S1,mobsimlab,S1,2,");
    expect(files["stop_times.txt"]).toContain("lines:t,06:10:00,06:10:00,lines:p2,2");
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe("harbour-gtfs.zip");
    click.mockRestore();
  });
});
