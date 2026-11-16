/**
 * The project's own vehicles and its fleet (drawing kind `fleet`, 08-vehicles.md §1 and §4, FR-VEH-03/04).
 *
 * Own vehicles are uploaded as JSON (the catalogue's research format or the full catalogue format,
 * `vehicles/schema/vehicle.schema.json`) or created in Project preferences. A vehicle without one of the core
 * values the catalogue requires (ADR-0026: length, width, seats, standing places, top speed, energy source) is
 * rejected. The fleet lists the project's individual vehicles: each is one vehicle of a catalogue or own type,
 * with a fleet number, a home depot, a year and a status.
 */
import type { CatalogueVehicle, Mode } from "../street-lines/types";
import type { CatalogueTrain, RailMode } from "../railways/types";

/** Street modes of the catalogue (street line tool). */
export const STREET_MODES = ["bus", "brt", "trolleybus", "intercity_bus"] as const;
/** Rail modes of the catalogue (railway tool). */
export const RAIL_VEHICLE_MODES = [
  "tram",
  "light_rail",
  "metro",
  "commuter_rail",
  "regional_rail",
  "long_distance_rail",
  "high_speed_rail",
] as const;
/** Every mode an own vehicle can have: the catalogue's modes. */
export const OWN_MODES = [...STREET_MODES, ...RAIL_VEHICLE_MODES] as const;
export type OwnMode = (typeof OWN_MODES)[number];

/** Energy sources of the catalogue schema (`energySource`), without `unknown`. */
export const ENERGY_SOURCES = [
  "diesel",
  "diesel-hybrid",
  "cng",
  "hvo",
  "battery",
  "hydrogen",
  "overhead",
  "overhead-ac",
  "overhead-dc",
  "overhead-multisystem",
  "supercapacitor",
  "third-rail",
  "dual",
] as const;
export type EnergySource = (typeof ENERGY_SOURCES)[number];

/**
 * Planning standing density by mode, pers/m² (`mode.standing_density_ppm2`, central values of
 * assumptions/DEFAULTS.md), as tools/vehicles/street_vehicles.py and rail_trains.py use it.
 */
const PLANNING_DENSITY: Record<OwnMode, number> = {
  bus: 4,
  brt: 4,
  trolleybus: 4,
  intercity_bus: 0,
  tram: 4,
  light_rail: 4,
  metro: 4,
  commuter_rail: 4,
  regional_rail: 2,
  long_distance_rail: 0,
  high_speed_rail: 0,
};
/** Density assumed when a source quotes standing places but no density, pers/m² (08-vehicles.md §3 rule 4). */
export const ASSUMED_DENSITY = 4;
/** Mass of one passenger for the loaded weight when only the empty weight is known, t. */
const PASSENGER_T = 0.075;

/** A vehicle type the project added itself. */
export interface OwnVehicle {
  /** `own-<slug>`; never the id of a catalogue vehicle. */
  id: string;
  name: string;
  mode: OwnMode;
  manufacturer: string | null;
  length_m: number;
  width_m: number;
  height_m: number | null;
  seats: number;
  /** Standing places as the source quotes them. */
  standing: number;
  /** The density the source quotes for its standing places, pers/m²; null: 4 pers/m² is assumed. */
  standing_density: number | null;
  top_speed_kmh: number;
  energy: EnergySource;
  empty_mass_t: number | null;
  loaded_weight_t: number | null;
  power_kw: number | null;
  cars: number | null;
  /** Articulation joints: 0 rigid, 1 articulated, 2 double articulated. */
  articulations: number;
  /** Axle positions from the front, m. */
  axles_m: number[] | null;
  turning_circle_m: number | null;
  /** Web addresses of the sources the values come from. */
  sources: string[];
  notes: string | null;
  /** How the vehicle came into the project. */
  origin: "upload" | "created";
}

export const UNIT_STATUSES = ["active", "reserve", "maintenance", "retired"] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

/** One vehicle of the fleet (08-vehicles.md §4). */
export interface FleetUnit {
  id: string;
  /** Catalogue or own vehicle id. */
  vehicle: string;
  /** Fleet number, as painted on the vehicle. */
  number: string;
  /** Home depot (depot tool), or null. */
  depot: string | null;
  /** Year the vehicle entered service. */
  year: number | null;
  status: UnitStatus;
}

/** The `fleet` drawing. */
export interface FleetDoc {
  vehicles: OwnVehicle[];
  units: FleetUnit[];
}

export const EMPTY_FLEET: FleetDoc = { vehicles: [], units: [] };

