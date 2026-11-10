import type { NoiseBuilding, NoisePopulation } from "./types";

/** Where the people counts come from (the API's WorldPop source). */
export interface PopulationSource {
  name: string;
  dataset: string;
  url: string;
  licence: string;
  year: number;
  countries: string[];
  citation: string;
}

/** The API's answer: the grid, or why there is none. */
export type PopulationAnswer =
  | { status: "ready"; grid: NoisePopulation; source: PopulationSource }
  | { status: "loading" | "unavailable"; reason: string };

/** Fetches people per cell over `[west, south, east, north]`. */
export type PopulationFetcher = (bbox: [number, number, number, number]) => Promise<PopulationAnswer>;

/** Purpose: the WorldPop grid over an area from the API (each country downloaded once to the server). */
export const fetchPopulation: PopulationFetcher = async (bbox) => {
  const res = await fetch("/api/population/grid", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bbox }),
  });
  if (res.status === 401) throw new Error("sign in to load it");
  if (!res.ok) {
    const msg = ((await res.json().catch(() => null)) as { message?: string } | null)?.message;
    throw new Error(msg || `the server answered ${res.status}`);
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
