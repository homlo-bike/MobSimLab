/** Purpose: metres as "850 m" or "2.4 km". */
export const fmtLen = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

/** Purpose: seconds as "45 s", "6 min" or "6 min 30 s". */
export function fmtDur(s: number): string {
  if (s < 90) return `${Math.round(s)} s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return r >= 5 && m < 20 ? `${m} min ${r} s` : `${Math.round(s / 60)} min`;
}

/** Purpose: a whole number with thousands separators. */
export const fmtInt = (n: number) => Math.round(n).toLocaleString("en-GB");
