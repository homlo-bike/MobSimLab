import type { LaneProfile } from "./lanes";
import type { RoadUser, Section, SectionDir, SectionKind, StreetInfo } from "./types";

/** The road users a lane can be for, in the order the editor lists them. */
export const ROAD_USERS: readonly RoadUser[] = ["car", "bus", "tram", "bike", "taxi", "walk"];

/** The kinds of section, in the order the editor lists them. */
export const SECTION_KINDS: readonly SectionKind[] = ["lane", "parking", "island", "green", "protection"];

/** How each strip that no one travels along can be built or planted; the first is the default. */
export const STYLES: Partial<Record<SectionKind, readonly string[]>> = {
  protection: ["kerb", "bollards", "planters"],
  island: ["raised", "painted"],
  green: ["trees", "grass", "shrubs"],
};

/** Typical widths in metres of a new section. */
export const KIND_WIDTH: Record<SectionKind, number> = {
  lane: 3.1,
  parking: 2.3,
  island: 2,
  green: 2.5,
  protection: 0.5,
};

/** Narrowest and widest section the editor accepts, m. */
export const MIN_WIDTH = 0.3;
export const MAX_WIDTH = 12;

/** Purpose: a new section of a kind, with its typical width and style. */
export function newSection(
  kind: SectionKind,
  users: RoadUser[] = [],
  dir: SectionDir | null = null,
): Section {
  const style = STYLES[kind]?.[0] ?? null;
  return { kind, users, dir, width: typicalWidth(kind, users), style };
}

/** Purpose: the typical width of a section for its users (a pavement 3 m, a bike lane 1.8 m...). */
export function typicalWidth(kind: SectionKind, users: readonly RoadUser[]): number {
  if (kind !== "lane") return KIND_WIDTH[kind];
  if (users.length === 1 && users[0] === "walk") return 3;
  if (users.length === 1 && users[0] === "bike") return 1.8;
  if (users.includes("bus") && !users.includes("car")) return 3.3;
  return KIND_WIDTH.lane;
}

/** Purpose: whether `u` may use the section. */
export const has = (s: Section, u: RoadUser) => s.kind === "lane" && (s.users ?? []).includes(u);

/** Purpose: whether vehicles or bikes travel along it (a lane with a user other than pedestrians). */
export const moves = (s: Section) => s.kind === "lane" && (s.users ?? []).some((u) => u !== "walk");

/** Purpose: whether it runs forward (along the way as drawn) or backward. */
export function goes(s: Section, forward: boolean): boolean {
  if (!moves(s)) return false;
  const d = s.dir ?? "both";
  return d === "both" || d === (forward ? "forward" : "backward");
}

/** Purpose: whether it is a lane of its own for `u`: `u` may use it and cars may not. */
export const own = (s: Section, u: RoadUser) => has(s, u) && !has(s, "car");

const shields = (s: Section | undefined) =>
  !!s && (s.kind === "parking" || s.kind === "island" || s.kind === "green" || s.kind === "protection");

/** What a custom layout means for traffic (Rust `street_routing::sections::Layout`). */
export interface Layout {
  carsForward: number;
  carsBackward: number;
  busForward: boolean;
  busBackward: boolean;
  busLanes: number;
  bikeLane: boolean;
  tram: boolean;
  tramOwnLane: boolean;
  /** Every bus, tram and bike lane of its own is shielded from the traffic, or no cars use the street. */
  separated: boolean;
}

