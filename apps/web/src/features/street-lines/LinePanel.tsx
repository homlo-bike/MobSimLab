import { useState } from "react";
import { cleanFeatures, STATION_FEATURES, SymbolPicker } from "../stations/features";
import { DayTypeChoice } from "../timetables/DayTypeChoice";
import {
  type DayService,
  editDay,
  hasOwnDay,
  shownDay,
  streetWeekday,
  withDay,
} from "../timetables/dayTypes";
import type { DayTypeId } from "../../workspace/calendar";
import { type Translate, useI18n } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/messages";
import { TimeInput } from "../railways/ServiceLinesPanel";
import { formatLength } from "./geojson";
import { offeredModes, usePlannedModes } from "../../projects/plannedModes";
import { MODE_ORDER, MODES, type Timing } from "./modes";
import { vehicleById, vehiclesFor } from "./service";
import { usedVehicles } from "../../workspace/preferences";
import { useVehiclesOff } from "../../workspace/projectVehicles";
import { usePublishChecks } from "../../shell/checks";
import { lineChecks, lineStats, nearestTerminal, type Check, type Severity } from "./summary";
import type { LineView, Mode, PointKind, VehicleProfile } from "./types";
import type { FitProblem } from "../depots/model";

const KINDS: { id: PointKind; label: MessageKey; title: MessageKey }[] = [
  { id: "via", label: "street.kind.via", title: "street.kind.viaTitle" },
  { id: "stop", label: "street.kind.stop", title: "street.kind.stopTitle" },
  { id: "end_stop", label: "street.kind.end_stop", title: "street.kind.endTitle" },
];

const CHIP: Record<Severity, string> = {
  ok: "bg-emerald-700 text-white",
  info: "bg-slate-200 text-slate-700",
  warn: "bg-amber-500 text-white",
  error: "bg-red-600 text-white",
};

/** Edits the panel can ask for; the editor applies them to the engine. */
export interface PanelActions {
  setName: (name: string) => void;
  setColor: (color: string) => void;
  setMode: (mode: Mode) => void;
  setProfile: (p: VehicleProfile) => void;
  /** A catalogue vehicle by id, or null for the mode's typical vehicle. */
  setVehicle: (id: string | null) => void;
  setTiming: (t: Timing) => void;
  select: (id: number | null) => void;
  setKind: (id: number, kind: PointKind) => void;
  /** Put a stop on the other sidewalk; and what that would change in the circuit's length (m, null unknown). */
  switchSide: (id: number) => void;
  sideCost: (id: number) => number | null;
  setPointName: (id: number, name: string) => void;
  /** Facilities of a stop (step-free access, elevators and so on). */
  setPointFeatures: (id: number, features: string[]) => void;
  deletePoint: (id: number) => void;
  optimise: () => void;
  clear: () => void;
  placeDepot: () => void;
  removeDepot: () => void;
  /** Use a shared road depot (its gates), or none. */
  chooseDepot: (id: string | null) => void;
  setDepotStops: (s: { out?: number; in?: number }) => void;
  setShowDepot: (v: boolean) => void;
  setShowRoads: (v: boolean) => void;
}

const RAIL_MODE: Record<string, MessageKey> = {
  tram: "mode.tram",
  light_rail: "mode.light_rail",
  metro: "mode.metro",
  commuter_rail: "mode.commuter_rail",
  regional_rail: "mode.regional_rail",
  long_distance_rail: "rail.mode.long_distance_rail",
  high_speed_rail: "mode.high_speed_rail",
};

const SOURCE: Record<"timetable" | "assumed" | "mixed", MessageKey> = {
  timetable: "street.source.timetable",
  assumed: "street.source.assumed",
  mixed: "street.source.mixed",
};

/** Purpose: the label of a severity chip in the current language. */
const sevLabel = (t: Translate, s: Severity) => t(s === "warn" ? "severity.warning" : `severity.${s}`);

