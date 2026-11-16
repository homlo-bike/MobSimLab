import { z } from "zod";

/**
 * What a project can hold drawings of, and the shape each document must have. The API checks only the outline
 * of a document (the web app's editors own the details); the outline stops a client from saving something the
 * editors cannot open again.
 */
const point = z.tuple([z.number().finite(), z.number().finite()]);

const streetLines = z.looseObject({
  lines: z.array(z.looseObject({ points: z.array(z.looseObject({ lonlat: point })).max(2000) })).max(200),
});

const railway = z.looseObject({
  origin: point,
  mode: z.string().min(1).max(40),
  stations: z.array(z.looseObject({ id: z.number() })).max(5000),
  tracks: z.array(z.looseObject({ id: z.number() })).max(20000),
  switches: z.array(z.looseObject({ id: z.number() })).max(20000),
});

/** The published trains of the railway tool's service lines (`contracts/published-timetable.schema.json`). */
const railTimetable = z.looseObject({
  stops: z.array(z.looseObject({ stop_id: z.string() })).max(50000),
  routes: z.array(z.looseObject({ route_id: z.string() })).max(2000),
  trips: z.array(z.looseObject({ trip_id: z.string() })).max(100000),
});

/** Existing networks imported from GTFS feeds (GTFS plugin): each feed's timetable of one service day. */
const gtfsNetwork = z.looseObject({
  feeds: z
    .array(
      z.looseObject({
        id: z.string().min(1).max(64),
        name: z.string().max(200),
        timetable: railTimetable,
        converted: z.array(z.string().max(200)).max(5000).optional(),
      }),
    )
    .max(5),
});

const streetSetups = z.array(z.looseObject({ way: z.number().int() })).max(50000);

/** Assumption library values the project changes, by assumption id (for example `street.mixed_traffic_delay_share`). */
const preferences = z.looseObject({
  values: z
    .record(
      z
        .string()
        .regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/)
        .max(120),
      z.number().finite(),
    )
    .refine((v) => Object.keys(v).length <= 1000, "at most 1000 values"),
});

/** Cost tables settings: the country whose prices apply (ISO 3166-1 alpha-3), when the planner chose one. */
const costs = z.looseObject({
  country: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable()
    .optional(),
});

/** Schematic edits (ADR-0041): stations the planner moved, label places and display switches. */
const STATION_STATUSES = [
  "central_station",
  "bus_station",
  "airport",
  "seaport",
  "park_and_ride",
  "hospital",
  "university",
  "stadium",
] as const;
const schematic = z.looseObject({
  origin: point.optional(),
  pins: z
    .record(z.string().max(300), point)
    .refine((v) => Object.keys(v).length <= 20000, "at most 20000 pins"),
  labels: z
    .record(z.string().max(300), z.number().int().min(0).max(7))
    .refine((v) => Object.keys(v).length <= 20000, "at most 20000 labels"),
  hidden: z.array(z.string().max(40)).max(20).optional(),
  rotate: z
    .record(z.string().max(300), z.number().min(-90).max(90))
    .refine((v) => Object.keys(v).length <= 20000, "at most 20000 rotations")
    .optional(),
  statuses: z
    .record(z.string().max(300), z.array(z.enum(STATION_STATUSES)).max(STATION_STATUSES.length))
    .refine((v) => Object.keys(v).length <= 20000, "at most 20000 stations with a status")
    .optional(),
  areas: z
    .array(
      z.looseObject({
        id: z.string().min(1).max(64),
        name: z.string().max(80),
        kind: z.enum(["zone", "landmark"]),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        points: z.array(point).min(3).max(500),
      }),
    )
    .max(200)
    .optional(),
});

/**
 * Tables tab scenarios: named copies of the railway design and the street lines, kept to compare with the
 * current design.
 */