/** Largest values accepted, as a check against wrong units (millimetres for metres, and so on). */
export const LIMITS = {
  length_m: 500,
  width_m: 5,
  height_m: 8,
  seats: 3000,
  standing: 5000,
  standing_density: 10,
  top_speed_kmh: 600,
  empty_mass_t: 2000,
  loaded_weight_t: 3000,
  power_kw: 50000,
  cars: 40,
  articulations: 10,
  turning_circle_m: 100,
} as const;
/** Most own vehicles and fleet vehicles a project keeps. */
export const MAX_OWN_VEHICLES = 500;
export const MAX_UNITS = 5000;

/** A field an own vehicle needs, as the reasons for rejecting it name it. */
export type CoreField = "name" | "mode" | "length" | "width" | "seats" | "standing" | "topSpeed" | "energy";
/** Values an own vehicle may leave out. */
export type OptionalField =
  | "height_m"
  | "standing_density"
  | "empty_mass_t"
  | "loaded_weight_t"
  | "power_kw"
  | "cars"
  | "articulations"
  | "turning_circle_m";
export type CheckedField = CoreField | OptionalField;

/** Why a vehicle was rejected: the core values missing and the values out of range. */
export interface Rejection {
  missing: CoreField[];
  invalid: CheckedField[];
}

export function isStreetMode(m: string): m is Mode {
  return (STREET_MODES as readonly string[]).includes(m);
}

export function isRailMode(m: string): m is RailMode {
  return (RAIL_VEHICLE_MODES as readonly string[]).includes(m);
}

/** Purpose: an own vehicle's planning capacity: seats plus its standing area at the mode's planning density. */
export function ownCapacity(v: Pick<OwnVehicle, "mode" | "seats" | "standing" | "standing_density">): number {
  const area =
    v.standing / (v.standing_density && v.standing_density > 0 ? v.standing_density : ASSUMED_DENSITY);
  return Math.round(v.seats + area * PLANNING_DENSITY[v.mode]);
}

/** Purpose: an own street vehicle as the street line tool and the depots take a catalogue one. */
export function toStreetVehicle(v: OwnVehicle): CatalogueVehicle {
  const capacity = ownCapacity(v);
  const weight = v.loaded_weight_t ?? (v.empty_mass_t ? v.empty_mass_t + capacity * PASSENGER_T : null);
  return {
    id: v.id,
    name: v.name,
    mode: v.mode as Mode,
    length_m: v.length_m,
    height_m: v.height_m,
    weight_t: weight === null ? null : Math.round(weight * 10) / 10,
    top_speed_kmh: v.top_speed_kmh,
    capacity,
    width_m: v.width_m,
    articulations: v.articulations,
    axles_m: v.axles_m,
    turning_circle_m: v.turning_circle_m,
    energy: v.energy,
  };
}

/** Purpose: an own rail vehicle as the railway tool takes a catalogue train. */
export function toTrain(v: OwnVehicle): CatalogueTrain {
  return {
    id: v.id,
    name: v.name,
    mode: v.mode as RailMode,
    length_m: v.length_m,
    top_speed_kmh: v.top_speed_kmh,
    power_kw: v.power_kw,
    empty_mass_t: v.empty_mass_t,
    capacity: ownCapacity(v),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Checking

const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim() : null);
const obj = (x: unknown): Record<string, unknown> =>
  x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {};

/** Purpose: an id for an own vehicle from a name or a file's id: `own-` and lowercase letters, digits and dashes. */
export function ownId(text: string): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `own-${slug.replace(/^own-/, "") || "vehicle"}`;
}

/** The values of an own vehicle before they are checked (from a file or the form). */
export type VehicleDraft = { [K in keyof OwnVehicle]?: unknown };

/**
 * Purpose: check a draft and return the own vehicle, or why it is rejected. Core values must be present;
 * every number must be in range. Optional values that are absent become null.
 */