/** Purpose: reduce the sections to what the routing reads, by the rules of `street_routing::sections`. */
export function layoutOf(sections: readonly Section[]): Layout {
  const count = (f: (s: Section) => boolean) => sections.filter(f).length;
  const any = (f: (s: Section) => boolean) => sections.some(f);
  const carsForward = count((s) => goes(s, true) && has(s, "car"));
  const carsBackward = count((s) => goes(s, false) && has(s, "car"));
  const noCars = carsForward + carsBackward === 0;
  const separated =
    noCars ||
    sections.every((s, i) => {
      const mine = own(s, "bus") || own(s, "tram") || own(s, "bike");
      return !mine || !moves(s) || shields(sections[i - 1]) || shields(sections[i + 1]);
    });
  const tram = any((s) => has(s, "tram"));
  const tramDir = (ownLane: boolean, f: boolean) =>
    any((s) => goes(s, f) && (ownLane ? own(s, "tram") : has(s, "tram")));
  return {
    carsForward,
    carsBackward,
    busForward: any((s) => goes(s, true) && has(s, "bus")),
    busBackward: any((s) => goes(s, false) && has(s, "bus")),
    busLanes: count((s) => moves(s) && own(s, "bus")),
    bikeLane: any((s) => moves(s) && own(s, "bike")),
    tram,
    tramOwnLane: tram && [true, false].every((f) => !tramDir(false, f) || tramDir(true, f)),
    separated,
  };
}

/** Purpose: the users of a lane in the editor's order. */
export function sortedUsers(s: Section): RoadUser[] {
  return ROAD_USERS.filter((u) => (s.users ?? []).includes(u));
}

/** How a section reads: its name key and the users it lists (for mixed traffic). */
export type SectionName =
  | { key: "new" | "general" | "shared" | "parking" | "island" | "green" | "protection" }
  | { key: "one"; user: RoadUser }
  | { key: "mixed"; users: RoadUser[] };

/** Purpose: what to call a section: a bus lane, general traffic, a shared path, cars + trams... */
export function sectionName(s: Section): SectionName {
  if (s.kind !== "lane") return { key: s.kind };
  const us = sortedUsers(s);
  if (us.length === 0) return { key: "new" };
  if (us.length === 1) return { key: "one", user: us[0]! };
  if (us.length === 2 && us[0] === "bike" && us[1] === "walk") return { key: "shared" };
  if (us[0] === "car" && !us.includes("tram")) return { key: "general" };
  return { key: "mixed", users: us };
}

/** Colours of the users and strips, as on the map's lanes. */
export const USER_COLOR: Record<RoadUser, string> = {
  car: "#9ca3af",
  bus: "#f87171",
  tram: "#c2a878",
  bike: "#4ade80",
  taxi: "#facc15",
  walk: "#e2e8f0",
};
export const KIND_COLOR: Record<Exclude<SectionKind, "lane">, string> = {
  parking: "#93c5fd",
  island: "#d6d3d1",
  green: "#86a865",
  protection: "#475569",
};

/** Purpose: the fill of a section: its user's colour, stripes of the first two for mixed traffic. */
export function sectionFill(s: Section): string {
  if (s.kind !== "lane") return KIND_COLOR[s.kind];
  const us = sortedUsers(s);
  if (us.length === 0) return "repeating-linear-gradient(135deg,#f8fafc 0 6px,#e2e8f0 6px 12px)";
  if (us.length === 1) return USER_COLOR[us[0]!];
  return `repeating-linear-gradient(135deg,${USER_COLOR[us[0]!]} 0 10px,${USER_COLOR[us[1]!]} 10px 20px)`;
}

/** The users a lane of the lane engine stands for, when the planner starts from OSM's lanes. */
const USERS_OF: Partial<Record<LaneProfile["kind"], RoadUser[]>> = {
  traffic: ["car", "bus", "taxi", "bike"],
  bus: ["bus", "taxi"],
  bike: ["bike"],
  tram: ["tram"],
  pavement: ["walk"],
  footway: ["walk"],
  shared_use: ["bike", "walk"],
};

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Purpose: the street's lanes from OpenStreetMap (the lane engine's profile) as sections to start a custom
 * layout from. Traffic lanes carry cars, buses, taxis and bikes; a traffic lane with rails trams too.
 */
