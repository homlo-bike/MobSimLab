import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { tilesFor } from "../street-network/street-network.service";
import {
  distanceM,
  kinematicRunS,
  type Line,
  type LonLat,
  type RoutedDirection,
  type RoutedLine,
  type ScenarioDoc,
  STREET_MODES,
  stopsBbox,
} from "./scenario";
import { streetRouting, type WalkAnalysisWasm } from "./wasm";

/** OSM tiles by kind. The street network service fetches them through the outbound gateway (ADR-0017). */
export interface TileSource {
  tile(x: number, y: number): Promise<string>;
  walkTile(x: number, y: number): Promise<string>;
}
export const TILE_SOURCE = Symbol("TILE_SOURCE");

/** Most zoom-14 tiles one analysis or one line may load (about 12 km × 12 km at 50° N). */
export const MAX_TILES = 64;
/** Walk graphs kept built in memory. */
const WALK_CACHE = 3;

/** A request is too large or the data is unavailable; the message is shown to the agent. */
export class NetworkError extends Error {}

/** One point of the street line router's view (crates/street-routing `LineView`). */
interface ViewPoint {
  id: number;
  status: "ok" | "warning" | "error";
  message: string | null;
  name: string;
}
interface ViewLeg {
  coords: LonLat[];
  length_m: number;
  time_s: number;
  status: "ok" | "warning" | "error";
  message: string | null;
}
interface LineView {
  points: ViewPoint[];
  legs: ViewLeg[];
  issues: string[];
}

/**
 * Street and walk networks for agent scenarios: routes street lines with the street line router, lays rail
 * lines along their given geometry, and builds the walk graph for an area.
 */
@Injectable()
export class NetworkService {
  private readonly walk = new Map<string, WalkAnalysisWasm>();

  constructor(@Inject(TILE_SOURCE) private readonly tiles: TileSource) {}

  private tileList(bbox: [number, number, number, number]): [number, number][] {
    const t = tilesFor(bbox);
    if (t.length > MAX_TILES)
      throw new NetworkError(
        `The area needs ${t.length} street tiles; at most ${MAX_TILES} (about 12 km × 12 km) are loaded at once. ` +
          "Use a smaller study area (set_study_area) or split the scenario.",
      );
    return t;
  }

  /**
   * Purpose: the walk graph covering a bounding box, built once per tile set and kept in a small cache.
   * Side effects: fetches walk tiles (cached by the street network service).
   */
  async walkGraph(bbox: [number, number, number, number]): Promise<WalkAnalysisWasm> {
    const t = this.tileList(bbox);
    const key = t.map(([x, y]) => `${x}/${y}`).join(",");
    const hit = this.walk.get(key);
    if (hit) {
      this.walk.delete(key);
      this.walk.set(key, hit);
      return hit;
    }
    const xmls = await Promise.all(t.map(([x, y]) => this.tiles.walkTile(x, y)));
    const w = new (streetRouting().WalkAnalysis)();
    try {
      for (const xml of xmls) w.add_osm(xml);
      w.build();
    } catch (e) {
      w.free();
      throw new NetworkError(errorText(e));
    }
    this.walk.set(key, w);
    while (this.walk.size > WALK_CACHE) {
      const old = this.walk.keys().next().value as string;
      this.walk.get(old)?.free();
      this.walk.delete(old);
    }
    return w;
  }

  /**
   * Purpose: route every line whose stops, mode or geometry changed since it was last routed.
   * Inputs: the document. Output: the document with `routed` up to date (a new object).
   */
  async route(doc: ScenarioDoc): Promise<ScenarioDoc> {
    const routed: Record<string, RoutedLine> = {};
    for (const l of doc.lines) {
      const input = lineInput(doc, l);
      const prev = doc.routed[l.id];
      routed[l.id] = prev && prev.input === input ? prev : await this.routeLine(doc, l, input);
    }
    return { ...doc, routed };
  }

  private async routeLine(doc: ScenarioDoc, l: Line, input: string): Promise<RoutedLine> {
    const stops = l.stop_ids.map((id) => doc.stops.find((s) => s.id === id)!);
    if (!STREET_MODES.includes(l.mode)) return railLine(l, stops, input);
    const t = this.tileList(stopsBbox(stops, 600));
    const xmls = await Promise.all(t.map(([x, y]) => this.tiles.tile(x, y)));
    const mod = streetRouting();
    const ed = new mod.StreetLineEditor();
    try {
      for (const xml of xmls) ed.add_osm(xml);
      try {
        ed.rebuild();
      } catch (e) {
        return { input, source: "street-router", directions: [], issues: [errorText(e)] };
      }
      ed.set_settings(mod.StreetLineEditor.default_profile(l.mode), mod.StreetLineEditor.default_rules());
      // Outbound A … Z, then back through the inner stops; the circuit closes at A (ADR-0029).
      const seq = [...stops, ...stops.slice(1, -1).reverse()];
      const last = stops.length - 1;
      seq.forEach((s, i) => ed.insert_point(i, s.lon, s.lat, i === 0 || i === last ? "end_stop" : "stop"));
      const view = JSON.parse(ed.view()) as LineView;
      return streetDirections(
        view,
        stops.map((s) => s.id),
        input,
      );
    } finally {
      ed.free();
    }
  }
}

