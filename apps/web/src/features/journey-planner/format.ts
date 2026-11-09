import type { MessageKey } from "../../i18n/en";
import { tNow } from "../../i18n/i18n";
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
  if (s < 60) return tNow("jp.s", { n: Math.round(s) });
  const m = Math.round(s / 60);
  return m >= 60
    ? tNow("jp.hmin", { h: Math.floor(m / 60), m: String(m % 60).padStart(2, "0") })
    : tNow("jp.min", { n: m });
}

/** The parts of a journey's time in stacking order, with a short label and chart colour (categorical slots 1–6). */
export const PARTS: { key: keyof Breakdown; label: MessageKey; short: MessageKey; color: string }[] = [
  { key: "walk_s", label: "jp.part.walk", short: "jp.part.walkShort", color: "#2a78d6" },
  { key: "wait_s", label: "jp.part.wait", short: "jp.part.waitShort", color: "#eb6834" },
  { key: "in_vehicle_s", label: "jp.part.onBoard", short: "jp.part.onBoard", color: "#1baf7a" },
  { key: "transfer_walk_s", label: "jp.part.changeWalk", short: "jp.part.changeWalkShort", color: "#eda100" },
  { key: "transfer_wait_s", label: "jp.part.changeWait", short: "jp.part.changeWaitShort", color: "#e87ba4" },
  { key: "early_arrival_s", label: "jp.part.early", short: "jp.part.earlyShort", color: "#008300" },
];

/** Purpose: whole minutes, rounded, for the part tiles. */
export function minutes(s: number): number {
  return Math.round(s / 60);
}