const scenarios = z.looseObject({
  scenarios: z
    .array(
      z.looseObject({
        id: z.string().min(1).max(64),
        name: z.string().trim().min(1).max(120),
        savedAt: z.string().max(40),
        railway: railway.nullable(),
        streetLines: streetLines.nullable(),
      }),
    )
    .max(20),
});

/** Benefit tables settings (ADR-0040): the project's own formulas, by formula id. */
const benefits = z.looseObject({
  formulas: z
    .record(
      z
        .string()
        .regex(/^[a-z_]+$/)
        .max(40),
      z.string().max(2000),
    )
    .refine((v) => Object.keys(v).length <= 50, "at most 50 formulas")
    .optional(),
});

/** Regions drawn or imported in the GIS tab, with values that take priority in the benefit tables. */
const regions = z.looseObject({
  regions: z
    .array(
      z.looseObject({
        id: z.string().min(1).max(100),
        name: z.string().max(200),
        ring: z.array(point).min(4).max(5000),
        values: z.record(z.string().max(40), z.union([z.number().finite(), z.string().max(40)])),
      }),
    )
    .max(500),
});

/** Cargo bike tab (plugins/cargo-bike): start point, destination and the values the project changed. */
const cargoBike = z.looseObject({
  start: point.nullable().optional(),
  destination: point.nullable().optional(),
  values: z
    .record(
      z
        .string()
        .regex(/^[a-z_.]+$/)
        .max(60),
      z.number().finite(),
    )
    .refine((v) => Object.keys(v).length <= 100, "at most 100 values")
    .optional(),
  kit: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(40)
    .nullable()
    .optional(),
});

/** Drawing kinds with their document outline and current schema version. */
export const DRAWING_KINDS = {
  /** The street line tool (ADR-0029): bus, BRT, trolleybus and intercity bus lines. */
  "street-lines": { schema: streetLines, schemaVersion: 1 },
  /** The railway design tool (ADR-0030): stations, tracks, switches and signals. */
  railway: { schema: railway, schemaVersion: 1 },
  /** GIS tab street setups: lanes, bus and bike lanes, separation and tram share per OSM way. */
  "street-setups": { schema: streetSetups, schemaVersion: 1 },
  /** The trains of the railway tool's service lines as last published, for the journey planner. */
  "rail-timetable": { schema: railTimetable, schemaVersion: 1 },
  /** Existing networks imported from GTFS feeds (GTFS plugin), for the journey planner. */
  "gtfs-network": { schema: gtfsNetwork, schemaVersion: 1 },
  /** Project preferences: assumption library values changed for this project (Preferences tab). */
  preferences: { schema: preferences, schemaVersion: 1 },
  /** Cost tables settings (ADR-0039): the country chosen for prices. */
  costs: { schema: costs, schemaVersion: 1 },
  /** Schematic tab (ADR-0041): the planner's edits of the network diagram. */
  schematic: { schema: schematic, schemaVersion: 1 },
  /** Tables tab: saved copies of the design to compare side by side. */
  scenarios: { schema: scenarios, schemaVersion: 1 },
  /** Benefit tables settings (ADR-0040): the project's own formulas. */
  benefits: { schema: benefits, schemaVersion: 1 },
  /** GIS tab regions with their own values (land use, land value, tax, population, jobs…). */
  regions: { schema: regions, schemaVersion: 1 },
  /** Cargo bike tab of the cargo bike plugin: start point, destination and the project's own values. */
  "cargo-bike": { schema: cargoBike, schemaVersion: 1 },
} as const satisfies Record<string, { schema: z.ZodType; schemaVersion: number }>;

export type DrawingKind = keyof typeof DRAWING_KINDS;

/** Largest document accepted, as JSON text. Matches the body limit of the drawings route. */
export const MAX_DRAWING_BYTES = 8 * 1024 * 1024;

/** Purpose: whether a string names a drawing kind. */
export function isDrawingKind(kind: string): kind is DrawingKind {
  return Object.hasOwn(DRAWING_KINDS, kind);
}
