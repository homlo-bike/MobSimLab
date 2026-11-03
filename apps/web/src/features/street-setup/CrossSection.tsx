import type { Effective } from "./model";

type Strip = { kind: "walk" | "bike" | "bus" | "car" | "tram" | "kerb"; dir?: "up" | "down" };

/** Typical widths in metres, so the drawing keeps the street's proportions. */
const WIDTH: Record<Strip["kind"], number> = {
  walk: 2.5,
  bike: 1.8,
  bus: 3.3,
  car: 3.1,
  tram: 6.2,
  kerb: 0.5,
};
const STYLE: Record<Strip["kind"], string> = {
  walk: "bg-slate-200",
  bike: "bg-green-200 text-green-900",
  bus: "bg-red-200 text-red-900",
  car: "bg-slate-300 text-slate-700",
  tram: "bg-stone-200",
  kerb: "bg-slate-600",
};
const LABEL: Record<Exclude<Strip["kind"], "kerb">, string> = {
  walk: "pavement",
  bike: "bike lane",
  bus: "bus lane",
  car: "traffic lane",
  tram: "tram lane",
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
  return [{ kind: "walk" }, ...side("down", down), ...tram, ...side("up", up).reverse(), { kind: "walk" }];
}

/** Purpose: the traffic lane next to the centre in each direction (where a tram in mixed traffic runs). */
function innermost(list: Strip[], oneway: boolean): Set<number> {
  const cars = (dir: "up" | "down") =>
    list.map((s, i) => (s.kind === "car" && s.dir === dir ? i : -1)).filter((i) => i >= 0);
  if (oneway) return new Set(cars("up").slice(-1));
  return new Set([cars("down").at(-1), cars("up")[0]].filter((i): i is number => i !== undefined));
}

/**
 * Purpose: a cross-section of the street as set up (pavements, bike lanes, bus lanes, traffic lanes, the
 * tram's own lane and kerbs), drawn to proportion, so the planner sees the street they describe. Rails in
 * the traffic lanes mark a tram in mixed traffic.
 */
export function CrossSection({ e, oneway }: { e: Effective; oneway: boolean }) {
  const list = strips(e, oneway);
  const rails = e.tram === "mixed" ? innermost(list, oneway) : new Set<number>();
  const label = list
    .filter((s) => s.kind !== "kerb")
    .map((s) => LABEL[s.kind as keyof typeof LABEL])
    .join(", ");
  return (
    <div
      role="img"
      aria-label={`Cross-section: ${label}`}
      className="flex h-14 w-full shrink-0 overflow-hidden rounded-lg border border-slate-200"
    >
      {list.map((s, i) => (
        <div
          key={i}
          className={`relative flex min-w-0 items-center justify-center overflow-hidden text-[10px] font-bold ${STYLE[s.kind]} ${
            s.kind === "car" && list[i + 1]?.kind === "car" ? "border-r-2 border-dashed border-r-white" : ""
          }`}
          style={{ flex: `${WIDTH[s.kind]} 1 0` }}
        >
          {(s.kind === "tram" || rails.has(i)) && <Rails double={s.kind === "tram"} />}
          {s.kind === "bus" && "BUS"}
          {s.kind === "bike" && <span className="[writing-mode:vertical-rl]">BIKE</span>}
          {s.kind === "car" && <span className="relative text-base">{s.dir === "up" ? "↑" : "↓"}</span>}
        </div>
      ))}
    </div>
  );
}

function Rails({ double }: { double: boolean }) {
  // Rails 1.435 m apart: in a 6.2 m tram lane the two tracks' centres sit about a quarter in from each
  // side; in a 3.1 m traffic lane one track runs down the middle.
  const centres = double ? [26, 74] : [50];
  const half = double ? 11.6 : 23;
  return (
    <>
      {centres.flatMap((c) =>
        [-1, 1].map((k) => (
          <span
            key={`${c}${k}`}
            aria-hidden="true"
            className="absolute inset-y-0 w-0.5 bg-stone-600"
            style={{ left: `${c + k * half}%` }}
          />
        )),
      )}
    </>
  );
}
