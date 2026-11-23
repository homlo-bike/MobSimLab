import { z } from "zod";
import { TILE_ZOOM } from "../street-network/street-network.service";

/**
 * The road simulation (Phase 5, 07-simulation §3): what the simulator panel sends to start a road run, and the
 * street tiles the worker builds the SUMO network from. The panel builds the scenario from the project's
 * street lines, depots (with the depot layout report) and GIS street setup; the worker matches it to the streets
 * (worker/src/mobsim_worker/jobs/road).
 */

const DAY = 48 * 3600;

/** Settings of a road run. */
export const roadParams = z
  .strictObject({
    from_s: z.number().finite().min(0).max(DAY),
    to_s: z.number().finite().min(0).max(DAY),
    /** Service simulated before the period, so the lines are full when it starts, s. */
    warmup_s: z.number().finite().min(0).max(7200).optional(),
    seed: z.number().int().min(0).max(2_147_483_647).optional(),
    /** SUMO step length, s. */
    step_s: z.number().finite().min(0.1).max(1).optional(),
  })
  .refine((p) => p.to_s > p.from_s, "the period must end after it starts")
  .refine((p) => p.to_s - p.from_s <= 12 * 3600, "a road run covers at most 12 hours");
export type RoadSettings = z.infer<typeof roadParams>;

const lonlat = z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-85).max(85)]);
const coords = z.array(lonlat).min(2).max(20_000);
const text = (max: number) => z.string().max(max);
const id = z.string().min(1).max(200);

const vehicle = z.object({
  length_m: z.number().finite().min(3).max(30),
  width_m: z.number().finite().min(1.5).max(3.5),
  max_speed_kmh: z.number().finite().min(10).max(150),
  weight_t: z.number().finite().min(1).max(60),
  /** `battery` and `trolleybus` run with SUMO's battery model; `other` (diesel and the rest) without. */
  energy: z.enum(["battery", "trolleybus", "other"]),
  battery_kwh: z.number().finite().min(0).max(2000).nullable(),
  hvac_kw: z.number().finite().min(0).max(200),
});

const depotRun = z.object({
  coords,
  time_s: z.number().finite().min(0).max(DAY),
  at: z.number().int().min(0),
});

const line = z
  .object({
    /** The line's index in the project's street lines. */
    index: z.number().int().min(0).max(9999),
    name: text(200),
    mode: z.enum(["bus", "brt", "trolleybus", "intercity_bus"]),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    vehicle,
    dwell_s: z.number().finite().min(0).max(3600),
    layover_s: z.number().finite().min(0).max(7200),
    /** The circuit's points from its first end stop; leg k runs from point k to point k + 1 (the last back to 0). */
    points: z
      .array(z.object({ name: text(200), kind: z.enum(["via", "stop", "end_stop"]), lonlat }))
      .min(2)
      .max(1000),
    legs: z.array(z.object({ coords, time_s: z.number().finite().min(0).max(DAY) })).max(1000),
    /** Planned departures from the first stop, s after midnight. */
    departures: z.array(z.number().finite().min(0).max(DAY)).max(5000),
    pull_out: depotRun.nullable(),
    pull_in: depotRun.nullable(),
    /** The shared depot the line's vehicles park in. */
    depot: id.nullable(),
  })
  .refine((l) => l.legs.length === l.points.length, "every point of a street line needs its leg");

const depot = z.object({
  id,
  name: text(200),
  /** The depot layout's driving network (crates/depot-layout `Report.network`). */
  network: z.object({
    nodes: z.array(z.object({ id, lonlat })).max(50_000),
    edges: z
      .array(
        z.object({
          id,
          kind: z.enum(["gate", "aisle", "lane", "drive"]),
          from: id,
          to: id,
          one_way: z.boolean(),
          coords,
          length_m: z.number().finite().optional(),
          of: id.optional(),
        }),
      )
      .max(50_000),
  }),
  lanes: z
    .array(
      z.object({
        id,
        slots: z
          .array(
            z.object({
              id,
              center: lonlat,
              heading_deg: z.number().finite(),
              length_m: z.number().finite().min(0),
              charger: z.boolean(),
            }),
          )
          .max(1000),
      }),
    )
    .max(5000),
  /** A slot for each vehicle of the lines using the depot (`Capacity.assignments`). */
  assignments: z
    .array(z.object({ line: id, vehicle: z.number().int().min(0), lane: id, slot: id, charger: z.boolean() }))
    .max(20_000),
});

const peak = z.number().int().min(0).max(8000).nullable().optional();

/** One strip of a street laid out section by section (`street_routing::Section`). */
const section = z.object({
  kind: z.enum(["lane", "parking", "island", "green", "protection"]),
  users: z
    .array(z.enum(["car", "bus", "tram", "bike", "taxi", "walk"]))
    .max(6)
    .optional(),
  dir: z.enum(["forward", "backward", "both"]).nullable().optional(),
  width: z.number().min(0).max(50),
  style: z.string().max(20).nullable().optional(),
});

