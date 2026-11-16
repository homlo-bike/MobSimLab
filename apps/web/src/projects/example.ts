import { tNow } from "../i18n/i18n";
import type { Network, Station, Switch, Track } from "../features/railways/types";
import type { SavedStreetLine, StreetLinesDoc } from "../features/street-lines/saved";
import { DEFAULT_TIMING } from "../features/street-lines/modes";
import type { LineView } from "../features/street-lines/types";
import type { Project, ProjectsApi } from "./api";

/**
 * The example project in the Help menu: a bus line and a tram in central Zurich. Stops are placed by
 * hand on the streets they serve; the street line tool routes the bus from OpenStreetMap when it opens,
 * and the railway tool builds the tram's tracks.
 */

/** A bus from Bellevue up to the university hospital and on to Haldenbach. */
const BUS_STOPS: { name: string; lonlat: [number, number] }[] = [
  { name: "Bellevue", lonlat: [8.5452, 47.367] },
  { name: "Kunsthaus", lonlat: [8.5482, 47.3702] },
  { name: "ETH/Universitätsspital", lonlat: [8.5492, 47.3767] },
  { name: "Haldenbach", lonlat: [8.5497, 47.3815] },
];

/** A route not yet computed: the tool routes the points again when it opens. */
const NOT_ROUTED: LineView = {
  points: [],
  legs: [],
  directions: [],
  station_groups: [],
  depot: null,
  depot_trips: [],
  issues: [],
  length_m: 0,
  time_s: 0,
  level_crossings: [],
  crossing_wait_s: 0,
};

/** Purpose: the example's bus line, with the routing engine's default bus and rules. */
export function exampleBusLine(): StreetLinesDoc {
  const line: SavedStreetLine = {
    name: tNow("example.busName"),
    profile: {
      mode: "bus",
      height_m: 3.1,
      weight_t: 19,
      length_m: 12,
      max_speed_kmh: 80,
      battery_range_m: 0,
      doors_both_sides: false,
    },
    rules: {
      traffic_side: "right",
      detour_warn_m: 500,
      detour_warn_ratio: 0.25,
      grouping_distance_m: 150,
      max_snap_m: 150,
    },
    timing: DEFAULT_TIMING,
    points: BUS_STOPS.map((s, i) => ({
      lonlat: s.lonlat,
      kind: i === 0 || i === BUS_STOPS.length - 1 ? "end_stop" : "stop",
      name: s.name,
    })),
    depot: null,
    depotStops: {},
    view: NOT_ROUTED,
  };
  return { lines: [line] };
}

/** Tram stops along Bahnhofstrasse, in local metres round the origin, facing the way the tram runs (south). */
const TRAM_ORIGIN: [number, number] = [8.5397, 47.3717];
const TRAM_STOPS: { name: string; x: number; y: number; rotation: number }[] = [
  { name: "Bahnhofplatz/HB", x: 0, y: 556, rotation: 264 },
  { name: "Rennweg", x: -38, y: 222, rotation: 266 },
  { name: "Paradeplatz", x: -53, y: -200, rotation: 280 },
  { name: "Bürkliplatz", x: 98, y: -545, rotation: 294 },
];

/**
 * Purpose: the example's tram: four street-level stops with side platforms, double track between them, a
 * crossover before each terminus so trams can turn back.
 */
export function exampleTram(): Network {
  const stations: Station[] = TRAM_STOPS.map((s, i) => ({
    id: i + 1,
    name: s.name,
    x: s.x,
    y: s.y,
    rotation_deg: s.rotation,
    level: "street",
    side_platforms: 2,
    island_platforms: 0,
    platform_length_m: 45,
  }));
  const tracks: Track[] = stations.slice(1).map((to, i) => ({
    id: 10 + i,
    name: "",
    start: { type: "station", station: i + 1, end: 1, tracks: [0, 1] },
    end: { type: "station", station: to.id, end: 0, tracks: [0, 1] },
    points: [],
    tracks: 2,
    level: "street",
    power: "auto",
    use: "running",
    bed: "auto",
    lead_start_m: 30,
    lead_end_m: 30,
    radius_start_m: null,
    radius_end_m: null,
    directions: [],
  }));
  const crossover = (id: number, track: number, s: number, direction: 1 | -1): Switch => ({
    id,
    kind: "crossover",
    track,
    s,
    element: "tram-r50",
    side: 1,
    direction,
    flip: false,
  });
  // The last section (Paradeplatz to Bürkliplatz) is about 310 m long.
  const switches = [crossover(20, 10, 40, 1), crossover(21, 12, 270, -1)];
  return { origin: TRAM_ORIGIN, mode: "tram", stations, tracks, switches };
}

/**
 * Purpose: make a new project of the caller's own holding the example, ready to open.
 * Side effects: creates a project and saves its two drawings through the projects API.
 */
export async function createExampleProject(api: ProjectsApi): Promise<Project> {
  const project = await api.create({
    name: tNow("example.name"),
    areaName: "Zürich",
    modes: ["bus", "tram"],
    description: tNow("example.description"),
  });
  await api.saveDrawing(project.id, "street-lines", exampleBusLine(), null);
  await api.saveDrawing(project.id, "railway", exampleTram(), null);
  return project;
}