/** Purpose: seconds with one decimal under a minute, else whole minutes and seconds. */
function seconds(s: number): string {
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${Math.round(s - m * 60)} s`;
}

/** Purpose: clock time of seconds after midnight, "08:00". */
function clock(s: number): string {
  const h = Math.floor(s / 3600) % 24;
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

interface Props {
  lineName: string;
  /** The line's colour (#rrggbb). */
  lineColor: string;
  view: LineView;
  profile: VehicleProfile;
  timing: Timing;
  /** The chosen catalogue vehicle's id, or null for the mode's typical vehicle. */
  vehicle: string | null;
  /** The project's lines (switch, add, delete), shown at the top. */
  lineList?: React.ReactNode;
  selected: number | null;
  depotStops: { out?: number; in?: number };
  showDepot: boolean;
  /** The shared road depot the line uses, or null. */
  depotId?: string | null;
  /** The project's road depots, with why the line cannot use one (null: it can). */
  depots?: { id: string; name: string; problem: FitProblem }[];
  /** Length of the line's vehicle, m, named when no depot slot fits it. */
  vehicleLengthM?: number;
  /** Opens the depot tool. */
  onOpenDepots?: () => void;
  showRoads: boolean;
  /** Where the level crossings come from ("railway tool drawing"), or null when there is no railway. */
  crossingSource?: string | null;
  status: string | null;
  error: string | null;
  actions: PanelActions;
  /** The noise plugin's section (toggle, band, legend), when the plugin is installed. */
  noise?: React.ReactNode;
  /** Checks from plugins (noise), added to the line's own. */
  extraChecks?: Check[];
  /** Facilities of the stops by point id. */
  stopFeatures?: Record<number, string[]>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-slate-200 pt-3">
      <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Purpose: how much of the circuit runs in main-road traffic or in bus lanes, and the delay that adds to
 * the running time (street setups from the GIS tab change it).
 */
function Reliability({ view }: { view: LineView }) {
  const { t } = useI18n();
  const mixed = view.mixed_traffic_m ?? 0;
  const lanes = view.bus_lane_m ?? 0;
  const delayMin = (view.traffic_delay_s ?? 0) / 60;
  const streets = (view.mixed_streets ?? []).filter((m) => m.name).slice(0, 4);
  return (
    <section
      aria-label={t("street.reliability")}
      className="flex flex-col gap-1 rounded-md bg-slate-50 p-2 text-xs text-slate-700"
    >
      <p>
        <b className="font-semibold">{t("street.reliability")}:</b>{" "}
        {t("street.reliabilityFacts", { mixed: formatLength(mixed), lanes: formatLength(lanes) })}
        {delayMin >= 0.05 ? ` · ${t("street.reliabilityDelay", { min: delayMin.toFixed(1) })}` : ""}.
      </p>
      {mixed > 0 && (
        <p className="text-slate-600">
          {streets.length
            ? `${t("street.inTrafficOn", { streets: streets.map((m) => m.name).join(", ") })} `
            : ""}
          {t("street.giveBusLane")}
        </p>
      )}
    </section>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-md bg-slate-100 p-2">
      <b className="block font-mono text-base">{value}</b>
      <span className="text-xs text-slate-600">{label}</span>
    </div>
  );
}

function NumberField({
  label,
  value,
  unit,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  unit: string;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          step={step}
          value={value}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
          className="w-20 rounded border border-slate-300 px-1 py-0.5 text-end"
        />
        <span className="w-6 text-slate-500">{unit}</span>
      </span>
    </label>
  );
}

/**
 * Purpose: the street line side panel, laid out like the line and track drawing mockup:
 * mode, name and vehicle, stat tiles, route points in circuit order, checks, depot runs and service. The
 * routing rules are set in the project preferences.
 */
export function LinePanel(props: Props) {
  const { t } = useI18n();
  const vehiclesOff = useVehiclesOff();
  const planned = usePlannedModes();
  const { view, profile, timing, selected, actions: a } = props;
  // The day type whose times and headways the fields below show and change.
  const [day, setDay] = useState<DayTypeId>("weekday");
  const weekday = streetWeekday(timing);
  const shown = shownDay(weekday, timing.days, day);
  const setDayService = (patch: Partial<DayService>) => {
    const next = editDay(weekday, timing.days, day, patch);
    a.setTiming({
      ...timing,
      firstMin: next.weekday.firstMin,
      lastMin: next.weekday.lastMin,
      headwayMin: next.weekday.peakHeadwayMin,
      offPeakHeadwayMin: next.weekday.offPeakHeadwayMin,
      days: next.days,
    });
  };
  const mode = MODES[profile.mode];
  const st = lineStats(view, timing);
  const rank: Record<Severity, number> = { error: 0, warn: 1, ok: 2, info: 3 };
  const vehicle = vehicleById(props.vehicle);
  const serviceChecks: Check[] = [
    ...(shown.lastMin <= shown.firstMin
      ? [{ sev: "error" as const, text: t("rail.line.lastAfterFirst") }]
      : []),
    ...(shown.peakHeadwayMin < 1 || shown.offPeakHeadwayMin < 1
      ? [{ sev: "error" as const, text: t("rail.line.headwayMin") }]
      : []),
  ];
  const checks = [...serviceChecks, ...lineChecks(view), ...(props.extraChecks ?? [])].sort(
    (x, y) => rank[x.sev] - rank[y.sev],
  );
  // In a project the checks go to the notifications button in the top bar; on its own the panel lists them.
  // A line with no points yet is not a problem of the project (the tab was only opened), so it reports nothing.
  const checksElsewhere = usePublishChecks(
    "street",
    t("checks.streetLine", { name: props.lineName || t("street.untitled") }),
    (view.points.length === 0 ? [] : checks).map((c) => ({
      severity: c.sev === "warn" ? "warning" : c.sev,
      text: c.text,
      ...(c.point !== undefined ? { onShow: () => a.select(c.point!) } : {}),
    })),
  );
  // "No slot fits" names the vehicle's length, so the planner sees why (a 13 m coach in 12 m slots).
  const fitText = (p: Exclude<FitProblem, null>) =>
    p === "depot.fit.size" && props.vehicleLengthM ? `${t(p)}: ${formatLength(props.vehicleLengthM)}` : t(p);
  const stops = view.points.filter((p) => p.kind !== "via");
  const name = (id: number | undefined) => {
    const p = view.points.find((q) => q.id === id);
    return p ? `${p.seq + 1} · ${p.name}` : "";
  };
  const trip = (kind: "pull_out" | "pull_in", stop: number | undefined) =>
    view.depot_trips.find((t) => t.kind === kind && t.stop === stop);
  const terminals = [...new Set(view.depot_trips.map((t) => t.stop))];
  const outStop = props.depotStops.out ?? nearestTerminal(view.depot_trips, "pull_out");
  const inStop = props.depotStops.in ?? nearestTerminal(view.depot_trips, "pull_in");

  // Only the street modes the project plans to use (Project preferences), and the line's own.
  const modeChoices = offeredModes(MODE_ORDER, (m) => m, planned, profile.mode);

  return (
    <div className="flex flex-col gap-3 p-4 text-sm">
      <div className="flex flex-col gap-1">
        <span className="text-xs text-slate-600">{t("street.mode")}</span>
        <div
          role="radiogroup"
          aria-label={t("street.mode")}
          className="flex rounded border border-slate-300 bg-slate-50 p-0.5"
        >
          {modeChoices.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={profile.mode === m}
              onClick={() => a.setMode(m)}
              className={`flex-1 rounded px-1 py-1 text-xs ${profile.mode === m ? "bg-white font-semibold shadow" : "text-slate-600"}`}
              style={profile.mode === m ? { color: MODES[m].color } : undefined}
            >
              {t(MODES[m].label)}
            </button>
          ))}
        </div>
      </div>
      {props.lineList}
      <h2 className="text-xl font-semibold">{props.lineName || t("street.untitled")}</h2>
      <div className="flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs text-slate-600">{t("rail.line.name")}</span>
          <input
            value={props.lineName}
            onChange={(e) => a.setName(e.target.value)}
            className="rounded border border-slate-300 bg-slate-50 px-2 py-1.5"
          />
        </label>
        <input
          type="color"
          aria-label={t("rail.line.colour")}
          title={t("rail.line.colour")}
          value={props.lineColor}
          onChange={(e) => a.setColor(e.target.value)}
          className="h-9 w-10 rounded border border-slate-300"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-600">{t("street.vehicle")}</span>
          <select
            value={vehicle?.id ?? ""}
            onChange={(e) => a.setVehicle(e.target.value || null)}
            className="rounded border border-slate-300 bg-slate-50 p-1"
          >
            <option value="">{t("street.vehicleTypical", { mode: t(mode.label) })}</option>
            {usedVehicles(vehiclesFor(profile.mode), vehiclesOff, vehicle?.id).map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-slate-600" data-testid="vehicle-facts">
          {vehicle
            ? t("street.vehicleFacts", {
                length: formatLength(vehicle.length_m),
                speed: Math.round(vehicle.top_speed_kmh),
                places: vehicle.capacity,
              })
            : t(mode.profile)}
        </p>
        {profile.mode === "trolleybus" && (
          <NumberField
            label={t("street.battery")}
            value={profile.battery_range_m}
            unit="m"
            step={100}
            onChange={(v) => a.setProfile({ ...profile, battery_range_m: v })}
          />
        )}
        {profile.mode === "brt" && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={profile.doors_both_sides}
              onChange={(e) => a.setProfile({ ...profile, doors_both_sides: e.target.checked })}
            />
            {t("street.doorsBoth")}
          </label>
        )}
      </div>

      {selected !== null && (
        // While a point is open the tiles make room for it, but the totals stay readable, so the effect of an edit
        // (a via point made a stop) shows at once.
        <p className="m-0 border-t border-slate-200 pt-2 text-xs text-slate-600" aria-live="polite">
          {t("street.stat.compact", {
            length: formatLength(st.lengthM),
            stops: st.stops,
            cycle: Math.round(st.cycleMin),
            vehicles: st.vehicles,
          })}
        </p>
      )}
      {selected === null && (
        <div className="grid grid-cols-2 gap-2 border-t border-slate-200 pt-3">
          <Stat value={formatLength(st.lengthM)} label={t("street.stat.length")} />
          <Stat value={String(st.stops)} label={t("street.stat.stops", { end: st.endStops })} />
          <Stat
            value={`${Math.round(st.cycleMin)} min`}
            label={t("street.stat.cycle", {
              run: Math.round(st.runMin),
              crossings:
                st.crossingMin > 0
                  ? ` ${t("street.stat.atCrossings", { min: st.crossingMin < 1 ? "<1" : Math.round(st.crossingMin) })}`
                  : "",
              dwell: Math.round(st.dwellMin),
              layover: Math.round(st.layoverMin),
            })}
          />
          <Stat
            value={String(st.vehicles)}
            label={t("street.stat.vehicles", { headway: timing.headwayMin })}
          />
        </div>
      )}
      {view.points.length >= 2 && <Reliability view={view} />}
      {props.noise}

      {(props.status || props.error) && (
        <p
          className={`rounded px-2 py-1 text-xs ${props.error ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-700"}`}
          role="status"
        >
          {props.error ?? props.status}
        </p>
      )}

      <Section title={t("street.points")}>
        {view.points.length === 0 && <p className="text-slate-600">{t("street.noPoints")}</p>}
        <ol className="flex flex-col">
          {view.points.map((p) => {
            const leg = view.legs[p.seq];
            const sel = p.id === selected;
            return (
              <li
                key={p.id}
                className={`rounded px-1 py-1 ${sel ? "bg-amber-50 ring-1 ring-amber-400" : ""}`}
              >
                <div
                  className="flex cursor-pointer items-center gap-2"
                  onClick={() => a.select(sel ? null : p.id)}
                >
                  {p.kind === "via" ? (
                    <span className="flex h-5 w-5 items-center justify-center">
                      <span
                        className="h-3 w-3 rounded-full border-2"
                        style={{ borderColor: p.status === "error" ? "#dc2626" : mode.color }}
                      />
                    </span>
                  ) : (
                    <span
                      className="flex h-5 w-5 items-center justify-center rounded text-xs font-bold text-white"
                      style={{ background: p.status === "error" ? "#dc2626" : mode.color }}
                    >
                      {p.seq + 1}
                    </span>
                  )}
                  <span className={`flex-1 truncate ${p.kind === "via" ? "text-slate-500" : ""}`}>
                    {p.kind === "via" ? t("street.viaN", { n: p.seq + 1 }) : p.name}
                  </span>
                  {p.kind === "end_stop" && (
                    <span className="rounded-full border border-slate-300 px-1.5 text-xs text-slate-500">
                      {t("street.end")}
                    </span>
                  )}
                  {leg && (
                    <span
                      className="font-mono text-xs"
                      style={{
                        color:
                          leg.status === "ok" ? "#64748b" : leg.status === "warning" ? "#d97706" : "#dc2626",
                      }}
                    >
                      → {formatLength(leg.length_m)}
                    </span>
                  )}
                </div>
                {p.status === "error" && p.message && (
                  <p className="ps-7 text-xs text-red-700" role="note">
                    {p.message}
                  </p>
                )}
                {leg?.status === "error" && leg.message && (
                  <p className="ps-7 text-xs text-red-700" role="note">
                    {leg.message}
                  </p>
                )}
                {sel && (
                  <div className="mt-1 flex flex-col gap-1 ps-7">
                    {p.kind !== "via" && (
                      <input
                        aria-label={t("street.pointName", { n: p.seq + 1 })}
                        className="rounded border border-slate-300 px-1 py-0.5"
                        defaultValue={p.name}
                        key={p.name}
                        onBlur={(e) => e.target.value !== p.name && a.setPointName(p.id, e.target.value)}
                      />
                    )}
                    {p.kind !== "via" && (
                      <SymbolPicker
                        options={STATION_FEATURES}
                        value={cleanFeatures(props.stopFeatures?.[p.id])}
                        label={t("station.features")}
                        onChange={(f) => a.setPointFeatures(p.id, f)}
                        t={t}
                      />
                    )}
                    {p.kind !== "via" && <StopSide id={p.id} actions={a} t={t} />}
                    <div className="flex items-center gap-1">
                      <span
                        role="group"
                        aria-label={t("street.pointKind", { n: p.seq + 1 })}
                        className="flex"
                      >
                        {KINDS.map((k) => (
                          <button
                            key={k.id}
                            type="button"
                            title={t(k.title)}
                            aria-pressed={p.kind === k.id}
                            onClick={() => a.setKind(p.id, k.id)}
                            className={`border border-slate-300 px-1.5 py-0.5 text-xs first:rounded-s last:rounded-e ${p.kind === k.id ? "bg-slate-800 text-white" : "bg-white"}`}
                          >
                            {t(k.label)}
                          </button>
                        ))}
                      </span>
                      <button
                        type="button"
                        aria-label={t("street.deletePoint", { n: p.seq + 1 })}
                        className="ms-auto text-xs text-slate-500 hover:text-red-700"
                        onClick={() => a.deletePoint(p.id)}
                      >
                        {t("street.delete")}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {view.points.length > 1 && <p className="ps-7 text-xs text-slate-500">↺ {t("street.backTo1")}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100 disabled:opacity-40"
            disabled={view.points.length < 2}
            onClick={a.optimise}
            title={t("street.optimiseTitle")}
          >
            {t("street.optimise")}
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100 disabled:opacity-40"
            disabled={view.points.length === 0}
            onClick={a.clear}
          >
            {t("street.clearLine")}
          </button>
        </div>
      </Section>

      {!checksElsewhere && (
        <Section title={t("rail.checks")}>
          <ul className="flex flex-col gap-1.5" aria-label={t("rail.checks")}>
            {checks.map((c) => (
              <li
                key={c.text}
                className={`flex gap-2 ${c.point !== undefined ? "cursor-pointer" : ""}`}
                onClick={() => c.point !== undefined && a.select(c.point)}
              >
                <span className={`h-fit rounded px-1 text-[10px] font-bold uppercase ${CHIP[c.sev]}`}>
                  {sevLabel(t, c.sev)}
                </span>
                <span className="text-xs">{c.text}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={`${t("rail.levelCrossings")} · ${view.level_crossings.length}`}>
        <p className="text-xs text-slate-600">{t("street.crossingsNote")}</p>
        {view.level_crossings.length > 0 && (
          <ul className="flex flex-col gap-1.5" aria-label={t("street.crossingsOnLine")}>
            {view.level_crossings.map((x) => (
              <li key={x.ids.join()} className="flex flex-col">
                <span>
                  <b>{x.street || t("rail.unnamedStreet")}</b> ·{" "}
                  {x.modes.map((m) => (RAIL_MODE[m] ? t(RAIL_MODE[m]!) : m)).join(", ")} ·{" "}
                  {x.protection === "barriers" ? t("rail.barriers") : t("rail.trafficSignals")}
                  {x.passes > 1 ? ` · ${t("street.passed", { n: x.passes })}` : ""}
                </span>
                <span className="text-xs text-slate-600">
                  {t("street.wait", {
                    wait: seconds(x.wait.wait_s),
                    when:
                      x.wait.peak_hour_s !== null
                        ? t("street.busiestHour", { time: clock(x.wait.peak_hour_s) })
                        : t("street.peak"),
                    offpeak: seconds(x.wait.off_peak_wait_s),
                  })}{" "}
                  ·{" "}
                  {t("street.closures", {
                    n: Math.round(x.wait.closures_per_hour),
                    s: Math.round(x.wait.mean_closure_s),
                    share: Math.round(x.wait.closed_share * 100),
                  })}{" "}
                  · {t(SOURCE[x.wait.source])}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-slate-600">
          {props.crossingSource
            ? t("street.railwaySource", {
                railway: props.crossingSource,
                closures: t("street.source.assumed"),
              })
            : t("street.noRailway")}
          {props.crossingSource && view.level_crossings.length === 0 && view.legs.length > 0
            ? ` ${t("street.crossesNone")}`
            : ""}
        </p>
      </Section>

      <Section title={t("street.depotRuns")}>
        <p className="text-xs text-slate-600">{t("street.depotNote")}</p>
        <label className="flex items-center gap-2">
          <span className="w-20">{t("depot.line.depot")}</span>
          <select
            value={props.depotId ?? ""}
            onChange={(e) => a.chooseDepot(e.target.value || null)}
            className="min-w-0 flex-1 rounded border border-slate-300 p-0.5"
          >
            <option value="">{t("depot.line.none")}</option>
            {(props.depots ?? []).map((d) => (
              <option key={d.id} value={d.id} disabled={d.problem !== null && d.id !== props.depotId}>
                {d.problem ? `${d.name} (${fitText(d.problem)})` : d.name}
              </option>
            ))}
          </select>
        </label>
        {props.depotId && (props.depots ?? []).find((d) => d.id === props.depotId)?.problem && (
          <p className="text-xs text-amber-700">
            {fitText((props.depots ?? []).find((d) => d.id === props.depotId)!.problem!)}
          </p>
        )}
        {props.depotId && !(props.depots ?? []).some((d) => d.id === props.depotId) && (
          <p className="text-xs text-amber-700">{t("depot.line.gone")}</p>
        )}
        {!(props.depots ?? []).length && <p className="text-xs text-slate-600">{t("depot.line.noDepots")}</p>}
        {props.onOpenDepots && (
          <button
            type="button"
            className="w-fit rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
            onClick={props.onOpenDepots}
          >
            {t("depot.line.open")}
          </button>
        )}
        {!view.depot ? null : (
          <>
            {terminals.length === 0 && <p className="text-xs text-slate-600">{t("street.addStopsDepot")}</p>}
            {terminals.length > 0 &&
              (["pull_out", "pull_in"] as const).map((kind) => {
                const chosen = kind === "pull_out" ? outStop : inStop;
                const tr = trip(kind, chosen);
                return (
                  <label key={kind} className="flex items-center gap-2">
                    <span className="w-20">
                      {kind === "pull_out" ? t("street.pullOut") : t("street.pullIn")}
                    </span>
                    <select
                      value={chosen}
                      onChange={(e) =>
                        a.setDepotStops({
                          ...props.depotStops,
                          [kind === "pull_out" ? "out" : "in"]: Number(e.target.value),
                        })
                      }
                      className="min-w-0 flex-1 rounded border border-slate-300 p-0.5"
                    >
                      {terminals.map((s) => (
                        <option key={s} value={s}>
                          {name(s)}
                        </option>
                      ))}
                    </select>
                    <span className={`font-mono text-xs ${tr?.status === "error" ? "text-red-700" : ""}`}>
                      {tr?.status === "ok" ? formatLength(tr.length_m) : t("street.noPath")}
                    </span>
                  </label>
                );
              })}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={props.showDepot}
                onChange={(e) => a.setShowDepot(e.target.checked)}
              />
              {t("street.showDepot")}
            </label>
            {!props.depotId && (
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
                  onClick={a.placeDepot}
                >
                  {t("street.moveDepot")}
                </button>
                <button
                  type="button"
                  className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
                  onClick={a.removeDepot}
                >
                  {t("street.removeDepot")}
                </button>
              </div>
            )}
          </>
        )}
        {stops.length === 0 && view.depot && null}
      </Section>

      <Section title={t("street.service")}>
        <DayTypeChoice
          day={day}
          onDay={setDay}
          own={hasOwnDay(timing.days, day)}
          onOwn={(own) =>
            day !== "weekday" &&
            a.setTiming({ ...timing, days: withDay(timing.days, day, own ? shown : null) })
          }
        />
        <label className="flex items-center justify-between gap-2">
          <span>{t("rail.line.first")}</span>
          <span className="flex items-center gap-1">
            <TimeInput
              label={t("rail.line.first")}
              value={shown.firstMin}
              onChange={(v) => setDayService({ firstMin: v })}
            />
            <span className="w-6" />
          </span>
        </label>
        <label className="flex items-center justify-between gap-2">
          <span>{t("rail.line.last")}</span>
          <span className="flex items-center gap-1">
            <TimeInput
              label={t("rail.line.last")}
              value={shown.lastMin}
              onChange={(v) => setDayService({ lastMin: v })}
            />
            <span className="w-6" />
          </span>
        </label>
        <NumberField
          label={t("rail.line.peakHeadway")}
          value={shown.peakHeadwayMin}
          unit="min"
          onChange={(v) => setDayService({ peakHeadwayMin: v })}
        />
        <NumberField
          label={t("rail.line.offpeakHeadway")}
          value={shown.offPeakHeadwayMin}
          unit="min"
          onChange={(v) => setDayService({ offPeakHeadwayMin: v })}
        />
        <NumberField
          label={t("street.dwell")}
          value={timing.dwellS}
          unit="s"
          step={5}
          onChange={(v) => a.setTiming({ ...timing, dwellS: v })}
        />
        <NumberField
          label={t("street.layover")}
          value={timing.layoverMin}
          unit="min"
          onChange={(v) => a.setTiming({ ...timing, layoverMin: v })}
        />
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={props.showRoads}
            onChange={(e) => a.setShowRoads(e.target.checked)}
          />
          {t("street.showRoads")}
          {profile.mode === "trolleybus" ? ` ${t("street.greenWire")}` : ""}
        </label>
        <p className="text-xs text-slate-500">{t("street.rulesNote")}</p>
      </Section>
    </div>
  );
}

/**
 * Purpose: the sidewalk a stop is served from: what serving it from the other one would add or save, and a
 * button to switch (a stop on the far kerb of a side street can force a loop round the block).
 */
function StopSide({ id, actions: a, t }: { id: number; actions: PanelActions; t: Translate }) {
  const cost = a.sideCost(id);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
      {cost !== null && Math.abs(cost) >= 5 && (
        <span className={cost < 0 ? "text-amber-800" : ""}>
          {t(cost < 0 ? "street.sideSaves" : "street.sideAdds", { length: formatLength(Math.abs(cost)) })}
        </span>
      )}
      <button
        type="button"
        className="rounded border border-slate-300 bg-white px-1.5 py-0.5"
        onClick={() => a.switchSide(id)}
      >
        {t("street.sideSwitch")}
      </button>
    </div>
  );
}
