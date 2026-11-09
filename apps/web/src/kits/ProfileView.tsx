import type { SpanView } from "./types";

/**
 * Purpose: longitudinal profile of a ropeway: ground, rope and the bottom of a loaded cabin, with the
 * stations and towers, drawn to a common vertical scale.
 */
export function ProfileView({ view, color }: { view: SpanView; color: string }) {
  const pts = view.profile;
  if (pts.length < 2) return null;
  const W = 340;
  const H = 120;
  const pad = 6;
  const len = Math.max(1, view.length_m);
  const ys = pts.flatMap((p) => [p.ground_m, p.ground_m + (p.obstacle_m ?? 0), p.rope_m]);
  const lo = Math.min(...ys) - 5;
  const hi = Math.max(...ys) + 5;
  const x = (m: number) => pad + ((W - 2 * pad) * m) / len;
  const y = (z: number) => H - pad - ((H - 2 * pad) * (z - lo)) / Math.max(1, hi - lo);
  const path = (k: "ground_m" | "rope_m" | "cabin_m") =>
    pts.map((p, i) => `${i ? "L" : "M"}${x(p.at_m).toFixed(1)},${y(p[k]).toFixed(1)}`).join(" ");
  const ground = `${path("ground_m")} L${x(len)},${H} L${x(0)},${H} Z`;
  // Buildings: runs of profile points with an obstacle, drawn as blocks on the ground.
  const blocks: { x0: number; x1: number; g: number; top: number }[] = [];
  pts.forEach((p, i) => {
    if (!(p.obstacle_m > 0)) return;
    const prev = blocks[blocks.length - 1];
    const x0 = (pts[i - 1]?.at_m ?? p.at_m) * 0.5 + p.at_m * 0.5;
    const x1 = (pts[i + 1]?.at_m ?? p.at_m) * 0.5 + p.at_m * 0.5;
    if (prev && pts[i - 1]?.obstacle_m) {
      prev.x1 = x1;
      prev.g = Math.min(prev.g, p.ground_m);
      prev.top = Math.max(prev.top, p.ground_m + p.obstacle_m);
    } else blocks.push({ x0, x1, g: p.ground_m, top: p.ground_m + p.obstacle_m });
  });
  const groundAt = (at: number) =>
    pts.reduce((a, b) => (Math.abs(b.at_m - at) < Math.abs(a.at_m - at) ? b : a)).ground_m;
  let base = 0;
  const towers = view.sections.flatMap((s) => {
    const out = s.towers.map((t) => {
      const at = base + t.at_m;
      const p = pts.reduce((a, b) => (Math.abs(b.at_m - at) < Math.abs(a.at_m - at) ? b : a));
      return { at, g: p.ground_m, h: t.height_m };
    });
    base += s.length_m;
    return out;
  });
  return (
    <figure className="mt-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full rounded-lg border border-slate-200 bg-white"
        role="img"
        aria-label="Longitudinal profile: ground, rope and loaded cabin"
      >
        <path d={ground} fill="#e2e8f0" />
        {blocks.map((b, i) => (
          <rect
            key={`b${i}`}
            x={x(b.x0)}
            y={y(b.top)}
            width={Math.max(1, x(b.x1) - x(b.x0))}
            height={Math.max(0, y(b.g) - y(b.top))}
            fill="#cbd5e1"
            stroke="#94a3b8"
            strokeWidth={0.5}
          />
        ))}
        {towers.map((t, i) => (
          <line
            key={i}
            x1={x(t.at)}
            x2={x(t.at)}
            y1={y(t.g)}
            y2={y(t.g + t.h)}
            stroke="#475569"
            strokeWidth={2}
          />
        ))}
        {view.stations.map((s, i) => (
          <rect key={i} x={x(s.at_m) - 3} y={y(groundAt(s.at_m)) - 10} width={6} height={10} fill={color} />
        ))}
        <path d={path("cabin_m")} fill="none" stroke="#94a3b8" strokeDasharray="3 3" strokeWidth={1} />
        <path d={path("rope_m")} fill="none" stroke={color} strokeWidth={2} />
      </svg>
      <figcaption className="mt-1 text-[11px] text-slate-500">
        Rope (solid) and bottom of a loaded cabin (dashed) over the ground
        {blocks.length > 0 ? " and buildings" : ""}, {Math.round(hi - lo)} m high.
      </figcaption>
    </figure>
  );
}
