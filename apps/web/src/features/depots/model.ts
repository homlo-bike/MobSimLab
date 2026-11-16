/**
 * Road depots shared by all street lines (07-simulation §7, FR-NET-09): the project values the layout uses,
 * the vehicles and fleet of the lines that park in a depot, which depots a line may use, and the small
 * plane geometry the depot tool draws with.
 */
import data from "./defaults.generated.json";
import { paramValue } from "../costs/params";
import type { MessageKey } from "../../i18n/messages";
import type { PreferencesDoc } from "../../workspace/preferences";
import { fullTiming } from "../street-lines/modes";
import type { SavedStreetLine } from "../street-lines/saved";
import { vehicleById } from "../street-lines/service";
import { lineStats } from "../street-lines/summary";
import type { LonLat, Mode } from "../street-lines/types";
import type {
  DepotInput,
  DepotRules,
  FleetGroup,
  Gate,
  Lane,
  SavedDepot,
  Slot,
  VehicleSpec,
  ZoneKind,
} from "./types";

const LIB = (data as unknown as { params: Record<string, { label: string; unit: string; values: number[] }> })
  .params;

export const ALL_MODES: Mode[] = ["bus", "brt", "trolleybus", "intercity_bus"];
export const ZONE_KINDS: ZoneKind[] = ["parking", "charging", "maintenance", "reserve", "circulation"];

/** Map colours of the zone kinds. */
export const ZONE_COLOR: Record<ZoneKind, string> = {
  parking: "#2563eb",
  charging: "#16a34a",
  maintenance: "#9333ea",
  reserve: "#0891b2",
  circulation: "#64748b",
};

/** Purpose: the depot values the project uses: the library's central value, else the project's own. */
export function depotRules(prefs: PreferencesDoc["values"] | undefined): DepotRules {
  const v = (key: string) => {
    const own = prefs?.[key];
    if (typeof own === "number" && Number.isFinite(own) && own >= 0) return own;
    return LIB[key]?.values[1] ?? 0;
  };
  return {
    vehicles_per_lane: v("depot.vehicles_per_lane"),
    lateral_spacing_m: v("depot.lateral_spacing_m"),
    walkway_width_m: v("depot.walkway_width_m"),
    walkway_every_n_lanes: v("depot.walkway_every_n_lanes"),
    aisle_width_m: v("depot.aisle_width_m"),
    longitudinal_gap_m: v("depot.longitudinal_gap_m"),
    turning_circle_m: v("depot.turning_circle_m"),
    swept_clearance_m: v("depot.swept_clearance_m"),
    charger_power_kw: v("depot.charger_power_kw"),
  };
}

/** Purpose: the vehicle a street line runs: its catalogue vehicle, else the mode's typical vehicle. */
export function lineVehicle(line: Pick<SavedStreetLine, "profile" | "vehicle">): VehicleSpec & {
  battery: boolean;
} {
  const c = vehicleById(line.vehicle);
  if (c)
    return {
      key: c.id,
      name: c.name,
      length_m: c.length_m,
      width_m: c.width_m,
      articulations: c.articulations,
      axles_m: c.axles_m,
      turning_circle_m: c.turning_circle_m,
      battery: c.energy === "battery",
    };
  const l = line.profile.length_m;
  return {
    key: `mode:${line.profile.mode}:${l}`,
    name: "",
    length_m: l,
    width_m: 2.55,
    articulations: l > 21 ? 2 : l > 15 ? 1 : 0,
    axles_m: null,
    turning_circle_m: null,
    battery: false,
  };
}

/** Purpose: a line's vehicles with spares, as the cost estimate counts them (0 without a service yet). */
export function lineFleet(line: SavedStreetLine, prefs: PreferencesDoc["values"] | undefined): number {
  if (line.view.points.length < 2) return 0;
  const stats = lineStats(line.view, fullTiming(line.timing));
  const spare = paramValue("mode.spare_share", line.profile.mode, prefs)[1];
  return Math.ceil(stats.vehicles * (1 + spare));
}

/** Purpose: the lines that park in a depot, with their index in the project's list. */
export function linesOf(depot: SavedDepot, lines: readonly SavedStreetLine[]) {
  return lines.map((line, index) => ({ line, index })).filter((x) => x.line.depotId === depot.id);
}

/**
 * Purpose: what the depot layout functions need for a depot: the saved depot, the vehicles and fleet of the
 * lines that use it and the project values. The road simulation builds its depot request with this too.
 */
