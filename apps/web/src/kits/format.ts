import { formatInt, tNow } from "../i18n/i18n";

/** Purpose: metres as "850 m" or "2.4 km". */
export const fmtLen = (m: number) =>
  m >= 1000 ? tNow("noise.km", { n: (m / 1000).toFixed(1) }) : tNow("noise.m", { n: Math.round(m) });

/** Purpose: seconds as "45 s", "6 min" or "6 min 30 s". */
export function fmtDur(s: number): string {
  if (s < 90) return tNow("jp.s", { n: Math.round(s) });
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return r >= 5 && m < 20 ? tNow("kit.minSec", { m, s: r }) : tNow("jp.min", { n: Math.round(s / 60) });
}

/** Purpose: a whole number with thousands separators. */
export const fmtInt = (n: number) => formatInt(n);