export function checkVehicle(d: VehicleDraft): { vehicle: OwnVehicle } | { rejected: Rejection } {
  const missing: CoreField[] = [];
  const invalid: CheckedField[] = [];
  const name = str(d.name);
  if (!name) missing.push("name");
  const mode = str(d.mode);
  if (!mode) missing.push("mode");
  else if (!(OWN_MODES as readonly string[]).includes(mode)) invalid.push("mode");
  const core = (key: keyof typeof LIMITS, field: CoreField, positive: boolean): number => {
    const v = num(d[key as keyof VehicleDraft]);
    if (v === null) missing.push(field);
    else if (v < 0 || (positive && v === 0) || v > LIMITS[key]) invalid.push(field);
    return v ?? 0;
  };
  const length_m = core("length_m", "length", true);
  const width_m = core("width_m", "width", true);
  const seats = core("seats", "seats", false);
  const standing = core("standing", "standing", false);
  const top_speed_kmh = core("top_speed_kmh", "topSpeed", true);
  const energy = str(d.energy);
  if (!energy || energy === "unknown") missing.push("energy");
  else if (!(ENERGY_SOURCES as readonly string[]).includes(energy)) invalid.push("energy");
  const optional = (key: Exclude<OptionalField, "articulations">): number | null => {
    const raw = d[key as keyof VehicleDraft];
    if (raw === null || raw === undefined || raw === "") return null;
    const v = num(raw);
    if (v === null || v <= 0 || v > LIMITS[key]) {
      invalid.push(key);
      return null;
    }
    return v;
  };
  const height_m = optional("height_m");
  const standing_density = optional("standing_density");
  const empty_mass_t = optional("empty_mass_t");
  const loaded_weight_t = optional("loaded_weight_t");
  const power_kw = optional("power_kw");
  const cars = optional("cars");
  const turning_circle_m = optional("turning_circle_m");
  let articulations = 0;
  if (d.articulations !== null && d.articulations !== undefined && d.articulations !== "") {
    const a = num(d.articulations);
    if (a === null || a < 0 || a > LIMITS.articulations || !Number.isInteger(a))
      invalid.push("articulations");
    else articulations = a;
  }
  if (cars !== null && !Number.isInteger(cars)) invalid.push("cars");
  const axles = Array.isArray(d.axles_m) ? d.axles_m.map(num) : null;
  const axles_m =
    axles && axles.length >= 2 && axles.every((a): a is number => a !== null && a >= 0 && a <= length_m)
      ? axles
      : null;
  if (missing.length || invalid.length) return { rejected: { missing, invalid } };
  const sources = Array.isArray(d.sources)
    ? [...new Set(d.sources.map(str).filter((s): s is string => !!s && /^https?:\/\//.test(s)))].slice(0, 20)
    : [];
  return {
    vehicle: {
      id: str(d.id) && String(d.id).startsWith("own-") ? String(d.id) : ownId(str(d.id) ?? name!),
      name: name!.slice(0, 200),
      mode: mode as OwnMode,
      manufacturer: str(d.manufacturer)?.slice(0, 120) ?? null,
      length_m,
      width_m,
      height_m,
      seats: Math.round(seats),
      standing: Math.round(standing),
      standing_density,
      top_speed_kmh,
      energy: energy as EnergySource,
      empty_mass_t,
      loaded_weight_t,
      power_kw,
      cars,
      articulations,
      axles_m,
      turning_circle_m,
      sources,
      notes: str(d.notes)?.slice(0, 4000) ?? null,
      origin: d.origin === "created" ? "created" : "upload",
    },
  };
}

/** Import energy supply → catalogue energy source (tools/vehicles/convert.py `energy_source`). */
function researchEnergy(energy: Record<string, unknown>): string | null {
  const supply = energy.supply;
  const systems = Array.isArray(energy.supplySystems) ? energy.supplySystems.map(String) : [];
  const onboard = energy.onboard;
  if (supply === "overhead_wire") {
    if (onboard === "battery" || onboard === "diesel") return "dual";
    const kinds = new Set(systems.map((s) => s.slice(0, 2)));
    if (kinds.size === 1 && kinds.has("ac")) return "overhead-ac";
    if (kinds.size === 1 && kinds.has("dc")) return "overhead-dc";
    return kinds.size ? "overhead-multisystem" : "overhead";
  }
  const map: Record<string, string> = {
    third_rail: "third-rail",
    battery: "battery",
    diesel: "diesel",
    hydrogen: "hydrogen",
    gas: "cng",
    hybrid: "diesel-hybrid",
  };
  return typeof supply === "string" ? (map[supply] ?? null) : null;
}

/** Purpose: a vehicle in the research format (vehicle-catalogue/research-prompt.md) as a draft. */
export function fromResearch(r: Record<string, unknown>): VehicleDraft {
  const dim = obj(r.dimensions);
  const consist = obj(r.consist);
  const cap = obj(r.capacity);
  const perf = obj(r.performance);
  const producer = str(r.producer);
  const model = str(r.name);
  const variant = str(r.variant);
  const seats = num(cap.seated);
  const total = num(cap.total);
  const standing = num(cap.standing) ?? (seats !== null && total !== null ? total - seats : null);
  const name = model ? [producer, model].filter(Boolean).join(" ") + (variant ? ` (${variant})` : "") : null;
  const sources = Array.isArray(r.sources) ? r.sources.map((s) => obj(s).url) : [];
  return {
    id: str(r.id) ?? undefined,
    name,
    mode: str(r.mode),
    manufacturer: producer,
    length_m: num(dim.lengthM),
    width_m: num(dim.widthM),
    height_m: num(dim.heightM),
    seats,
    standing,
    standing_density: num(cap.standingDensityPersM2),
    top_speed_kmh: num(perf.maxSpeedKmh),
    energy: researchEnergy(obj(r.energy)),
    empty_mass_t: num(dim.emptyWeightT),
    loaded_weight_t: num(dim.grossWeightT),
    power_kw: num(perf.tractionPowerKw),
    cars: num(consist.cars),
    articulations: num(consist.articulations),
    axles_m: consist.axlePositionsM,
    turning_circle_m: num(dim.turningCircleM),
    sources,
    notes: str(r.notes),
  };
}

/** Purpose: a vehicle in the catalogue format (`vehicles/schema/vehicle.schema.json`) as a draft. */
export function fromCatalogue(c: Record<string, unknown>): VehicleDraft {
  const q = (o: Record<string, unknown>, key: string): unknown => obj(o[key]).value;
  const n = (o: Record<string, unknown>, key: string) => num(q(o, key));
  const consist = obj(c.consist);
  const quoted = n(c, "standingQuoted");
  const area = n(c, "standingArea");
  const quotedDensity = n(c, "standingDensityQuoted");
  // Standing places as quoted; a file with only the standing area gives them at the assumed density.
  const standing = quoted ?? (area !== null ? Math.round(area * ASSUMED_DENSITY) : null);
  const density = quoted !== null ? quotedDensity : area !== null ? ASSUMED_DENSITY : null;
  return {
    id: str(c.legacyId) ?? str(c.name) ?? undefined,
    name: str(c.name),
    mode: str(c.mode),
    manufacturer: str(c.manufacturer),
    length_m: n(c, "length"),
    width_m: n(c, "width"),
    height_m: n(c, "height"),
    seats: n(c, "seats"),
    standing,
    standing_density: density,
    top_speed_kmh: n(c, "topSpeed"),
    energy: q(c, "energySource"),
    empty_mass_t: n(c, "weightEmpty"),
    loaded_weight_t: n(c, "weightLoaded"),
    power_kw: n(c, "power"),
    cars: n(consist, "cars"),
    articulations: n(consist, "articulations"),
    axles_m: q(consist, "axlePositions"),
    turning_circle_m: n(c, "turningCircle"),
    sources: [],
    notes: str(c.notes),
  };
}

/** Purpose: whether a JSON object is in the catalogue format (quantities as `{value, …}` records). */
export function isCatalogueFormat(x: Record<string, unknown>): boolean {
  return (
    "schemaVersion" in x || (typeof x.length === "object" && x.length !== null && "value" in obj(x.length))
  );
}

/** What one vehicle in an uploaded file came to. */
export type UploadResult =
  | { file: string; label: string; vehicle: OwnVehicle }
  | { file: string; label: string; rejected: Rejection }
  | { file: string; label: string; unreadable: true };

/**
 * Purpose: read one uploaded file: a vehicle, or a list of vehicles, in either format. Each vehicle comes
 * back checked; a file that is not JSON comes back unreadable.
 */
export function readVehicleFile(file: string, text: string): UploadResult[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [{ file, label: file, unreadable: true }];
  }
  const items = Array.isArray(data) ? data : [data];
  if (!items.length) return [{ file, label: file, unreadable: true }];
  return items.map((item, i) => {
    const o = obj(item);
    const label = str(o.name) ?? str(o.id) ?? (items.length > 1 ? `${file} #${i + 1}` : file);
    if (!Object.keys(o).length) return { file, label, unreadable: true as const };
    const draft = isCatalogueFormat(o) ? fromCatalogue(o) : fromResearch(o);
    const checked = checkVehicle({ ...draft, origin: "upload" });
    return "vehicle" in checked
      ? { file, label: checked.vehicle.name, vehicle: checked.vehicle }
      : { file, label, rejected: checked.rejected };
  });
}

// ---------------------------------------------------------------------------------------------------------
// The document

/** Purpose: the fleet drawing with only well-formed entries (an older or hand-edited document stays usable). */
export function fleetFrom(doc: unknown): FleetDoc {
  const d = obj(doc);
  const vehicles: OwnVehicle[] = [];
  for (const raw of Array.isArray(d.vehicles) ? d.vehicles : []) {
    const o = obj(raw);
    const c = checkVehicle(o as VehicleDraft);
    if ("vehicle" in c && !vehicles.some((v) => v.id === c.vehicle.id))
      vehicles.push({ ...c.vehicle, id: String(o.id) });
  }
  const units: FleetUnit[] = [];
  for (const raw of Array.isArray(d.units) ? d.units : []) {
    const o = obj(raw);
    const id = str(o.id);
    const vehicle = str(o.vehicle);
    if (!id || !vehicle) continue;
    units.push({
      id,
      vehicle,
      number: str(o.number) ?? "",
      depot: str(o.depot),
      year: num(o.year),
      status: (UNIT_STATUSES as readonly unknown[]).includes(o.status) ? (o.status as UnitStatus) : "active",
    });
  }
  return { vehicles, units };
}

/** Purpose: the document with own vehicles added; a vehicle with an id the project has replaces that one. */
export function withOwnVehicles(doc: FleetDoc, add: readonly OwnVehicle[]): FleetDoc {
  const byId = new Map(doc.vehicles.map((v) => [v.id, v]));
  for (const v of add) byId.set(v.id, v);
  return { ...doc, vehicles: [...byId.values()].slice(0, MAX_OWN_VEHICLES) };
}

/** Purpose: the document without an own vehicle and the fleet vehicles of its type. */
export function withoutOwnVehicle(doc: FleetDoc, id: string): FleetDoc {
  return {
    vehicles: doc.vehicles.filter((v) => v.id !== id),
    units: doc.units.filter((u) => u.vehicle !== id),
  };
}

/** Purpose: an id for a new own vehicle that no other own vehicle has. */
export function freeOwnId(doc: FleetDoc, name: string, keep?: string): string {
  const base = ownId(name);
  const taken = (id: string) => id !== keep && doc.vehicles.some((v) => v.id === id);
  if (!taken(base)) return base;
  for (let i = 2; ; i++) if (!taken(`${base}-${i}`)) return `${base}-${i}`;
}

/** Purpose: the fleet number after `n`: its last run of digits counted up, keeping leading zeros. */
export function nextNumber(n: string, step = 1): string {
  const m = /^(.*?)(\d+)(\D*)$/.exec(n);
  if (!m) return step === 0 ? n : `${n}${step + 1}`.trim();
  const [, head, digits, tail] = m;
  const next = String(Number(digits) + step).padStart(digits!.length, "0");
  return `${head}${next}${tail}`;
}

let unitSeq = 0;
/** Purpose: a new fleet vehicle id. */
function unitId(): string {
  unitSeq = (unitSeq + 1) % 1_000_000;
  return `u${Date.now().toString(36)}${unitSeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Purpose: the document with `count` fleet vehicles of one type, numbered from `first` up. */
export function withNewUnits(
  doc: FleetDoc,
  a: {
    vehicle: string;
    count: number;
    first: string;
    depot: string | null;
    year: number | null;
    status: UnitStatus;
  },
): FleetDoc {
  const count = Math.max(0, Math.min(Math.floor(a.count), MAX_UNITS - doc.units.length));
  const units = Array.from({ length: count }, (_, i) => ({
    id: unitId(),
    vehicle: a.vehicle,
    number: nextNumber(a.first.trim(), i).slice(0, 40),
    depot: a.depot,
    year: a.year,
    status: a.status,
  }));
  return { ...doc, units: [...doc.units, ...units] };
}

/** Purpose: the document with one fleet vehicle changed. */
export function withUnit(doc: FleetDoc, id: string, change: Partial<Omit<FleetUnit, "id">>): FleetDoc {
  return { ...doc, units: doc.units.map((u) => (u.id === id ? { ...u, ...change } : u)) };
}

/** Purpose: the document without some fleet vehicles. */
export function withoutUnits(doc: FleetDoc, ids: readonly string[]): FleetDoc {
  const drop = new Set(ids);
  return { ...doc, units: doc.units.filter((u) => !drop.has(u.id)) };
}

/** Purpose: the fleet numbers used more than once. */
export function duplicateNumbers(doc: FleetDoc): ReadonlySet<string> {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const u of doc.units) {
    if (!u.number) continue;
    if (seen.has(u.number)) dup.add(u.number);
    seen.add(u.number);
  }
  return dup;
}