export function sectionsFromLanes(lanes: readonly LaneProfile[]): Section[] {
  return lanes.map((l) => {
    const width = round1(Math.max(MIN_WIDTH, l.width));
    const dir: SectionDir = l.dir;
    switch (l.kind) {
      case "parking":
        return { ...newSection("parking"), width };
      case "kerb":
        return { ...newSection("protection"), width };
      case "island":
        return { ...newSection("island"), width };
      case "green":
        return { ...newSection("green"), width };
      case "buffer":
      case "construction":
        return { ...newSection("island"), style: "painted", width };
      default: {
        const users = [...(USERS_OF[l.kind] ?? [])];
        if (l.rails && !users.includes("tram")) users.push("tram");
        const walkOnly = users.every((u) => u === "walk");
        return { kind: "lane", users, dir: walkOnly ? null : dir, width, style: null };
      }
    }
  });
}

/**
 * Purpose: a typical layout of the street from what OSM says (when its lanes are not built yet): a pavement
 * each side and its traffic lanes, half each way on a two-way street.
 */
export function sectionsFromInfo(info: StreetInfo, trafficLanes: number): Section[] {
  const general: RoadUser[] = ["car", "bus", "taxi", "bike"];
  const walk = newSection("lane", ["walk"]);
  if (info.oneway)
    return [
      walk,
      ...Array.from({ length: trafficLanes }, () => newSection("lane", [...general], "forward")),
      walk,
    ];
  const back = Math.floor(trafficLanes / 2) || 1;
  const fwd = Math.max(1, trafficLanes - back);
  return [
    walk,
    ...Array.from({ length: back }, () => newSection("lane", [...general], "backward")),
    ...Array.from({ length: fwd }, () => newSection("lane", [...general], "forward")),
    { ...walk },
  ];
}

/** Ready-made layouts to start from. */
export type TemplateId = "centreBus" | "tramPeople" | "protectedBike" | "tramBus";
export const TEMPLATES: readonly TemplateId[] = ["centreBus", "tramPeople", "protectedBike", "tramBus"];

/** Purpose: the sections of a ready-made layout. */
export function template(id: TemplateId): Section[] {
  const walk = () => newSection("lane", ["walk"]);
  const lane = (users: RoadUser[], dir: SectionDir) => newSection("lane", users, dir);
  const strip = (kind: SectionKind, style?: string, width?: number) => {
    const s = newSection(kind);
    return { ...s, style: style ?? s.style, width: width ?? s.width };
  };
  switch (id) {
    case "centreBus":
      return [
        walk(),
        lane(["car", "taxi", "bike"], "backward"),
        lane(["car", "taxi", "bike"], "backward"),
        strip("protection"),
        lane(["bus"], "backward"),
        strip("island", "raised", 1.2),
        lane(["bus"], "forward"),
        strip("protection"),
        lane(["car", "taxi", "bike"], "forward"),
        lane(["car", "taxi", "bike"], "forward"),
        walk(),
      ];
    case "tramPeople":
      return [
        { ...walk(), width: 5 },
        strip("green", "trees", 3),
        lane(["tram"], "backward"),
        lane(["tram"], "forward"),
        strip("green", "trees", 3),
        { ...walk(), width: 5 },
      ];
    case "protectedBike":
      return [
        walk(),
        { ...lane(["bike"], "backward"), width: 2 },
        strip("protection", "planters", 0.8),
        lane(["car", "bus", "taxi"], "backward"),
        lane(["car", "bus", "taxi"], "forward"),
        strip("protection", "planters", 0.8),
        { ...lane(["bike"], "forward"), width: 2 },
        walk(),
      ];
    case "tramBus":
      return [
        walk(),
        lane(["car", "taxi", "bike"], "backward"),
        strip("protection"),
        lane(["tram", "bus"], "backward"),
        lane(["tram", "bus"], "forward"),
        strip("protection"),
        lane(["car", "taxi", "bike"], "forward"),
        walk(),
      ];
  }
}

/** Purpose: the total width of the sections, m. */
export const totalWidth = (sections: readonly Section[]) => sections.reduce((a, s) => a + s.width, 0);