export function depotInput(
  depot: SavedDepot,
  lines: readonly SavedStreetLine[],
  prefs: PreferencesDoc["values"] | undefined,
): DepotInput {
  const vehicles = new Map<string, VehicleSpec>();
  const fleet: FleetGroup[] = [];
  for (const { line, index } of linesOf(depot, lines)) {
    const { battery, ...spec } = lineVehicle(line);
    if (!spec.name) spec.name = line.name || `Street line ${index + 1}`;
    if (!vehicles.has(spec.key)) vehicles.set(spec.key, spec);
    fleet.push({
      line: `street:${index}`,
      name: line.name || `Street line ${index + 1}`,
      vehicle: spec.key,
      count: lineFleet(line, prefs),
      charging: battery,
    });
  }
  return {
    boundary: depot.boundary,
    gates: depot.gates,
    zones: depot.zones,
    vehicles: [...vehicles.values()],
    fleet,
    rules: depotRules(prefs),
    layout: depot.layout,
  };
}

/** Purpose: whether a vehicle fits a slot: long enough, and wide enough with 0.3 m to spare. */
export function fits(
  v: Pick<VehicleSpec, "length_m" | "width_m">,
  s: Pick<Slot, "length_m" | "width_m">,
): boolean {
  return v.length_m <= s.length_m + 0.05 && v.width_m <= s.width_m - 0.3 + 1e-9;
}

/** Why a line cannot use a depot, or null when it can. */
export type FitProblem = "depot.fit.mode" | "depot.fit.size" | null;

/**
 * Purpose: whether a line may pull out of and in to a depot: the depot takes its mode, and (once laid
 * out) has a parking, charging or reserve slot its vehicle fits. A depot not laid out yet takes any line of
 * its modes.
 */
export function depotFit(depot: SavedDepot, line: Pick<SavedStreetLine, "profile" | "vehicle">): FitProblem {
  if (!depot.modes.includes(line.profile.mode)) return "depot.fit.mode";
  const lanes = depot.layout?.lanes ?? [];
  if (!lanes.length) return null;
  const v = lineVehicle(line);
  const ok = lanes.some((l) => l.kind !== "maintenance" && l.slots.some((s) => fits(v, s)));
  return ok ? null : "depot.fit.size";
}

/** Purpose: a depot's gates for the street line tool's depot runs: exits for pull-out, entrances for pull-in. */
export function depotGates(depot: SavedDepot): { exits: LonLat[]; entrances: LonLat[] } {
  const by = (k: (g: Gate) => boolean) => depot.gates.filter(k).map((g) => g.lonlat);
  return {
    exits: by((g) => g.kind !== "entrance"),
    entrances: by((g) => g.kind !== "exit"),
  };
}

/** Purpose: a new id with a prefix. */
export function newId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Purpose: an empty depot taking every street mode. */
export function newDepot(name: string): SavedDepot {
  return { id: newId("dp"), name, modes: [...ALL_MODES], boundary: [], gates: [], zones: [], layout: null };
}

// ---- Plane geometry about a point (metres east and north) ----

const R = 6371008.8;

/** Purpose: degrees to metres about `o`. */
export function toXY(o: LonLat, p: LonLat): [number, number] {
  const k = (Math.PI / 180) * R;
  return [(p[0] - o[0]) * k * Math.cos((o[1] * Math.PI) / 180), (p[1] - o[1]) * k];
}

/** Purpose: metres about `o` to degrees. */
export function toLL(o: LonLat, x: number, y: number): LonLat {
  const k = (Math.PI / 180) * R;
  return [o[0] + x / (k * Math.cos((o[1] * Math.PI) / 180)), o[1] + y / k];
}

/** Purpose: the outline of a slot as a closed ring, the vehicle body (`width` m wide) inside the slot. */
export function slotRing(s: Slot, width = Math.min(2.55, s.width_m)): LonLat[] {
  const h = ((90 - s.heading_deg) * Math.PI) / 180;
  const d: [number, number] = [Math.cos(h), Math.sin(h)];
  const n: [number, number] = [-d[1], d[0]];
  const hl = s.length_m / 2;
  const hw = width / 2;
  const corners: [number, number][] = [
    [-hl, -hw],
    [hl, -hw],
    [hl, hw],
    [-hl, hw],
  ];
  const ring = corners.map(([a, b]) => toLL(s.center, d[0] * a + n[0] * b, d[1] * a + n[1] * b));
  return [...ring, ring[0]!];
}

