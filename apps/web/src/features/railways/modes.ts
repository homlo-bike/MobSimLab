import type { MessageKey } from "../../i18n/messages";
import type { Level, Power, RailMode } from "./types";

/** Rail modes in display order, with their message keys. Design values come from the engine (assumption library). */
export const RAIL_MODES: { id: RailMode; label: MessageKey }[] = [
  { id: "tram", label: "mode.tram" },
  { id: "light_rail", label: "mode.light_rail" },
  { id: "metro", label: "mode.metro" },
  { id: "commuter_rail", label: "mode.commuter_rail" },
  { id: "regional_rail", label: "mode.regional_rail" },
  { id: "long_distance_rail", label: "rail.mode.long_distance_rail" },
  { id: "high_speed_rail", label: "mode.high_speed_rail" },
];

/** Levels lowest first, with the short labels of the mockup (message keys where they are words). */
export const LEVELS: { id: Level; short: string | MessageKey; label: MessageKey }[] = [
  { id: "underground2", short: "−2", label: "rail.level.underground2" },
  { id: "underground", short: "−1", label: "rail.level.underground" },
  { id: "street", short: "rail.level.streetShort", label: "rail.level.street" },
  { id: "elevated", short: "+1", label: "rail.level.elevated" },
  { id: "elevated2", short: "+2", label: "rail.level.elevated2" },
];

export const LEVEL_LABEL: Record<Level, MessageKey> = Object.fromEntries(
  LEVELS.map((l) => [l.id, l.label]),
) as Record<Level, MessageKey>;

export const POWER: { id: Power; label: MessageKey }[] = [
  { id: "auto", label: "rail.power.auto" },
  { id: "overhead", label: "rail.power.overhead" },
  { id: "third_rail", label: "rail.power.third_rail" },
  { id: "none", label: "rail.power.none" },
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
  existing: "#7d6a9e",
  stopLine: "#ffffff",
  barrier: "#d0342c",
  signalMain: "#d0342c",
  signalShunt: "#f8fafc",
  signalDistant: "#eab308",
  signalMarker: "#2563eb",
  signalSpeed: "#0891b2",
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
