/**
 * Bridges and locks for the ferry route checks (ADR-0036 §6): OSM road and railway bridges with the height a
 * vessel can pass under them, and the locks of canals and rivers, inside a bounding box. The water route kit
 * checks which a ferry leg passes (crates/mode-kits/src/water_checks.rs).
 * Data © OpenStreetMap contributors, ODbL.
 */
import type { Bbox, Pt } from "./water";

export interface WaterBridge {
  name: string;
  line: Pt[];
  /** Height above the water a vessel can pass under (closed, for a bridge that opens), m; null when not mapped. */
  clearance_m: number | null;
  /** Whether the bridge opens for vessels. */
  movable: boolean;
}

export interface WaterLock {
  name: string;
  /** The lock's way, or its gate as one point. */
  line: Pt[];
}

export interface WaterCrossings {
  bridges: WaterBridge[];
  locks: WaterLock[];
}

/** Purpose: Overpass QL for the bridges and locks of a box, with their geometry. */
export function crossingsQuery(b: Bbox): string {
  const box = [b[1], b[0], b[3], b[2]].map((v) => v.toFixed(6)).join(",");
  return (
    `[out:json][timeout:120][maxsize:134217728];(` +
    `way["bridge"]["bridge"!="no"]["highway"](${box});` +
    `way["bridge"]["bridge"!="no"]["railway"](${box});` +
    `way["man_made"="bridge"](${box});` +
    `node["waterway"="lock_gate"](${box});` +
    `way["lock"="yes"](${box});` +
    `way["waterway"="lock_gate"](${box});` +
    `);out tags geom;`
  );
}

interface El {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: ({ lat: number; lon: number } | null)[];
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const pts = (g: El["geometry"]): Pt[] =>
  (g ?? []).filter((p): p is { lat: number; lon: number } => !!p).map((p) => [r6(p.lon), r6(p.lat)]);

/** Categories of `seamark:bridge:category` that open for vessels. */
const OPENING = new Set(["opening", "bascule", "swing", "lifting", "draw", "transporter", "retractable"]);

/**
 * Purpose: a height in metres from an OSM value such as `12`, `12.5 m` or `12'6"`; null when it cannot be
 * read.
 */
export function metres(v: string | undefined): number | null {
  if (!v) return null;
  const s = v.trim();
  const ft = /^(\d+(?:\.\d+)?)'(?:\s*(\d+(?:\.\d+)?)")?$/.exec(s);
  if (ft) return Math.round((Number(ft[1]) * 0.3048 + Number(ft[2] ?? 0) * 0.0254) * 100) / 100;
  const m = /^(\d+(?:[.,]\d+)?)\s*(m)?$/.exec(s);
  return m ? Number(m[1]!.replace(",", ".")) : null;
}

/** Purpose: the bridges and locks from an Overpass JSON answer. */
export function waterCrossings(json: string): WaterCrossings {
  const els = (JSON.parse(json) as { elements?: El[] }).elements ?? [];
  const bridges: WaterBridge[] = [];
  const locks: WaterLock[] = [];
  for (const e of els) {
    const t = e.tags ?? {};
    const name = t.lock_name ?? t["bridge:name"] ?? t.name ?? "";
    if (t.waterway === "lock_gate" || t.lock === "yes") {
      const line =
        e.type === "node" && e.lat !== undefined && e.lon !== undefined
          ? [[r6(e.lon), r6(e.lat)] as Pt]
          : pts(e.geometry);
      if (line.length) locks.push({ name, line });
      continue;
    }
    const line = pts(e.geometry);
    if (line.length < 2) continue;
    const category = t["seamark:bridge:category"] ?? "";
    const movable =
      t.bridge === "movable" ||
      (t["bridge:movable"] !== undefined && t["bridge:movable"] !== "no") ||
      category.split(";").some((c) => OPENING.has(c.trim()));
    const clearance =
      metres(t["seamark:bridge:clearance_height_closed"]) ??
      metres(t["seamark:bridge:clearance_height"]) ??
      metres(t["bridge:clearance"]);
    bridges.push({ name, line, clearance_m: clearance, movable });
  }
  return { bridges, locks };
}