/** What the simulator panel builds from the project for a road run. */
export const roadScenario = z.object({
  driving_side: z.enum(["right", "left"]),
  lines: z.array(line).min(1).max(200),
  depots: z.array(depot).max(100),
  /** The GIS tab's street setup (`StreetSetup`): direction, lanes, bus lanes or a custom layout, and traffic peaks per OSM way. */
  streets: z
    .array(
      z.object({
        way: z.number().int().positive(),
        oneway: z.boolean().nullable().optional(),
        traffic_lanes: z.number().int().min(1).max(12).nullable().optional(),
        bus_lane: z.boolean().nullable().optional(),
        /** A custom layout: replaces the street's lanes, direction and bus lanes. */
        sections: z.array(section).max(60).nullable().optional(),
        cars_morning_peak: peak,
        cars_evening_peak: peak,
      }),
    )
    .max(100_000),
  /** The GIS tab's junction setups: traffic lights given (`signals: true`) or taken away, by OSM nodes. */
  junctions: z
    .array(z.object({ nodes: z.array(z.number().int()).min(1).max(50), signals: z.boolean() }))
    .max(50_000)
    .optional(),
  traffic: z.object({
    /** Cars per hour per direction at peak by road type where the planner set none (`street.peak_cars_*_vph`). */
    defaults: z.object({
      trunk: z.number().min(0).max(8000),
      primary: z.number().min(0).max(8000),
      secondary: z.number().min(0).max(8000),
      tertiary: z.number().min(0).max(8000),
      local: z.number().min(0).max(8000),
    }),
    /** Off-peak traffic as a share of the peak value (`street.off_peak_traffic_share`). */
    off_peak_share: z.number().min(0).max(1),
    /** The morning and evening peak windows, s after midnight. */
    peaks: z.array(z.tuple([z.number().min(0).max(DAY), z.number().min(0).max(DAY)])).max(4),
  }),
  /** Charging power of a trolleybus under its wires, kW (`street.trolley_wire_charge_kw`). */
  trolley_charge_kw: z.number().min(0).max(1000),
});
export type RoadScenario = z.infer<typeof roadScenario>;

/** Room around the lines and depots taken into the network, m (worker `MARGIN_M`). */
export const ROAD_MARGIN_M = 600;

/**
 * Most street tiles one road run may take: the tiles along a whole city's bus lines, airport line included. The
 * tiles are loaded in the background and stored compressed, as for a demand run (`MAX_DEMAND_TILES`), and the
 * network column's size limit still guards a very dense area.
 */
export const MAX_ROAD_TILES = 320;

/** Longest step between the points checked along a route, m; well under a tile's width. */
const ROAD_STEP_M = 200;

/** Purpose: the web-mercator tile at zoom 14 holding a point. */
export function tileOf(lon: number, lat: number): [number, number] {
  const n = 2 ** TILE_ZOOM;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return [Math.min(n - 1, Math.max(0, x)), Math.min(n - 1, Math.max(0, y))];
}

/**
 * Purpose: the street tiles a road run needs: every tile within `ROAD_MARGIN_M` of the lines' routes, their
 * depot runs and the depots. Only the tiles along the routes are taken, not the whole box around them, so a
 * city's lines that fan out to its suburbs and airport do not take every tile of the empty land between them.
 * Output: tiles `[x, y]`, north to south, west to east.
 */
export function roadTiles(s: RoadScenario): [number, number][] {
  const paths: [number, number][][] = [];
  for (const l of s.lines) {
    for (const leg of l.legs) paths.push(leg.coords);
    if (l.pull_out) paths.push(l.pull_out.coords);
    if (l.pull_in) paths.push(l.pull_in.coords);
  }
  for (const d of s.depots) for (const n of d.network.nodes) paths.push([n.lonlat]);
  const seen = new Map<string, [number, number]>();
  const around = (lon: number, lat: number) => {
    const dLat = ROAD_MARGIN_M / 111_320;
    const dLon = ROAD_MARGIN_M / (111_320 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
    const [x0, y0] = tileOf(lon - dLon, lat + dLat);
    const [x1, y1] = tileOf(lon + dLon, lat - dLat);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) seen.set(`${x}/${y}`, [x, y]);
  };
  for (const path of paths) {
    path.forEach(([lon, lat], i) => {
      around(lon, lat);
      const next = path[i + 1];
      if (!next) return;
      // Points between two far-apart coordinates, so a long straight piece does not skip a tile.
      const kx = 111_320 * Math.max(0.1, Math.cos((lat * Math.PI) / 180));
      const m = Math.hypot((next[0] - lon) * kx, (next[1] - lat) * 111_320);
      const n = Math.ceil(m / ROAD_STEP_M);
      for (let k = 1; k < n; k++) around(lon + ((next[0] - lon) * k) / n, lat + ((next[1] - lat) * k) / n);
    });
  }
  return [...seen.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}
