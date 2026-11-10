import { type Translate, useI18n } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/messages";
import { formatLength } from "./geojson";
import { MODE_ORDER, MODES, type Timing } from "./modes";
import { lineChecks, lineStats, type Check, type Severity } from "./summary";
import type { LineView, Mode, PointKind, RoutingRules, VehicleProfile } from "./types";

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
  setMode: (mode: Mode) => void;
  setProfile: (p: VehicleProfile) => void;
  setRules: (r: RoutingRules) => void;
  setTiming: (t: Timing) => void;
  select: (id: number | null) => void;
  setKind: (id: number, kind: PointKind) => void;
  setPointName: (id: number, name: string) => void;
  deletePoint: (id: number) => void;
  optimise: () => void;
  clear: () => void;
  placeDepot: () => void;
  removeDepot: () => void;
  setDepotStops: (s: { out?: number; in?: number }) => void;
  setShowDepot: (v: boolean) => void;
  setShowRoads: (v: boolean) => void;
  /** A track topology file (the railway tool's Download track topology) replaces the drawing. */
  loadTopology: (name: string, text: string) => void;
  /** Rail timetable closures (rail-plan's level_crossing_closures) replace the assumed service. */
  loadClosures: (name: string, text: string) => void;
  clearTopology: () => void;
  clearClosures: () => void;
}

/** Where the level crossings and their closures come from, for the panel. */
export interface CrossingSources {
  /** Topology file name, "railway tool drawing", or null for none. */
  topology: string | null;
  topologyIsFile: boolean;
  /** Closures file name, or null for the service assumed in the topology. */
  closures: string | null;
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

/** Purpose: a file input that hands the file's name and text to `onLoad`. */
function FileButton({ label, onLoad }: { label: string; onLoad: (name: string, text: string) => void }) {
  return (
    <label className="w-fit cursor-pointer rounded border border-slate-300 px-2 py-1 hover:bg-slate-100">
      {label}
      <input
        type="file"
        accept="application/json,.json"
        className="sr-only"
        aria-label={label}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void f.text().then((t) => onLoad(f.name, t));
        }}
      />
    </label>
  );
}

interface Props {
  lineName: string;
  view: LineView;
  profile: VehicleProfile;
  rules: RoutingRules;
  timing: Timing;
  selected: number | null;
  depotStops: { out?: number; in?: number };
  showDepot: boolean;
  showRoads: boolean;
  crossingSources?: CrossingSources;
  status: string | null;
  error: string | null;
  actions: PanelActions;
  /** The noise plugin's section (toggle, band, legend), when the plugin is installed. */
  noise?: React.ReactNode;
  /** Checks from plugins (noise), added to the line's own. */
  extraChecks?: Check[];
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
 * name and mode, stat tiles, route points in circuit order, checks, depot runs and rules.
 */
export function LinePanel(props: Props) {
  const { t } = useI18n();
  const { view, profile, rules, timing, selected, actions: a } = props;
  const mode = MODES[profile.mode];
  const st = lineStats(view, timing);
  const rank: Record<Severity, number> = { error: 0, warn: 1, ok: 2, info: 3 };
  const checks = [...lineChecks(view), ...(props.extraChecks ?? [])].sort(
    (x, y) => rank[x.sev] - rank[y.sev],
  );
  const stops = view.points.filter((p) => p.kind !== "via");
  const name = (id: number | undefined) => {
    const p = view.points.find((q) => q.id === id);
    return p ? `${p.seq + 1} · ${p.name}` : "";
  };
  const trip = (kind: "pull_out" | "pull_in", stop: number | undefined) =>
    view.depot_trips.find((t) => t.kind === kind && t.stop === stop);
  const terminals = [...new Set(view.depot_trips.map((t) => t.stop))];
  const outStop = props.depotStops.out ?? terminals[0];
  const inStop = props.depotStops.in ?? terminals[0];

  return (
    <div className="flex flex-col gap-3 p-4 text-sm">
      <h2 className="text-xl font-semibold">{props.lineName || t("street.untitled")}</h2>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-slate-600">{t("rail.line.name")}</span>
        <input
          value={props.lineName}
          onChange={(e) => a.setName(e.target.value)}
          className="rounded border border-slate-300 bg-slate-50 px-2 py-1.5"
        />
      </label>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-slate-600">{t("street.mode")}</span>
        <div
          role="radiogroup"
          aria-label={t("street.mode")}
          className="flex rounded border border-slate-300 bg-slate-50 p-0.5"
        >
          {MODE_ORDER.map((m) => (
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
        <p className="text-xs text-slate-600">{t(mode.profile)}</p>
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
        <Stat value={String(st.vehicles)} label={t("street.stat.vehicles", { headway: timing.headwayMin })} />
      </div>
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
                      <span className="h-3 w-3 rounded-full border-2" style={{ borderColor: mode.color }} />
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
          {props.crossingSources?.topology
            ? t("street.railwaySource", {
                railway: props.crossingSources.topology,
                closures: props.crossingSources.closures ?? t("street.source.assumed"),
              })
            : t("street.noRailway")}
          {props.crossingSources?.topology && view.level_crossings.length === 0 && view.legs.length > 0
            ? ` ${t("street.crossesNone")}`
            : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          <FileButton label={t("street.loadTopology")} onLoad={a.loadTopology} />
          {props.crossingSources?.topologyIsFile && (
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
              onClick={a.clearTopology}
            >
              {t("street.useDrawing")}
            </button>
          )}
          <FileButton label={t("street.loadClosures")} onLoad={a.loadClosures} />
          {props.crossingSources?.closures && (
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
              onClick={a.clearClosures}
            >
              {t("street.useAssumed")}
            </button>
          )}
        </div>
      </Section>

      <Section title={t("street.depotRuns")}>
        <p className="text-xs text-slate-600">{t("street.depotNote")}</p>
        {!view.depot ? (
          <button
            type="button"
            className="w-fit rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
            onClick={a.placeDepot}
          >
            {t("street.placeDepot")}
          </button>
        ) : (
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
          </>
        )}
        {stops.length === 0 && view.depot && null}
      </Section>

      <Section title={t("street.rules")}>
        <label className="flex items-center justify-between gap-2">
          <span>{t("street.traffic")}</span>
          <select
            value={rules.traffic_side}
            onChange={(e) =>
              a.setRules({ ...rules, traffic_side: e.target.value as RoutingRules["traffic_side"] })
            }
            className="rounded border border-slate-300 p-0.5"
          >
            <option value="right">{t("street.rightHand")}</option>
            <option value="left">{t("street.leftHand")}</option>
          </select>
        </label>
        <NumberField
          label={t("street.grouping")}
          value={rules.grouping_distance_m}
          unit="m"
          step={10}
          onChange={(v) => a.setRules({ ...rules, grouping_distance_m: v })}
        />
        <NumberField
          label={t("street.detourWarn")}
          value={rules.detour_warn_m}
          unit="m"
          step={50}
          onChange={(v) => a.setRules({ ...rules, detour_warn_m: v })}
        />
        <NumberField
          label={t("street.headway")}
          value={timing.headwayMin}
          unit="min"
          onChange={(v) => a.setTiming({ ...timing, headwayMin: v })}
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
