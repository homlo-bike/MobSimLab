import type { Level, Power, RailMode } from "./types";

/** Rail modes in display order. Design values come from the engine (assumption library). */
export const RAIL_MODES: { id: RailMode; label: string }[] = [
  { id: "tram", label: "Tram" },
  { id: "light_rail", label: "Light rail" },
  { id: "metro", label: "Metro" },
  { id: "commuter_rail", label: "Commuter rail" },
  { id: "regional_rail", label: "Regional rail" },
  { id: "long_distance_rail", label: "Intercity" },
  { id: "high_speed_rail", label: "High-speed rail" },
];

/** Levels lowest first, with the short labels of the mockup. */
export const LEVELS: { id: Level; short: string; label: string }[] = [
  { id: "underground2", short: "−2", label: "Underground −2" },
  { id: "underground", short: "−1", label: "Underground −1" },
  { id: "street", short: "Street", label: "Street level" },
  { id: "elevated", short: "+1", label: "Elevated +1" },
  { id: "elevated2", short: "+2", label: "Elevated +2" },
];

export const LEVEL_LABEL: Record<Level, string> = Object.fromEntries(
  LEVELS.map((l) => [l.id, l.label]),
) as Record<Level, string>;

export const POWER: { id: Power; label: string }[] = [
  { id: "auto", label: "Mode default" },
  { id: "overhead", label: "Overhead" },
  { id: "third_rail", label: "Third rail" },
  { id: "none", label: "None" },
];

/** Drawing colours (mockup tokens, light theme). */
export const COLORS = {
  rail: "#2c3034",
  sleeper: "#b3a995",
  ballast: "#d5cebf",
  paving: "#cdcfca",
  tunnel: "#3d4550",
  deck: "#7a8ba0",
  platform: "#e8e0cb",
  platformEdge: "#d9a900",
  wire: "#9c6c00",
  third: "#c9470f",
  storage: "#858b90",
  accent: "#0c6a60",
  error: "#bf3a2b",
  warn: "#b97300",
  info: "#3a6aa0",
  ok: "#2e7a3a",
  road: "#6f7377",
  tramLane: "#ffffff",
  stopLine: "#ffffff",
  barrier: "#d0342c",
  signalMain: "#d0342c",
  signalShunt: "#f8fafc",
  signalDistant: "#eab308",
  signalMarker: "#2563eb",
  signalPost: "#1e293b",
};

/** Purpose: shift a level up or down by `d` steps, clamped to the five levels. */
export function shiftLevel(l: Level, d: number): Level {
  const i = LEVELS.findIndex((x) => x.id === l);
  return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, i + d))]!.id;
}

/** Purpose: format metres like the panel ("85 m", "1.25 km"). */
export function fmtM(m: number): string {
  if (!Number.isFinite(m)) return "—";
  if (Math.abs(m) >= 10000) return `${(m / 1000).toFixed(1)} km`;
  if (Math.abs(m) >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${Math.round(m)} m`;
}

/** Purpose: format seconds as "m:ss min" or "h:mm h". */
export function fmtTime(s: number): string {
  const t = Math.round(s);
  if (t >= 3600) return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")} h`;
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")} min`;
}
