import { useI18n } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/en";
import type { LaneKind, LaneProfile } from "./lanes";
import type { Effective } from "./model";

type Strip = {
  kind: "walk" | "bike" | "bus" | "car" | "tram" | "kerb" | "parking" | "buffer" | "island" | "green";
  dir?: "up" | "down";
  /** Width in metres, where the street's lanes give one; else the typical width. */
  width?: number;
  /** Tram rails along it (from the street's lanes). */
  rails?: boolean;
};

/** Typical widths in metres, so the drawing keeps the street's proportions where the lanes are not known. */
const WIDTH: Record<Strip["kind"], number> = {
  walk: 2.5,
  bike: 1.8,
  bus: 3.3,
  car: 3.1,
  tram: 6.2,
  kerb: 0.5,
  parking: 2.3,
  buffer: 0.5,
  island: 2,
  green: 2.5,
};
const STYLE: Record<Strip["kind"], string> = {
  walk: "bg-slate-200",
  bike: "bg-green-200 text-green-900",
  bus: "bg-red-200 text-red-900",
  car: "bg-slate-300 text-slate-700",
  tram: "bg-stone-200",
  kerb: "bg-slate-600",
  parking: "bg-blue-100",
  buffer: "bg-slate-100",
  island: "bg-stone-300",
  green: "bg-[#86a865]",
};
const LABEL: Record<Exclude<Strip["kind"], "kerb" | "buffer" | "island">, MessageKey> = {
  walk: "setup.x.walk",
  bike: "setup.x.bike",
  bus: "setup.x.bus",
  car: "setup.x.car",
  tram: "setup.x.tram",
  parking: "setup.x.parking",
  green: "setup.x.green",
};

/** The cross-section kind of each lane kind of the lane engine. */
const FROM_LANE: Record<LaneKind, Strip["kind"]> = {
  traffic: "car",
  bus: "bus",
  bike: "bike",
  tram: "tram",
  tram_space: "tram",
  pavement: "walk",
  footway: "walk",
  shared_use: "walk",
  parking: "parking",
  kerb: "kerb",
  buffer: "buffer",
  construction: "buffer",
  island: "island",
  green: "green",
};

/**
 * Purpose: the strips across the street from its lanes (osm2lanes with the setup applied, ADR-0047), with
 * their widths. Lanes running along the way point up, lanes against it down.
 */
export function stripsFromLanes(lanes: readonly LaneProfile[]): Strip[] {
  return lanes.map((l) => ({
    kind: FROM_LANE[l.kind],
    dir: l.dir === "forward" ? "up" : "down",
    width: l.width,
    rails: l.rails,
  }));
}

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
 * Purpose: a cross-section of the street as set up (pavements, parking, bike lanes, bus lanes, traffic lanes,
 * tram lanes and kerbs), drawn to proportion, so the planner sees the street they describe. Rails mark the
 * tram's tracks. With the street's lanes (`lanes`) it shows those at their widths; without them (lanes not
 * built yet, or zoomed out) a typical street from the setup.
 */
export function CrossSection({
  e,
  oneway,
  lanes,
}: {
  e: Effective;
  oneway: boolean;
  lanes?: readonly LaneProfile[] | undefined;
}) {
  const { t } = useI18n();
  const real = lanes && lanes.length > 0;
  const list = real ? stripsFromLanes(lanes) : strips(e, oneway);
  const rails = real
    ? new Set(list.flatMap((s, i) => (s.rails && s.kind !== "tram" ? [i] : [])))
    : e.tram === "mixed"
      ? innermost(list, oneway)
      : new Set<number>();
  const label = list
    .filter((s) => s.kind !== "kerb" && s.kind !== "buffer" && s.kind !== "island")
    .map((s) => t(LABEL[s.kind as keyof typeof LABEL]))
    .join(t("setup.x.sep"));
  return (
    <div
      role="img"
      aria-label={t("setup.x.label", { list: label })}
      // A drawing of the street, kerb to kerb: it keeps its sides in right-to-left languages.
      dir="ltr"
      className="flex h-14 w-full shrink-0 overflow-hidden rounded-lg border border-slate-200"
    >
      {list.map((s, i) => (
        <div
          key={i}
          className={`relative flex min-w-0 items-center justify-center overflow-hidden text-[10px] font-bold ${STYLE[s.kind]} ${
            s.kind === "car" && list[i + 1]?.kind === "car" ? "border-e-2 border-dashed border-e-white" : ""
          }`}
          style={{ flex: `${s.width ?? WIDTH[s.kind]} 1 0` }}
        >
          {/* A tram lane of the street's lanes carries one track; the typical one is double track. */}
          {(s.kind === "tram" || rails.has(i)) && <Rails double={s.kind === "tram" && !real} />}
          {s.kind === "bus" && t("setup.x.busMark")}
          {s.kind === "bike" && <span className="[writing-mode:vertical-rl]">{t("setup.x.bikeMark")}</span>}
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
