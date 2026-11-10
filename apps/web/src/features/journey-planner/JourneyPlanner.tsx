import { Marker, type Map as MapLibreMap, type MapMouseEvent } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { tNow, useI18n } from "../../i18n/i18n";
import { loadWasmPlanner } from "./engine";
import { clock, duration, minutes, PARTS, parseClock } from "./format";
import { drawJourney, drawNetwork, ensureLayers, removeLayers } from "./mapLayers";
import {
  DEFAULT_SERVICE_DAY,
  mergeTimetables,
  pluginLineTimetable,
  prefixTimetable,
  type PluginLineInput,
  streetLineTimetable,
  type StreetLineInput,
} from "./network";
import { ProfileChart } from "./ProfileChart";
import type {
  Journey,
  Leg,
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
  /** Rail service lines published in the railway tool, if any. */
  railLines?: Timetable | null;
  /** Cable car and ferry lines from the plugin tools (ADR-0037). */
  pluginLines?: readonly PluginLineInput[];
  /** Planner loader; tests inject a fake. */
  loadPlanner?: PlannerLoader;
}

const PROFILE_START = 4 * 3600;
const PROFILE_END = 25 * 3600;
const NO_PLUGIN_LINES: readonly PluginLineInput[] = [];

/** Purpose: a headway as "45 s" or "15 min". */
const formatHeadway = (s: number) =>
  s < 120 ? tNow("jp.s", { n: Math.round(s) }) : tNow("jp.min", { n: Math.round(s / 60) });

const EMPTY_TT: Timetable = { stops: [], routes: [], trips: [], transfers: [], frequency_patterns: [] };

/** One line of the itinerary: a walk, a ride, or a change (walk and wait between two rides). */
type Step =
  | { kind: "walk"; at: number; text: string }
  | { kind: "ride"; at: number; leg: Extract<Leg, { type: "ride" }> }
  | { kind: "change"; at: number; text: string };