/** Purpose: hash of what a line's routing depends on. */
export function lineInput(doc: ScenarioDoc, l: Line): string {
  const pts = l.stop_ids.map((id) => {
    const s = doc.stops.find((x) => x.id === id);
    return s ? [s.lon, s.lat] : null;
  });
  return createHash("sha256")
    .update(
      JSON.stringify({ mode: l.mode, pts, route: STREET_MODES.includes(l.mode) ? null : (l.route ?? null) }),
    )
    .digest("base64url")
    .slice(0, 22);
}

/** Purpose: both directions from the router's circuit view, whose points are the stops out and back. */
export function streetDirections(view: LineView, stopIds: string[], input: string): RoutedLine {
  const m = stopIds.length;
  const issues = [...view.issues];
  view.points.forEach((p, i) => {
    if (p.status !== "ok" && p.message) issues.push(`stop ${pointStop(stopIds, i)}: ${p.message}`);
  });
  view.legs.forEach((g, i) => {
    if (g.status !== "ok" && g.message)
      issues.push(
        `${pointStop(stopIds, i)} → ${pointStop(stopIds, (i + 1) % view.legs.length)}: ${g.message}`,
      );
  });
  const dir = (legs: ViewLeg[], ids: string[]): RoutedDirection => {
    const coords: LonLat[] = [];
    for (const g of legs) coords.push(...(coords.length ? g.coords.slice(1) : g.coords));
    return {
      stop_ids: ids,
      coords: coords.map(round6),
      length_m: Math.round(legs.reduce((a, g) => a + g.length_m, 0)),
      run_s: [0, ...legs.map((g) => Math.round(g.time_s))],
    };
  };
  const legs = view.legs;
  return {
    input,
    source: "street-router",
    directions:
      legs.length === 2 * m - 2
        ? [dir(legs.slice(0, m - 1), stopIds), dir(legs.slice(m - 1), [...stopIds].reverse())]
        : [],
    issues,
  };
}

function pointStop(stopIds: string[], i: number): string {
  const m = stopIds.length;
  return i < m ? (stopIds[i] ?? "?") : (stopIds[2 * m - 2 - i] ?? "?");
}

/** Purpose: a rail or tram line along its given geometry, else straight between stations. */
export function railLine(
  l: Line,
  stops: { id: string; lon: number; lat: number }[],
  input: string,
): RoutedLine {
  const issues: string[] = [];
  const pts: LonLat[] = stops.map((s) => [s.lon, s.lat]);
  let coords: LonLat[] = pts;
  let seg: number[] = pts.slice(1).map((p, i) => distanceM(pts[i]!, p));
  let source: RoutedLine["source"] = "straight";
  if (l.route) {
    const ch = chainages(l.route, pts);
    const far = stops.filter((_, i) => ch.offset[i]! > 200).map((s) => s.id);
    if (far.length) issues.push(`stations more than 200 m from the given route: ${far.join(", ")}`);
    coords = l.route;
    seg = ch.at.slice(1).map((c, i) => Math.max(0, c - ch.at[i]!));
    source = "given-route";
  } else {
    issues.push("no track geometry given; distances are straight lines between stations");
  }
  const run = [0, ...seg.map((d) => Math.round(kinematicRunS(d, l.mode)))];
  const len = Math.round(seg.reduce((a, b) => a + b, 0));
  return {
    input,
    source,
    directions: [
      { stop_ids: stops.map((s) => s.id), coords: coords.map(round6), length_m: len, run_s: run },
      {
        stop_ids: stops.map((s) => s.id).reverse(),
        coords: [...coords].reverse().map(round6),
        length_m: len,
        run_s: [0, ...run.slice(1).reverse()],
      },
    ],
    issues,
  };
}

/** Purpose: chainage of each point along a polyline (never going backwards) and its offset from it. */
export function chainages(route: LonLat[], pts: LonLat[]): { at: number[]; offset: number[] } {
  const cum = [0];
  for (let i = 1; i < route.length; i++) cum.push(cum[i - 1]! + distanceM(route[i - 1]!, route[i]!));
  const at: number[] = [];
  const offset: number[] = [];
  let from = 0;
  let last = 0;
  for (const p of pts) {
    let best = { d: Infinity, c: last, i: from };
    for (let i = from; i < route.length - 1; i++) {
      const a = route[i]!;
      const b = route[i + 1]!;
      const segLen = cum[i + 1]! - cum[i]!;
      // Project in a local frame around a.
      const kx = Math.cos((a[1] * Math.PI) / 180) * 111_195;
      const ky = 111_195;
      const bx = (b[0] - a[0]) * kx;
      const by = (b[1] - a[1]) * ky;
      const px = (p[0] - a[0]) * kx;
      const py = (p[1] - a[1]) * ky;
      const l2 = bx * bx + by * by;
      const t = l2 > 0 ? Math.min(1, Math.max(0, (px * bx + py * by) / l2)) : 0;
      const d = Math.hypot(px - t * bx, py - t * by);
      const c = cum[i]! + t * segLen;
      if (c + 1e-6 < last) continue;
      if (d < best.d - 1e-9) best = { d, c, i };
    }
    at.push(best.c);
    offset.push(best.d);
    last = best.c;
    from = best.i;
  }
  return { at, offset };
}

function round6(p: LonLat): LonLat {
  return [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6];
}

/** Purpose: the message of an error thrown by WebAssembly or JavaScript. */
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
