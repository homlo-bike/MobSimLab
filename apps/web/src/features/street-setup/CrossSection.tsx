import type { Effective } from "./model";

type Strip = { kind: "walk" | "bike" | "bus" | "car" | "tram" | "kerb"; dir?: "up" | "down" };

const WIDTH: Record<Strip["kind"], number> = {
  walk: 2.5,
  bike: 1.8,
  bus: 3.3,
  car: 3.1,
  tram: 6.2,
  kerb: 0.5,
};
const FILL: Record<Strip["kind"], string> = {
  walk: "#e2e8f0",
  bike: "#bbf7d0",
  bus: "#fecaca",
  car: "#cbd5e1",
  tram: "#e7e5e4",
  kerb: "#475569",
};

/** Purpose: the strips across the street, kerb to kerb, from the effective setup. */
export function strips(e: Effective, oneway: boolean): Strip[] {
  const side = (dir: "up" | "down", lanes: number): Strip[] => {
    const s: Strip[] = [];
    if (e.bikeLane) s.push({ kind: "bike", dir });
    if (e.bikeLane && e.separated) s.push({ kind: "kerb" });
    if (e.busLane) s.push({ kind: "bus", dir });
    if (e.busLane && e.separated) s.push({ kind: "kerb" });
    for (let i = 0; i < lanes; i++) s.push({ kind: "car", dir });
    return s;
  };
  const tram: Strip[] =
    e.tram === "own_lane"
      ? e.separated
        ? [{ kind: "kerb" }, { kind: "tram" }, { kind: "kerb" }]
        : [{ kind: "tram" }]
      : [];
  if (oneway) return [{ kind: "walk" }, ...side("up", e.trafficLanes), ...tram, { kind: "walk" }];
  const down = Math.floor(e.trafficLanes / 2);
  const up = e.trafficLanes - down;
  return [
    { kind: "walk" },
    ...side("down", Math.max(down, 0)),
    ...tram,
    ...side("up", up).reverse(),
    { kind: "walk" },
  ];
}

/**
 * Purpose: a cross-section of the street as set up (pavements, bike lanes, bus lanes, traffic lanes, the
 * tram's own lane and kerbs), so the planner sees the street they describe. Rails in the traffic lanes
 * mark a tram in mixed traffic.
 */
export function CrossSection({ e, oneway }: { e: Effective; oneway: boolean }) {
  const list = strips(e, oneway);
  const total = list.reduce((a, s) => a + WIDTH[s.kind], 0);
  const H = 54;
  let x = 0;
  const carIdx = list.map((s, i) => (s.kind === "car" ? i : -1)).filter((i) => i >= 0);
  // A tram in mixed traffic runs in the innermost traffic lane of each direction.
  const mixedRails =
    e.tram === "mixed" ? new Set(oneway ? carIdx.slice(-1) : innermost(list)) : new Set<number>();
  const label = list
    .filter((s) => s.kind !== "kerb")
    .map(
      (s) =>
        ({ walk: "pavement", bike: "bike lane", bus: "bus lane", car: "traffic lane", tram: "tram lane" })[
          s.kind as "walk"
        ],
    )
    .join(", ");
  return (
    <svg
      viewBox={`0 0 ${total} ${H / 10}`}
      className="h-auto w-full rounded-lg border border-slate-200"
      role="img"
      aria-label={`Cross-section: ${label}`}
      preserveAspectRatio="none"
      style={{ aspectRatio: `${total} / 5.4` }}
    >
      {list.map((s, i) => {
        const w = WIDTH[s.kind];
        const x0 = x;
        x += w;
        const h = H / 10;
        return (
          <g key={i}>
            <rect x={x0} y={0} width={w} height={h} fill={FILL[s.kind]} />
            {s.kind === "car" && list[i + 1]?.kind === "car" && (
              <line
                x1={x0 + w}
                x2={x0 + w}
                y1={0}
                y2={h}
                stroke="#fff"
                strokeWidth={0.12}
                strokeDasharray={list[i + 1]?.dir === s.dir ? "0.5 0.5" : undefined}
              />
            )}
            {s.kind === "tram" && <Rails x={x0} w={w} h={h} double />}
            {mixedRails.has(i) && <Rails x={x0} w={w} h={h} />}
            {s.dir && s.kind !== "walk" && (
              <text
                x={x0 + w / 2}
                y={h / 2 + 0.45}
                fontSize={s.kind === "bike" ? 0.8 : 1.3}
                textAnchor="middle"
                fill={s.kind === "bus" ? "#991b1b" : s.kind === "bike" ? "#166534" : "#334155"}
              >
                {s.kind === "bus" ? "BUS" : s.kind === "bike" ? "BIKE" : s.dir === "up" ? "↑" : "↓"}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Purpose: the index of the traffic lane next to the centre in each direction. */
function innermost(list: Strip[]): number[] {
  const down = list.map((s, i) => (s.kind === "car" && s.dir === "down" ? i : -1)).filter((i) => i >= 0);
  const up = list.map((s, i) => (s.kind === "car" && s.dir === "up" ? i : -1)).filter((i) => i >= 0);
  return [down.at(-1), up[0]].filter((i): i is number => i !== undefined);
}

function Rails({ x, w, h, double = false }: { x: number; w: number; h: number; double?: boolean }) {
  const gauge = 1.435;
  const centres = double ? [x + w / 2 - 1.5, x + w / 2 + 1.5] : [x + w / 2];
  return (
    <>
      {centres.flatMap((c) =>
        [c - gauge / 2, c + gauge / 2].map((r) => (
          <line key={r} x1={r} x2={r} y1={0} y2={h} stroke="#57534e" strokeWidth={0.14} />
        )),
      )}
    </>
  );
}