/** Purpose: legs as design A's itinerary; the first wait is left out (it is in the tiles and the tip). */
function steps(j: Journey): Step[] {
  const out: Step[] = [];
  const legs = j.legs;
  for (let i = 0; i < legs.length; i++) {
    const l = legs[i]!;
    if (l.type === "ride") {
      out.push({ kind: "ride", at: l.start_s, leg: l });
    } else if (l.type === "walk" && l.kind !== "transfer") {
      const to = l.kind === "access" ? l.to.name : "B";
      const what =
        l.kind === "direct" ? tNow("jp.walkAll") : tNow("jp.walkTo", { m: Math.round(l.distance_m), to });
      out.push({
        kind: "walk",
        at: l.start_s,
        text: tNow("jp.stepTime", { what, time: duration(l.end_s - l.start_s) }),
      });
    } else if (l.type === "walk" || (l.type === "wait" && l.kind === "transfer")) {
      // A change: an optional transfer walk followed by an optional wait.
      const walk = l.type === "walk" ? l : null;
      const next = legs[i + 1];
      const wait = l.type === "wait" ? l : next?.type === "wait" && next.kind === "transfer" ? next : null;
      if (walk && wait) i++;
      const where = walk
        ? walk.to.platform_code
          ? tNow("jp.platform", { code: walk.to.platform_code })
          : walk.to.name
        : (wait!.at.platform_code ?? wait!.at.name);
      const parts = [
        walk && tNow("jp.walkPart", { time: duration(walk.end_s - walk.start_s) }),
        wait && tNow("jp.waitPart", { time: duration(wait.end_s - wait.start_s) }),
      ].filter(Boolean);
      out.push({
        kind: "change",
        at: l.start_s,
        text: tNow("jp.changeTo", { where, parts: parts.join(tNow("setup.x.sep")) }),
      });
    }
  }
  return out;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Purpose: the A or B marker element (A filled, B outlined, as in design A). */
function pinElement(label: string): HTMLElement {
  const el = document.createElement("div");
  el.textContent = label;
  el.setAttribute("aria-label", tNow("jp.point", { label }));
  Object.assign(el.style, {
    width: "30px",
    height: "30px",
    boxSizing: "border-box",
    borderRadius: "50%",
    background: label === "A" ? "#0f172a" : "#ffffff",
    color: label === "A" ? "#ffffff" : "#0f172a",
    border: "2px solid #0f172a",
    font: "700 14px/26px system-ui, sans-serif",
    textAlign: "center",
    boxShadow: "0 1px 4px rgba(0,0,0,.35)",
    cursor: "grab",
  });
  return el;
}

/** Purpose: "Near <stop>" for a point, from the closest stop within 1 km. */
function nearName(tt: Timetable | null, p: LonLat): string | null {
  if (!tt) return null;
  const k = Math.cos((p[1] * Math.PI) / 180);
  let best: { d: number; name: string } | null = null;
  for (const s of tt.stops) {
    const d = Math.hypot((s.stop_lon - p[0]) * k, s.stop_lat - p[1]) * 111_320;
    if (d <= 1000 && (!best || d < best.d)) best = { d, name: s.stop_name };
  }
  return best ? tNow("jp.near", { name: best.name }) : null;
}

/**
 * Purpose: the journey time benchmark (ADR-0034), laid out as design A. The planner picks A and B on the
 * map and a departure or arrival time; the panel shows the total, its split into walking, waiting, on board
 * and change time, the itinerary, journeys with fewer changes, and the journey time through the day.
 * Side effects: adds layers, two markers and a click handler to the map while mounted.
 */
export function JourneyPlanner({
  map,
  panel = null,
  streetLine = null,
  railLines = null,
  pluginLines = NO_PLUGIN_LINES,
  loadPlanner = loadWasmPlanner,
}: Props) {
  const { t, tn } = useI18n();
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const [useStreet, setUseStreet] = useState(true);
  const [useRailLines, setUseRailLines] = useState(true);
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
  const drawnRail = useMemo(
    () =>
      railLines && useRailLines && (railLines.trips.length || railLines.frequency_patterns?.length)
        ? prefixTimetable(railLines, "lines:")
        : null,
    [railLines, useRailLines],
  );
  const timetable: Timetable | null = useMemo(() => {
    const plugin = pluginLines.filter((l) => !skipped.has(l.id)).map((l) => pluginLineTimetable(l));
    const parts = [street, drawnRail, ...plugin].filter((p): p is Timetable => p !== null);
    return parts.length ? mergeTimetables(parts) : null;
  }, [street, drawnRail, pluginLines, skipped]);

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
        setError(tNow("jp.engineFailed", { error: err instanceof Error ? err.message : String(err) })),
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
    if (map) drawNetwork(map, timetable ?? EMPTY_TT);
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

  const totals = profile.flatMap((p) => (p.journey ? [p.journey.total_s] : []));
  const arriveBy = mode === "arrive_by";
  const parts = journey ? PARTS.filter((p) => p.key !== "early_arrival_s" || arriveBy) : [];

  const networkControls = (
    <div className="space-y-2">
      {streetLine && (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={useStreet} onChange={(e) => setUseStreet(e.target.checked)} />
          {t("jp.streetLine", {
            name: streetLine.name,
            headway: streetLine.headwayMin,
            peak: Math.max(1, Math.round(streetLine.headwayMin / 2)),
          })}
        </label>
      )}
      {railLines && (railLines.trips.length > 0 || railLines.frequency_patterns?.length > 0) && (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={useRailLines} onChange={(e) => setUseRailLines(e.target.checked)} />
          {t("jp.railLines", {
            names: railLines.routes.map((r) => r.route_short_name).join(t("setup.x.sep")),
            trips: railLines.trips.length,
          })}
        </label>
      )}
      {pluginLines.map((l) => (
        <label key={l.id} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={!skipped.has(l.id)}
            onChange={(e) =>
              setSkipped((s) => {
                const n = new Set(s);
                if (e.target.checked) n.delete(l.id);
                else n.add(l.id);
                return n;
              })
            }
          />
          {t(l.mode === "ferry" ? "jp.ferry" : "jp.cableCar", {
            name: l.name,
            headway: formatHeadway(l.headwayS),
          })}
        </label>
      ))}
      {!timetable && <p className="text-xs text-slate-600">{t("jp.noTimetable")}</p>}
      {summary && (
        <p className="text-xs text-slate-600" data-testid="network-summary">
          {t("jp.summary", { stops: summary.stops, routes: summary.routes, trips: summary.trips })}
          {summary.first_departure_s !== null &&
            t("jp.service", {
              from: clock(summary.first_departure_s),
              to: clock(summary.last_arrival_s ?? 0),
            })}
          {summary.joined_by_name ? tn("jp.joined", summary.joined_by_name) : ""}
        </p>
      )}
      {summary?.warnings.slice(0, 3).map((w) => (
        <p key={w} className="text-xs text-amber-700">
          {w}
        </p>
      ))}
    </div>
  );

  const body = (
    <div className="flex min-h-full flex-col text-sm text-slate-900">
      {/* Question: A, B, time. */}
      <div className="flex flex-col gap-3 border-b border-slate-200 px-5 pb-4 pt-5">
        <h2 className="text-lg font-semibold">{t("jp.title")}</h2>
        <div className="flex flex-col overflow-hidden rounded-lg border border-slate-300">
          {(["a", "b"] as const).map((k) => {
            const pos = k === "a" ? a : b;
            const label =
              picking === k
                ? t("jp.clickMap")
                : pos
                  ? (nearName(timetable, pos) ?? `${pos[1].toFixed(4)}, ${pos[0].toFixed(4)}`)
                  : t("jp.pickMap");
            return (
              <button
                key={k}
                type="button"
                aria-pressed={picking === k}
                aria-label={t("jp.pointButton", { point: k.toUpperCase(), label })}
                onClick={() => setPicking(picking === k ? null : k)}
                className={`flex h-11 items-center gap-2.5 px-3 text-start ${k === "a" ? "border-b border-slate-200" : ""} ${picking === k ? "bg-blue-50" : "bg-white hover:bg-slate-50"}`}
              >
                <span
                  className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-xs font-bold ${k === "a" ? "bg-slate-900 text-white" : "border-2 border-slate-900"}`}
                >
                  {k.toUpperCase()}
                </span>
                <span className={pos || picking === k ? "" : "text-slate-500"}>{label}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label={t("jp.time")} className="flex rounded-lg bg-slate-100 p-[3px]">
            {(
              [
                ["depart_at", t("jp.departAt")],
                ["arrive_by", t("jp.arriveBy")],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={`h-8 rounded-md px-3 text-[13px] ${mode === m ? "bg-white font-semibold shadow-sm" : "text-slate-600"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="flex h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 px-2.5">
            <span className="text-slate-600">{t("jp.time")}</span>
            <input
              type="time"
              aria-label={t("jp.timeOfDay")}
              value={timeText}
              onChange={(e) => setTimeText(e.target.value)}
              className="w-28 border-0 font-semibold outline-none"
            />
          </label>
          <span className="text-xs text-slate-600">{t("jp.weekday")}</span>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3.5 px-5 py-4">
        {(error ?? planned.error) && (
          <p role="alert" className="text-xs text-red-700">
            {error ?? planned.error}
          </p>
        )}

        {!timetable && networkControls}

        {timetable && (!a || !b) && <p className="text-slate-600">{t("jp.pickAB")}</p>}

        {plan && !journey && (
          <p role="status" className="text-slate-600">
            {t(arriveBy ? "jp.noJourneyBefore" : "jp.noJourneyAfter", { m: settings.max_access_m ?? 1000 })}
          </p>
        )}

        {journey && (
          <section aria-label={t("jp.result")} className="flex flex-col gap-3.5">
            <div className="flex items-baseline gap-2.5">
              <span className="text-4xl font-bold tracking-tight tabular-nums" data-testid="total">
                {duration(journey.total_s)}
              </span>
              <span className="text-[13px] text-slate-600">
                {clock(journey.depart_s)} → {clock(journey.arrive_s)} · {tn("jp.changes", journey.transfers)}
              </span>
            </div>
            <div
              className="flex h-3.5 gap-0.5 overflow-hidden rounded"
              role="img"
              aria-label={t("jp.timeSplit")}
            >
              {parts
                .filter((p) => journey.breakdown[p.key] > 0)
                .map((p) => (
                  <div
                    key={p.key}
                    title={t("jp.partTitle", { label: t(p.label), time: duration(journey.breakdown[p.key]) })}
                    style={{
                      width: `${(journey.breakdown[p.key] / journey.total_s) * 100}%`,
                      background: p.color,
                    }}
                  />
                ))}
            </div>
            <dl
              className="grid gap-1.5 text-[11px] text-slate-600"
              style={{ gridTemplateColumns: `repeat(${parts.length}, minmax(0, 1fr))` }}
            >
              {parts.map((p) => (
                <div key={p.key} className="flex flex-col-reverse gap-0.5">
                  <dt>{t(p.short)}</dt>
                  <dd className="flex items-center gap-1 text-[15px] font-semibold tabular-nums text-slate-900">
                    <span
                      className="inline-block h-2 w-2 rounded-sm"
                      style={{ background: p.color }}
                      aria-hidden="true"
                    />
                    {minutes(journey.breakdown[p.key])}
                  </dd>
                </div>
              ))}
            </dl>
            {journey.rides > 0 && journey.leave_s > journey.depart_s && (
              <p className="rounded-lg bg-blue-50 px-3 py-2.5 text-[13px] text-blue-900">
                {t("jp.leaveAt", { time: clock(journey.leave_s), total: duration(journey.door_to_door_s) })}
              </p>
            )}
            {plan!.journeys.length > 1 && (
              <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t("jp.alternatives")}>
                {plan!.journeys.map((j, i) => (
                  <button
                    key={i}
                    type="button"
                    role="tab"
                    aria-selected={i === chosen}
                    onClick={() => setChosen(i)}
                    className={`h-7 rounded-md border px-2 text-xs ${i === chosen ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 hover:bg-slate-50"}`}
                  >
                    {duration(j.total_s)} · {j.rides === 0 ? t("jp.walk") : tn("jp.changes", j.transfers)}
                  </button>
                ))}
              </div>
            )}
            <ol aria-label={t("jp.itinerary")} className="flex flex-col text-[13px]">
              {steps(journey).map((s, i) => (
                <li key={i} className="flex gap-3 py-1.5">
                  <span className="w-11 shrink-0 tabular-nums text-slate-600">{clock(s.at)}</span>
                  {s.kind === "ride" ? (
                    <span>
                      <span
                        className="me-1 rounded px-1.5 py-px text-xs font-bold text-white"
                        style={{ background: `#${s.leg.route_color ?? "1f2937"}` }}
                      >
                        {s.leg.route_short_name}
                      </span>
                      {s.leg.from.name} → <b className="font-semibold">{s.leg.to.name}</b> ·{" "}
                      {duration(s.leg.end_s - s.leg.start_s)}
                      {s.leg.intermediate_stops > 0 &&
                        t("setup.x.sep") + tn("jp.stops", s.leg.intermediate_stops)}
                      {s.leg.guaranteed && <span className="ms-1 text-emerald-700">{t("jp.timed")}</span>}
                    </span>
                  ) : (
                    <span>{s.text}</span>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}

        {profile.length > 0 && (
          <section
            aria-label={t("jp.throughDay")}
            className="flex flex-col gap-2 border-t border-slate-200 pt-3"
          >
            <div className="flex items-baseline gap-2">
              <h3 className="text-[13px] font-semibold">{t("jp.throughDay")}</h3>
              {totals.length > 0 && (
                <span className="text-xs text-slate-600">
                  {t("jp.stats", {
                    fast: minutes(Math.min(...totals)),
                    median: minutes(median(totals)),
                    slow: minutes(Math.max(...totals)),
                  })}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-600">{t("jp.chartNote")}</p>
            <ProfileChart
              points={profile}
              selected={time}
              peaks={DEFAULT_SERVICE_DAY.peaks}
              onSelect={(t) => setTimeText(clock(t))}
            />
            <div className="flex items-center gap-3 text-xs text-slate-600">
              <button type="button" className="underline" onClick={() => setShowTable(!showTable)}>
                {t(showTable ? "jp.hideTable" : "jp.showTable")}
              </button>
              <label className="ms-auto">
                {t("jp.every")}{" "}
                <select
                  aria-label={t("jp.profileStep")}
                  value={stepMin}
                  onChange={(e) => setStepMin(Number(e.target.value))}
                  className="rounded border border-slate-300"
                >
                  {[5, 10, 15, 30, 60].map((s) => (
                    <option key={s} value={s}>
                      {t("jp.min", { n: s })}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {showTable && (
              <table className="w-full text-xs tabular-nums">
                <thead>
                  <tr className="text-start text-slate-600">
                    <th>{t("jp.time")}</th>
                    <th>{t("jp.th.total")}</th>
                    <th>{t("jp.part.walkShort")}</th>
                    <th>{t("jp.part.waitShort")}</th>
                    <th>{t("jp.part.onBoard")}</th>
                    <th>{t("jp.th.change")}</th>
                    <th>{t("jp.th.changes")}</th>
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
                          <td>
                            {duration(p.journey.breakdown.wait_s + p.journey.breakdown.early_arrival_s)}
                          </td>
                          <td>{duration(p.journey.breakdown.in_vehicle_s)}</td>
                          <td>
                            {duration(
                              p.journey.breakdown.transfer_walk_s + p.journey.breakdown.transfer_wait_s,
                            )}
                          </td>
                          <td>{p.journey.transfers}</td>
                        </>
                      ) : (
                        <td colSpan={6}>{t("jp.noJourney")}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        <div className="mt-auto flex flex-col gap-2 border-t border-slate-200 pt-3 text-xs">
          {timetable && (
            <details>
              <summary className="cursor-pointer text-slate-600">{t("jp.network")}</summary>
              <div className="mt-2">{networkControls}</div>
            </details>
          )}
          <details>
            <summary className="cursor-pointer text-slate-600">{t("jp.walking")}</summary>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(
                [
                  ["walk_speed_kmh", "jp.set.walkSpeed", 4.5, 0.1],
                  ["max_access_m", "jp.set.maxAccess", 1000, 50],
                  ["max_transfer_m", "jp.set.maxTransfer", 400, 50],
                  ["same_name_station_m", "jp.set.sameName", 600, 50],
                  ["min_change_s", "jp.set.minChange", 60, 10],
                  ["max_rides", "jp.set.maxRides", 5, 1],
                ] as const
              ).map(([key, label, def, stepv]) => (
                <label key={key} className="flex flex-col gap-0.5">
                  <span className="text-slate-600">{t(label)}</span>
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
            <p className="mt-2 text-slate-600">{t("jp.walkNote")}</p>
          </details>
        </div>
      </div>
    </div>
  );

  return panel ? createPortal(body, panel) : body;
}
