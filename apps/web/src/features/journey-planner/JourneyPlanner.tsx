import { Marker, type Map as MapLibreMap, type MapMouseEvent } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadWasmPlanner } from "./engine";
import { clock, duration, PARTS, parseClock } from "./format";
import { drawJourney, drawNetwork, ensureLayers, removeLayers } from "./mapLayers";
import {
  exampleNetwork,
  mergeTimetables,
  offset,
  streetLineTimetable,
  type StreetLineInput,
} from "./network";
import { PartsLegend, ProfileChart } from "./ProfileChart";
import type {
  Journey,
  LonLat,
  NetworkSummary,
  Plan,
  PlannerEngine,
  PlannerLoader,
  ProfilePoint,
  Settings,
  TimeMode,
  Timetable,
} from "./types";

interface Props {
  map: MapLibreMap | null;
  /** Where the side panel renders; inline when `null`. */
  panel?: HTMLElement | null;
  /** The line drawn in the street line tool, if any. */
  streetLine?: StreetLineInput | null;
  /** Planner loader; tests inject a fake. */
  loadPlanner?: PlannerLoader;
}

const PROFILE_START = 4 * 3600;
const PROFILE_END = 25 * 3600;

/** Purpose: a journey's time as one stacked bar, parts labelled in the list below it. */
function BreakdownBar({ j }: { j: Journey }) {
  const parts = PARTS.filter((p) => j.breakdown[p.key] > 0);
  return (
    <div>
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded" role="img" aria-label="Time split">
        {parts.map((p) => (
          <div
            key={p.key}
            title={`${p.label}: ${duration(j.breakdown[p.key])}`}
            style={{ width: `${(j.breakdown[p.key] / j.total_s) * 100}%`, background: p.color }}
          />
        ))}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
        {parts.map((p) => (
          <div key={p.key} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />
            <dt className="text-slate-600">{p.label}</dt>
            <dd className="ml-auto tabular-nums">{duration(j.breakdown[p.key])}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Purpose: the legs of a journey as an itinerary. */
function Itinerary({ j }: { j: Journey }) {
  return (
    <ol className="mt-3 space-y-1.5 text-xs" aria-label="Itinerary">
      {j.legs.map((l, i) => {
        const time = `${clock(l.start_s)}–${clock(l.end_s)}`;
        if (l.type === "walk") {
          const what = {
            access: `Walk to ${l.to.name}`,
            transfer: `Walk to ${l.to.name}${l.to.platform_code ? ` (platform ${l.to.platform_code})` : ""}`,
            egress: "Walk to B",
            direct: "Walk all the way to B",
          }[l.kind];
          return (
            <li key={i} className="flex gap-2">
              <span className="w-20 shrink-0 tabular-nums text-slate-500">{time}</span>
              <span>
                {what} · {Math.round(l.distance_m)} m, {duration(l.end_s - l.start_s)}
              </span>
            </li>
          );
        }
        if (l.type === "wait") {
          return (
            <li key={i} className="flex gap-2 text-slate-600">
              <span className="w-20 shrink-0 tabular-nums text-slate-500">{time}</span>
              <span>
                {l.kind === "initial" ? "Wait" : "Wait to change"} at {l.at.name} ·{" "}
                {duration(l.end_s - l.start_s)}
              </span>
            </li>
          );
        }
        return (
          <li key={i} className="flex gap-2">
            <span className="w-20 shrink-0 tabular-nums text-slate-500">{time}</span>
            <span>
              <span
                className="mr-1 inline-block rounded px-1 font-semibold text-white"
                style={{ background: `#${l.route_color ?? "1f2937"}` }}
              >
                {l.route_short_name}
              </span>
              {l.from.name} → {l.to.name} · {duration(l.end_s - l.start_s)}
              {l.intermediate_stops > 0 &&
                `, ${l.intermediate_stops} stop${l.intermediate_stops === 1 ? "" : "s"} between`}
              {l.guaranteed && <span className="ml-1 text-emerald-700">(timed connection)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Purpose: the A or B marker element. */
function pinElement(label: string): HTMLElement {
  const el = document.createElement("div");
  el.textContent = label;
  el.setAttribute("aria-label", `Point ${label}`);
  Object.assign(el.style, {
    width: "26px",
    height: "26px",
    borderRadius: "50%",
    background: label === "A" ? "#0f172a" : "#ffffff",
    color: label === "A" ? "#ffffff" : "#0f172a",
    border: "2px solid #0f172a",
    font: "700 13px/22px system-ui, sans-serif",
    textAlign: "center",
    boxShadow: "0 1px 3px rgba(0,0,0,.4)",
    cursor: "grab",
  });
  return el;
}

/**
 * Purpose: the journey time benchmark (ADR-0034). The planner picks A and B on the map and a departure
 * or arrival time; the panel shows the fastest journey split into walking, waiting, in-vehicle and change
 * time, journeys with fewer changes, and how the journey time changes through the day.
 * Side effects: adds layers, two markers and a click handler to the map while mounted.
 */
export function JourneyPlanner({
  map,
  panel = null,
  streetLine = null,
  loadPlanner = loadWasmPlanner,
}: Props) {
  const [exampleAt, setExampleAt] = useState<LonLat | null>(null);
  const [useStreet, setUseStreet] = useState(true);
  const [settings, setSettings] = useState<Partial<Settings>>({});
  const [engine, setEngine] = useState<PlannerEngine | null>(null);
  const [summary, setSummary] = useState<NetworkSummary | null>(null);
  const [a, setA] = useState<LonLat | null>(null);
  const [b, setB] = useState<LonLat | null>(null);
  const [picking, setPicking] = useState<"a" | "b" | null>(null);
  const [mode, setMode] = useState<TimeMode>("depart_at");
  const [timeText, setTimeText] = useState("08:00");
  const [stepMin, setStepMin] = useState(10);
  const [chosen, setChosen] = useState(0);
  const [showTable, setShowTable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const street = useMemo(
    () => (streetLine && useStreet ? streetLineTimetable(streetLine) : null),
    [streetLine, useStreet],
  );
  const timetable: Timetable | null = useMemo(() => {
    const parts = [exampleAt ? exampleNetwork(exampleAt) : null, street].filter(
      (p): p is Timetable => p !== null,
    );
    return parts.length ? mergeTimetables(parts) : null;
  }, [exampleAt, street]);

  // Compile the timetable whenever it or the settings change.
  useEffect(() => {
    if (!timetable) {
      setEngine(null);
      setSummary(null);
      return;
    }
    let alive = true;
    let made: PlannerEngine | null = null;
    loadPlanner(timetable, settings)
      .then((e) => {
        made = e;
        if (!alive) return e.dispose();
        setEngine(e);
        setSummary(e.summary());
        setError(null);
      })
      .catch((err) =>
        setError(`The journey planner did not start: ${err instanceof Error ? err.message : String(err)}`),
      );
    return () => {
      alive = false;
      made?.dispose();
    };
  }, [timetable, settings, loadPlanner]);

  const time = parseClock(timeText);
  const planned = useMemo((): { plan: Plan | null; error: string | null } => {
    if (!engine || !a || !b || time === null) return { plan: null, error: null };
    try {
      return { plan: engine.plan({ from: a, to: b, time_s: time, mode }), error: null };
    } catch (err) {
      return { plan: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [engine, a, b, time, mode]);
  const plan = planned.plan;
  useEffect(() => setChosen(0), [plan]);
  const profile: ProfilePoint[] = useMemo(() => {
    if (!engine || !a || !b) return [];
    try {
      return engine.profile({
        from: a,
        to: b,
        mode,
        start_s: PROFILE_START,
        end_s: PROFILE_END,
        step_s: stepMin * 60,
      });
    } catch {
      return [];
    }
  }, [engine, a, b, mode, stepMin]);
  const journey = plan?.journeys[chosen] ?? null;

  // Map layers, network and journey drawing.
  useEffect(() => {
    if (!map) return;
    ensureLayers(map);
    return () => removeLayers(map);
  }, [map]);
  useEffect(() => {
    if (map)
      drawNetwork(
        map,
        timetable ?? { stops: [], routes: [], trips: [], transfers: [], frequency_patterns: [] },
      );
  }, [map, timetable]);
  useEffect(() => {
    if (map) drawJourney(map, journey);
  }, [map, journey]);

  // Picking A and B by clicking the map.
  const pickRef = useRef(picking);
  pickRef.current = picking;
  useEffect(() => {
    if (!map) return;
    const onClick = (e: MapMouseEvent) => {
      const which = pickRef.current;
      if (!which) return;
      const p: LonLat = [e.lngLat.lng, e.lngLat.lat];
      if (which === "a") {
        setA(p);
        setPicking((cur) => (cur === "a" && !b ? "b" : null));
      } else {
        setB(p);
        setPicking(null);
      }
    };
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
  }, [map, b]);
  useEffect(() => {
    if (!map) return;
    const canvas = map.getCanvas?.();
    if (canvas) canvas.style.cursor = picking ? "crosshair" : "";
  }, [map, picking]);

  // Draggable A and B markers.
  const markers = useRef<{ a?: Marker; b?: Marker }>({});
  useEffect(() => {
    if (!map) return;
    for (const [key, pos, set] of [
      ["a", a, setA],
      ["b", b, setB],
    ] as const) {
      const m = markers.current[key];
      if (!pos) {
        m?.remove();
        delete markers.current[key];
        continue;
      }
      if (m) {
        m.setLngLat(pos);
        continue;
      }
      const nm = new Marker({ element: pinElement(key.toUpperCase()), draggable: true })
        .setLngLat(pos)
        .addTo(map);
      nm.on("dragend", () => {
        const ll = nm.getLngLat();
        set([ll.lng, ll.lat]);
      });
      markers.current[key] = nm;
    }
  }, [map, a, b]);
  useEffect(
    () => () => {
      markers.current.a?.remove();
      markers.current.b?.remove();
      markers.current = {};
    },
    [],
  );

  const placeExample = () => {
    const c = map?.getCenter?.();
    const center: LonLat = c ? [c.lng, c.lat] : [10, 50];
    setExampleAt(center);
    setA(offset(center, -2600, -300));
    setB(offset(center, 300, 1650));
    map?.flyTo?.({ center, zoom: 12 });
  };

  const totals = profile.flatMap((p) => (p.journey ? [p.journey.total_s] : []));
  const served = profile.filter((p) => p.journey && p.journey.rides > 0).length;

  const body = (
    <div className="space-y-4 p-3 text-sm">
      <header>
        <h2 className="text-base font-semibold">Journey planner</h2>
        <p className="text-xs text-slate-600">
          How long does it take from A to B with your network? Walking, waiting, riding and changing, through
          the day.
        </p>
      </header>

      <section aria-label="Network" className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Network</h3>
        {streetLine && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={useStreet} onChange={(e) => setUseStreet(e.target.checked)} />
            Street line “{streetLine.name}” (every {streetLine.headwayMin} min, peak every{" "}
            {Math.max(1, Math.round(streetLine.headwayMin / 2))} min)
          </label>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={placeExample}
            className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-100"
          >
            {exampleAt ? "Move example network here" : "Place example network here"}
          </button>
          {exampleAt && (
            <button
              type="button"
              onClick={() => setExampleAt(null)}
              className="text-xs text-slate-600 underline"
            >
              Remove example
            </button>
          )}
        </div>
        {!timetable && (
          <p className="text-xs text-slate-600">
            No timetable yet. Draw a street line, or place the example city (metro, tram, bus and a regional
            train with a timed connection) at the centre of the map. Rail lines join here once the railway
            operations planner publishes timetables.
          </p>
        )}
        {summary && (
          <p className="text-xs text-slate-600" data-testid="network-summary">
            {summary.stops} stops · {summary.routes} lines · {summary.trips} trips
            {summary.first_departure_s !== null &&
              ` · service ${clock(summary.first_departure_s)}–${clock(summary.last_arrival_s ?? 0)}`}
          </p>
        )}
        {summary?.warnings.slice(0, 3).map((w) => (
          <p key={w} className="text-xs text-amber-700">
            {w}
          </p>
        ))}
      </section>

      <section aria-label="Journey" className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">From A to B</h3>
        <div className="flex gap-2">
          {(["a", "b"] as const).map((k) => {
            const pos = k === "a" ? a : b;
            return (
              <button
                key={k}
                type="button"
                aria-pressed={picking === k}
                onClick={() => setPicking(picking === k ? null : k)}
                className={`flex-1 rounded border px-2 py-1 text-left ${picking === k ? "border-blue-700 bg-blue-50" : "border-slate-300 hover:bg-slate-100"}`}
              >
                <span className="font-semibold">{k.toUpperCase()}</span>{" "}
                <span className="text-xs text-slate-600">
                  {picking === k
                    ? "click the map…"
                    : pos
                      ? `${pos[1].toFixed(4)}, ${pos[0].toFixed(4)}`
                      : "pick on map"}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <div
            role="radiogroup"
            aria-label="Time"
            className="flex overflow-hidden rounded border border-slate-300"
          >
            {(
              [
                ["depart_at", "Depart at"],
                ["arrive_by", "Arrive by"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={`px-2 py-0.5 ${mode === m ? "bg-slate-800 text-white" : "hover:bg-slate-100"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            type="time"
            aria-label="Time of day"
            value={timeText}
            onChange={(e) => setTimeText(e.target.value)}
            className="rounded border border-slate-300 px-1 py-0.5"
          />
        </div>
      </section>

      {(error ?? planned.error) && (
        <p role="alert" className="text-xs text-red-700">
          {error ?? planned.error}
        </p>
      )}

      {plan && !journey && (
        <p role="status" className="text-xs text-slate-600">
          No journey found. B may be too far from any stop (more than {settings.max_access_m ?? 1000} m), or
          there is no service {mode === "arrive_by" ? "before" : "after"} this time.
        </p>
      )}

      {journey && (
        <section aria-label="Result" className="space-y-2">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums" data-testid="total">
              {duration(journey.total_s)}
            </span>
            <span className="text-xs text-slate-600">
              {mode === "depart_at" ? `from ${clock(journey.query_s)}` : `before ${clock(journey.query_s)}`} ·
              arrive {clock(journey.arrive_s)} · {journey.transfers} change
              {journey.transfers === 1 ? "" : "s"}
            </span>
          </div>
          {journey.rides > 0 && journey.leave_s > journey.depart_s && (
            <p className="text-xs text-slate-600">
              Leave at {clock(journey.leave_s)} to skip the wait: {duration(journey.door_to_door_s)} door to
              door.
            </p>
          )}
          <BreakdownBar j={journey} />
          {plan!.journeys.length > 1 && (
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Alternatives">
              {plan!.journeys.map((j, i) => (
                <button
                  key={i}
                  type="button"
                  role="tab"
                  aria-selected={i === chosen}
                  onClick={() => setChosen(i)}
                  className={`rounded border px-1.5 py-0.5 text-xs ${i === chosen ? "border-slate-800 bg-slate-800 text-white" : "border-slate-300 hover:bg-slate-100"}`}
                >
                  {duration(j.total_s)} ·{" "}
                  {j.rides === 0 ? "walk" : `${j.transfers} change${j.transfers === 1 ? "" : "s"}`}
                </button>
              ))}
            </div>
          )}
          <Itinerary j={journey} />
        </section>
      )}

      {profile.length > 0 && (
        <section aria-label="Through the day" className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Through the day</h3>
            <label className="ml-auto text-xs text-slate-600">
              every{" "}
              <select
                aria-label="Profile step"
                value={stepMin}
                onChange={(e) => setStepMin(Number(e.target.value))}
                className="rounded border border-slate-300"
              >
                {[5, 10, 15, 30, 60].map((s) => (
                  <option key={s} value={s}>
                    {s} min
                  </option>
                ))}
              </select>
            </label>
          </div>
          {totals.length > 0 && (
            <p className="text-xs text-slate-600">
              Fastest {duration(Math.min(...totals))} · median {duration(median(totals))} · slowest{" "}
              {duration(Math.max(...totals))} · transit used at {served} of {profile.length} times
            </p>
          )}
          <ProfileChart points={profile} selected={time} onSelect={(t) => setTimeText(clock(t))} />
          <PartsLegend arriveBy={mode === "arrive_by"} />
          <button
            type="button"
            className="text-xs text-slate-600 underline"
            onClick={() => setShowTable(!showTable)}
          >
            {showTable ? "Hide table" : "Show as table"}
          </button>
          {showTable && (
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="text-left text-slate-500">
                  <th>Time</th>
                  <th>Total</th>
                  <th>Walk</th>
                  <th>Wait</th>
                  <th>Ride</th>
                  <th>Change</th>
                  <th>Changes</th>
                </tr>
              </thead>
              <tbody>
                {profile.map((p) => (
                  <tr key={p.time_s}>
                    <td>{clock(p.time_s)}</td>
                    {p.journey ? (
                      <>
                        <td>{duration(p.journey.total_s)}</td>
                        <td>{duration(p.journey.breakdown.walk_s)}</td>
                        <td>{duration(p.journey.breakdown.wait_s + p.journey.breakdown.early_arrival_s)}</td>
                        <td>{duration(p.journey.breakdown.in_vehicle_s)}</td>
                        <td>
                          {duration(
                            p.journey.breakdown.transfer_walk_s + p.journey.breakdown.transfer_wait_s,
                          )}
                        </td>
                        <td>{p.journey.transfers}</td>
                      </>
                    ) : (
                      <td colSpan={6}>no journey</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      <details className="text-xs">
        <summary className="cursor-pointer text-slate-600">Walking and changing</summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(
            [
              ["walk_speed_kmh", "Walking speed (km/h)", 4.5, 0.1],
              ["max_access_m", "Longest walk to a stop (m)", 1000, 50],
              ["max_transfer_m", "Longest walk at a change (m)", 400, 50],
              ["min_change_s", "Change at one stop (s)", 60, 10],
              ["max_rides", "Most vehicles", 5, 1],
            ] as const
          ).map(([key, label, def, stepv]) => (
            <label key={key} className="flex flex-col gap-0.5">
              <span className="text-slate-600">{label}</span>
              <input
                type="number"
                step={stepv}
                min={0}
                value={settings[key] ?? def}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v > 0) setSettings((s) => ({ ...s, [key]: v }));
                }}
                className="rounded border border-slate-300 px-1 py-0.5"
              />
            </label>
          ))}
        </div>
        <p className="mt-2 text-slate-500">
          Walks are straight-line distance × 1.3 until the walking network exists. Defaults come from the
          assumption library.
        </p>
      </details>
    </div>
  );

  return panel ? createPortal(body, panel) : body;
}
