import { z } from "zod";
import { MAX_REASON } from "./value-history";

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
  /** Why the project changed a value, by assumption id (optional); recorded with the change. */
  reasons: z
    .record(
      z
        .string()
        .regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/)
        .max(120),
      z.string().max(MAX_REASON),
    )
    .refine((v) => Object.keys(v).length <= 1000, "at most 1000 reasons")
    .optional(),
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

/** Benefit tables settings (ADR-0040): the project's own formulas, by formula id, and its own boardings. */
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
  /** The planner's own weekday boardings per station or stop name, for the simulator's passenger loads. */
  boardings: z
    .record(z.string().max(300), z.number().finite().min(0).max(10_000_000))
    .refine((v) => Object.keys(v).length <= 20000, "at most 20000 stations and stops")
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

/** Demand model zones (ADR-0019): automatic hexagons or the planner's own zones, and values per zone. */
const zoneValues = z.record(z.string().max(40), z.union([z.number().finite(), z.boolean()]));
const demand = z.looseObject({
  source: z.enum(["auto", "own"]),
  /** The GBFS feed of the project's shared-bike scheme (https), read with the OpenStreetMap stations. */
  gbfsUrl: z
    .url({ protocol: /^https$/ })
    .max(2000)
    .optional(),
  /** What the planner observed (mode shares in %, mean car trip in km, weekday boardings), to calibrate to. */
  observed: z
    .looseObject({
      shares: z.record(z.string().max(20), z.number().finite().min(0).max(100)).optional(),
      meanCarKm: z.number().finite().min(0).max(1000).nullable().optional(),
      counts: z
        .array(
          z.looseObject({
            kind: z.enum(["line", "stop"]),
            id: z.string().max(300),
            value: z.number().finite().min(0),
          }),
        )
        .max(5000)
        .optional(),
    })
    .optional(),
  /** The demand run whose ridership the Tables tab, the service table and the system test use. */
  ridershipRun: z.string().min(1).max(64).optional(),
  zones: z
    .array(
      z.looseObject({
        id: z.string().min(1).max(64),
        name: z.string().max(120),
        ring: z.array(point).min(4).max(200),
        values: zoneValues,
      }),
    )
    .max(3000)
    .optional(),
  autoValues: z
    .record(z.string().max(64), zoneValues)
    .refine((v) => Object.keys(v).length <= 3000, "at most 3000 zones")
    .optional(),
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

/**
 * Lines of the plugin tools that draw on a core kit (cable cars and people movers on straight spans, ferries on a
 * water route), by tool id: the planner's drawing, the line the journey planner rides and the shape the noise map
 * needs, as the tool last built them.
 */
const pluginLines = z.looseObject({
  tools: z
    .record(
      z
        .string()
        .regex(/^[a-z0-9-]+$/)
        .max(60),
      z.looseObject({
        kit: z.enum(["straight-spans", "water-route"]),
        doc: z.looseObject({}),
        line: z.looseObject({}).nullable(),
        noise: z.looseObject({}).nullable(),
      }),
    )
    .refine((v) => Object.keys(v).length <= 50, "at most 50 tools"),
});

/** Road depots shared by the street lines (contracts/depot.schema.json): outline, gates, zones and layout. */
const depots = z.looseObject({
  depots: z
    .array(
      z.looseObject({
        id: z.string().min(1).max(64),
        name: z.string().max(120),
        modes: z.array(z.enum(["bus", "brt", "trolleybus", "intercity_bus"])).max(4),
        boundary: z.array(point).max(500),
        gates: z.array(z.looseObject({ id: z.string().min(1).max(64), lonlat: point })).max(20),
        zones: z
          .array(z.looseObject({ id: z.string().min(1).max(64), ring: z.array(point).max(500) }))
          .max(100),
        layout: z
          .looseObject({
            lanes: z
              .array(z.looseObject({ id: z.string().min(1), slots: z.array(z.looseObject({})) }))
              .max(5000),
            aisles: z.array(z.looseObject({ id: z.string().min(1) })).max(2000),
          })
          .nullable(),
      }),
    )
    .max(50),
});

/** The project's own vehicles and its fleet (Project preferences → Vehicles and Fleet). */
const fleet = z.looseObject({
  vehicles: z
    .array(
      z.looseObject({
        id: z
          .string()
          .regex(/^own-[a-z0-9-]+$/)
          .max(80),
        name: z.string().min(1).max(200),
        mode: z.string().min(1).max(40),
      }),
    )
    .max(500),
  units: z
    .array(
      z.looseObject({
        id: z.string().min(1).max(64),
        vehicle: z.string().min(1).max(120),
        number: z.string().max(40),
      }),
    )
    .max(5000),
});

/** Fare revenue table (ADR-0044): the fare structure and the project's own values (fares in 2023 int. $). */
const fares = z.looseObject({
  structure: z.enum(["flat", "zonal", "distance"]).optional(),
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
});

/** Appraisal (ADR-0045): the multi-criteria analysis' own criteria with their weights and scores per line. */
const appraisal = z.looseObject({
  criteria: z
    .array(
      z.looseObject({
        id: z.string().max(40),
        name: z.string().max(120),
        weight: z.number().finite().min(0),
        higher: z.boolean(),
        scores: z
          .record(z.string().max(200), z.number().finite())
          .refine((v) => Object.keys(v).length <= 500, "at most 500 scores"),
      }),
    )
    .max(30)
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
  /** Cable car, people mover and ferry lines of the plugin tools (straight spans and water route kits). */
  "plugin-lines": { schema: pluginLines, schemaVersion: 1 },
  /** Road depots (07-simulation §7), shared by the street lines whose vehicles fit. */
  depots: { schema: depots, schemaVersion: 1 },
  /** The project's own vehicle types and its individual vehicles (08-vehicles.md §1, §4). */
  fleet: { schema: fleet, schemaVersion: 1 },
  /** Demand model zones in the Tables and GIS tabs (ADR-0019): automatic or own, with the planner's values. */
  demand: { schema: demand, schemaVersion: 1 },
  /** Fare revenue table (ADR-0044): fare structure, fares, passes, discounts and the other fare values. */
  fares: { schema: fares, schemaVersion: 1 },
  /** Appraisal (ADR-0045): the planner's own multi-criteria criteria, weights and scores. */
  appraisal: { schema: appraisal, schemaVersion: 1 },
} as const satisfies Record<string, { schema: z.ZodType; schemaVersion: number }>;

export type DrawingKind = keyof typeof DRAWING_KINDS;

/** Largest document accepted, as JSON text. Matches the body limit of the drawings route. */
export const MAX_DRAWING_BYTES = 8 * 1024 * 1024;

/** Purpose: whether a string names a drawing kind. */
export function isDrawingKind(kind: string): kind is DrawingKind {
  return Object.hasOwn(DRAWING_KINDS, kind);
}