/** Purpose: the nearest point on a closed ring to `p` (where a gate goes on the outline). */
export function snapToRing(ring: LonLat[], p: LonLat): LonLat {
  if (ring.length < 2) return p;
  let best: LonLat = ring[0]!;
  let bestD = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = toXY(p, ring[i]!);
    const b = toXY(p, ring[(i + 1) % ring.length]!);
    const ab: [number, number] = [b[0] - a[0], b[1] - a[1]];
    const l2 = ab[0] * ab[0] + ab[1] * ab[1] || 1e-12;
    const t = Math.max(0, Math.min(1, -(a[0] * ab[0] + a[1] * ab[1]) / l2));
    const q: [number, number] = [a[0] + ab[0] * t, a[1] + ab[1] * t];
    const d = Math.hypot(q[0], q[1]);
    if (d < bestD) {
      bestD = d;
      best = toLL(p, q[0], q[1]);
    }
  }
  return best;
}

/** Purpose: area of a ring, m². */
export function ringArea(ring: LonLat[]): number {
  if (ring.length < 3) return 0;
  const o = ring[0]!;
  const xy = ring.map((p) => toXY(o, p));
  let a = 0;
  for (let i = 0; i < xy.length; i++) {
    const [x1, y1] = xy[i]!;
    const [x2, y2] = xy[(i + 1) % xy.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/** Purpose: whether a point is inside a ring (even-odd rule). */
export function inRing(ring: LonLat[], p: LonLat): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Purpose: a lane moved so its entry is at `to`, keeping its direction, slots and aisles. */
export function moveLane(lane: Lane, to: LonLat, id = lane.id): Lane {
  const [dx, dy] = toXY(lane.entry, to);
  const shift = (p: LonLat) => {
    const [x, y] = toXY(lane.entry, p);
    return toLL(lane.entry, x + dx, y + dy);
  };
  return {
    ...lane,
    id,
    entry: to,
    exit: shift(lane.exit),
    aisle_in: id === lane.id ? lane.aisle_in : null,
    aisle_out: id === lane.id ? lane.aisle_out : null,
    slots: lane.slots.map((s, k) => ({ ...s, id: `${id}-s${k + 1}`, center: shift(s.center) })),
  };
}

/**
 * Purpose: a lane with one slot fewer (the one at the entry end) or one more (added at the entry end, the
 * lane growing backwards). A lane keeps at least one slot.
 */
export function resizeLane(lane: Lane, slots: number): Lane {
  const n = Math.max(1, Math.round(slots));
  if (n === lane.slots.length || !lane.slots.length) return lane;
  if (n < lane.slots.length) {
    const kept = lane.slots.slice(0, n);
    const last = kept[n - 1]!;
    // The entry moves to the back of the last slot kept.
    const [ex, ey] = toXY(last.center, lane.exit);
    const len = Math.hypot(ex, ey) || 1;
    const pitch = pitchOf(lane);
    const back = toLL(last.center, (-ex / len) * (pitch / 2), (-ey / len) * (pitch / 2));
    return { ...lane, entry: back, slots: kept };
  }
  const pitch = pitchOf(lane);
  const [ex, ey] = toXY(lane.entry, lane.exit);
  const len = Math.hypot(ex, ey) || 1;
  const back: [number, number] = [-ex / len, -ey / len];
  const slotsOut = [...lane.slots];
  const lastSlot = lane.slots[lane.slots.length - 1]!;
  for (let k = lane.slots.length; k < n; k++) {
    const steps = k - lane.slots.length + 1;
    slotsOut.push({
      ...lastSlot,
      id: `${lane.id}-s${k + 1}`,
      center: toLL(lastSlot.center, back[0] * pitch * steps, back[1] * pitch * steps),
    });
  }
  const add = (n - lane.slots.length) * pitch;
  return { ...lane, entry: toLL(lane.entry, back[0] * add, back[1] * add), slots: slotsOut };
}

/** Purpose: distance between neighbouring slots of a lane, m. */
function pitchOf(lane: Lane): number {
  if (lane.slots.length >= 2) {
    const [x, y] = toXY(lane.slots[0]!.center, lane.slots[1]!.center);
    return Math.hypot(x, y);
  }
  const [x, y] = toXY(lane.entry, lane.exit);
  return Math.hypot(x, y);
}

/** Message keys of the zone kinds. */
export const ZONE_LABEL: Record<ZoneKind, MessageKey> = {
  parking: "depot.zone.parking",
  charging: "depot.zone.charging",
  maintenance: "depot.zone.maintenance",
  reserve: "depot.zone.reserve",
  circulation: "depot.zone.circulation",
};
