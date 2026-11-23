import { csrfHeader } from "../../session/csrf";
import type { NoiseBuilding, NoisePopulation } from "./types";
import { withApiMsg } from "../../i18n/engine";

/**
 * Where the people counts come from: the API's WorldPop source, or the project's own population layer
 * (`id` "layer:<id>", `year` its reference year or null).
 */
export interface PopulationSource {
  id?: string;
  name: string;
  dataset: string;
  url: string;
  licence: string;
  year: number | null;
  countries: string[];
  citation: string;
}

/** The API's answer: the grid, or why there is none. */
export type PopulationAnswer =
  | { status: "ready"; grid: NoisePopulation; source: PopulationSource }
  | {
      status: "loading";
      reason: string;
      countries: string[];
      /** How far the server's downloads are; `totalBytes` null when a size is unknown. Older servers omit it. */
      progress?: { receivedBytes: number; totalBytes: number | null };
    }
  | { status: "unavailable"; reason: string };

/** Fetches people per cell over `[west, south, east, north]`. */
export type PopulationFetcher = (bbox: [number, number, number, number]) => Promise<PopulationAnswer>;

/** Purpose: the WorldPop grid over an area from the API (each country downloaded once to the server). */
export const fetchPopulation: PopulationFetcher = async (bbox) => {
  const res = await fetch("/api/population/grid", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeader() },
    body: JSON.stringify({ bbox }),
  });
  if (res.status === 401) throw new Error("sign in to load it");
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { message?: string } | null;
    throw withApiMsg(new Error(j?.message || `the server answered ${res.status}`), j);
  }
  return (await res.json()) as PopulationAnswer;
};

/** Purpose: the box round the buildings `[west, south, east, north]`, or null without buildings. */
export function buildingsBbox(buildings: NoiseBuilding[]): [number, number, number, number] | null {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const b of buildings)
    for (const [lon, lat] of b.ring) {
      w = Math.min(w, lon);
      s = Math.min(s, lat);
      e = Math.max(e, lon);
      n = Math.max(n, lat);
    }
  return Number.isFinite(w) && e > w && n > s ? [w, s, e, n] : null;
}

/** Longest side of one request for people, degrees: under the API's 0.3° (about 30 km). */
const PIECE_DEG = 0.25;
/** The cell of WorldPop's grid, degrees (3 arc seconds); pieces are cut on its lines so they do not overlap. */
const CELL_DEG = 1 / 1200;

/**
 * Purpose: the people per cell over the buildings of a noise map, asked for in pieces of at most 0.25° a side when
 * the buildings spread wider (a city's lines), and joined into one grid. Only the pieces holding a building are
 * asked for.
 * Inputs: the box round the buildings, the buildings, and the fetcher for one piece.
 * Output: the joined grid; else the first piece's answer that is `unavailable`, else the first `loading` one.
 */
export async function fetchPopulationOver(
  bbox: [number, number, number, number],
  buildings: NoiseBuilding[],
  fetchPeople: PopulationFetcher,
): Promise<PopulationAnswer> {
  const [w, s, e, n] = bbox;
  if (e - w <= PIECE_DEG && n - s <= PIECE_DEG) return fetchPeople(bbox);
  // Piece edges on the grid's lines, from the south-west cell line.
  const step = Math.floor(PIECE_DEG / CELL_DEG) * CELL_DEG;
  const x0 = Math.floor((w + 180) / CELL_DEG) * CELL_DEG - 180;
  const y0 = Math.floor((s + 90) / CELL_DEG) * CELL_DEG - 90;
  const cols = Math.max(1, Math.ceil((e - x0) / step));
  const rows = Math.max(1, Math.ceil((n - y0) / step));
  const used = new Set<number>();
  for (const b of buildings) {
    const p = b.ring[0];
    if (!p) continue;
    const c = Math.min(cols - 1, Math.max(0, Math.floor((p[0] - x0) / step)));
    const r = Math.min(rows - 1, Math.max(0, Math.floor((p[1] - y0) / step)));
    used.add(r * cols + c);
  }
  const pieces = [...used]
    .sort((a, b) => a - b)
    .map((k): [number, number, number, number] => {
      const [c, r] = [k % cols, Math.floor(k / cols)];
      return [
        Math.max(w, x0 + c * step),
        Math.max(s, y0 + r * step),
        Math.min(e, x0 + (c + 1) * step),
        Math.min(n, y0 + (r + 1) * step),
      ];
    });
  const answers = await Promise.all(pieces.map((p) => fetchPeople(p)));
  const unavailable = answers.find((a) => a.status === "unavailable");
  if (unavailable) return unavailable;
  const loading = answers.find((a) => a.status === "loading");
  if (loading) return loading;
  const ready = answers.filter((a) => a.status === "ready");
  const grids = ready.map((a) => a.grid);
  const { dx, dy } = grids[0]!;
  const gx0 = Math.min(...grids.map((g) => g.x0));
  const gy0 = Math.min(...grids.map((g) => g.y0));
  const nx = Math.round((Math.max(...grids.map((g) => g.x0 + g.nx * dx)) - gx0) / dx);
  const ny = Math.round((Math.max(...grids.map((g) => g.y0 + g.ny * dy)) - gy0) / dy);
  const people = new Array<number>(nx * ny).fill(0);
  for (const g of grids) {
    const [ci, rj] = [Math.round((g.x0 - gx0) / dx), Math.round((g.y0 - gy0) / dy)];
    for (let j = 0; j < g.ny; j++)
      for (let i = 0; i < g.nx; i++) people[(rj + j) * nx + ci + i] = g.people[j * g.nx + i]!;
  }
  const first = ready[0]!.source;
  const countries = [...new Set(ready.flatMap((a) => a.source.countries))];
  return {
    status: "ready",
    grid: { x0: gx0, y0: gy0, dx, dy, nx, ny, people },
    source: { ...first, countries },
  };
}
