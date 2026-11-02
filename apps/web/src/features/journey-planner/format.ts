import type { Breakdown } from "./types";

/** Purpose: seconds after midnight as `HH:MM` (past midnight shows the next day's hour, e.g. `00:15`). */
export function clock(s: number): string {
  const m = Math.floor(s / 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Purpose: `HH:MM` to seconds after midnight; `null` when invalid. */
export function parseClock(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 3600 + min * 60 : null;
}

/** Purpose: a duration as `1 h 05 min`, `12 min` or `40 s`. */
export function duration(s: number): string {
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`;
}

/** The parts of a journey's time in stacking order, with a short label and chart colour (categorical slots 1–6). */
export const PARTS: { key: keyof Breakdown; label: string; short: string; color: string }[] = [
  { key: "walk_s", label: "Walking", short: "Walk", color: "#2a78d6" },
  { key: "wait_s", label: "Waiting", short: "Wait", color: "#eb6834" },
  { key: "in_vehicle_s", label: "On board", short: "On board", color: "#1baf7a" },
  { key: "transfer_walk_s", label: "Change: walking", short: "Change walk", color: "#eda100" },
  { key: "transfer_wait_s", label: "Change: waiting", short: "Change wait", color: "#e87ba4" },
  { key: "early_arrival_s", label: "Early arrival", short: "Early", color: "#008300" },
];

/** Purpose: whole minutes, rounded, for the part tiles. */
export function minutes(s: number): number {
  return Math.round(s / 60);
}
