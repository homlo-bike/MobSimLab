import { hasMessage, type Translate, type TranslatePlural, useI18n } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/messages";
import { signalById, update, updateSignal } from "./doc";
import { COLORS, fmtM, fmtTime, LEVEL_LABEL, LEVELS, POWER, RAIL_MODES } from "./modes";
import type { Selection } from "./RailwayEditor";
import { type Publication, ServiceLinesPanel } from "./ServiceLinesPanel";
import type {
  Level,
  LonLat,
  Network,
  TrackElevation,
  Power,
  RailMode,
  RailView,
  IssueView,
  Severity,
  Signal,
  SignalKind,
  Slip,
  Station,
  Switch,
  Track,
  TrackUse,
} from "./types";

/** Railway editing tools, as in the mockup. */
export type RailTool = "select" | "station" | "track" | "turnout" | "crossover" | "signal" | "pan" | "line";

/** Settings for the next track drawn. */
export interface NewTrackOpts {
  tracks: 1 | 2;
  level: Level;
  power: Power;
  use: TrackUse;
}

/** Settings for the next station placed. */
export interface NewStationOpts {
  level: Level;
  sides: number;
  islands: number;
}

/** Settings for the next switch placed (`element` null = the mode's default turnout). */
export interface NewSwitchOpts {
  junction: boolean;
  scissors: boolean;
  element: string | null;
}

/** Edits the panel can ask for; the editor applies them. */
export interface RailPanelActions {
  setTool: (t: RailTool) => void;
  setDoc: (d: Network) => void;
  select: (s: Selection | null) => void;
  setTrackOpts: (o: NewTrackOpts) => void;
  setStationOpts: (o: NewStationOpts) => void;
  setSwitchOpts: (o: NewSwitchOpts) => void;
  finishDraft: () => void;
  cancelDraft: () => void;
  remove: (id: number) => void;
  setMode: (m: RailMode) => void;
  clear: () => void;
  showIssue: (at: LonLat | null, ref: number | null) => void;
  /** Rename a station and the stations next to it; a name used farther away gets a number. */
  renameStation: (id: number, name: string) => void;
  fit: () => void;
  /** Drop the planner's signal changes, so the plan is the generated one again. */
  resetSignals: () => void;
}

interface Props {
  /** Why streets (and so level crossings) are missing, if they are. */
  streetNote?: string | null;
  /** Existing railways from OpenStreetMap are loaded (app setting). */
  existingRailways?: boolean;
  doc: Network;
  view: RailView;
  tool: RailTool;
  sel: Selection | null;
  draft: Track | null;
  trackOpts: NewTrackOpts;
  stationOpts: NewStationOpts;
  switchOpts: NewSwitchOpts;
  error: string | null;
  actions: RailPanelActions;
  /** The noise plugin's section (toggle, band, legend), when the plugin is installed. */
  noise?: React.ReactNode;
  /** Checks from plugins (noise), added after the design's own. */
  extraIssues?: IssueView[];
  /** Service lines: the last publication, publishing, and picking stops on the map. */
  service: {
    publication: Publication | null;
    publish: () => void;
    picking: string | null;
    setPicking: (id: string | null) => void;
    /** Start a new line and pick its stations on the map. */
    newLine: () => void;
  };
}

const CHIP: Record<Severity, string> = {
  ok: COLORS.ok,
  info: COLORS.info,
  warning: COLORS.warn,
  error: COLORS.error,
};
const VERTEX: Record<string, MessageKey> = {
  leadstart: "rail.curve.outOfStart",
  lead_start: "rail.curve.outOfStart",
  leadend: "rail.curve.intoEnd",
  lead_end: "rail.curve.intoEnd",
};
const field = "rounded border border-slate-300 bg-slate-50 px-2 py-1";
const input = `${field} min-w-0 max-w-56`;

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-slate-200 pt-3">
      <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">{title}</h3>
      {children}
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

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-slate-700">{label}</span>
      {children}
    </label>
  );
}

export function Num({
  value,
  onChange,
  unit,
  min = 0,
  step = 1,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  unit: string;
  min?: number;
  step?: number;
  label: string;
}) {
  return (
    <span className="flex items-center gap-1">
      <input
        type="number"
        aria-label={label}
        min={min}
        step={step}
        value={Math.round(value * 10) / 10}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(Math.max(min, v));
        }}
        className="w-20 rounded border border-slate-300 px-1 py-0.5 text-end"
      />
      <span className="w-7 text-slate-500">{unit}</span>
    </span>
  );
}

function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex rounded border border-slate-300 bg-slate-50 p-0.5"
    >
      {options.map((o) => (
        <button
          key={String(o.id)}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`flex-1 rounded px-1.5 py-1 text-xs ${value === o.id ? "bg-emerald-800 text-white" : "hover:bg-slate-200"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Purpose: the level options with their short labels ("−1", "Street", "+1") in the current language. */
const levelOpts = (t: Translate) =>
  LEVELS.map((l) => ({ id: l.id, label: hasMessage(l.short) ? t(l.short) : l.short }));

/**
 * Purpose: the railway side panel, laid out like the railways tab of the mockup: mode and its
 * design values, settings for new elements, the inspector for the selection, and live checks.
 */
export function RailPanel(props: Props) {
  const { t, tn } = useI18n();
  const { doc, view, tool, sel, draft, actions: a } = props;
  const p = view.params;
  const kind = sel
    ? doc.stations.some((s) => s.id === sel.id)
      ? "station"
      : doc.tracks.some((t) => t.id === sel.id)
        ? "track"
        : doc.switches.some((s) => s.id === sel.id)
          ? "switch"
          : signalById(doc, sel.id, view.signals)
            ? "signal"
            : null
    : null;
  const issues = [...view.issues, ...(props.extraIssues ?? [])];

  return (
    <div className="flex flex-col gap-3 p-4 text-sm">
      <h2 className="text-xl font-semibold">{t("rail.title")}</h2>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-slate-600">{t("rail.modeForNew")}</span>
        <select value={doc.mode} onChange={(e) => a.setMode(e.target.value as RailMode)} className={field}>
          {RAIL_MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {t(m.label)}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-slate-600">
        {t("rail.params", {
          gauge: p.gauge_mm,
          centres: p.track_centre_m,
          minRadius: p.min_radius_m,
          radius: p.recommended_radius_m,
          gradient: p.max_gradient_permille,
          speed: p.design_speed_kmh,
          platform: p.platform_length_m,
          height: p.platform_height_mm,
          power: electrification(t, String(p.electrification)),
        })}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Stat value={`${view.counts.route_km.toFixed(2)} km`} label={t("rail.stat.route")} />
        <Stat value={`${view.counts.track_km.toFixed(2)} km`} label={t("rail.stat.track")} />
        <Stat value={String(doc.stations.length)} label={t("rail.stat.stations")} />
        <Stat value={String(doc.switches.length)} label={t("rail.stat.switches")} />
      </div>
      {props.noise}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={a.fit}
          className="flex-1 rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
        >
          {t("rail.zoomAll")}
        </button>
        <button
          type="button"
          onClick={a.clear}
          className="flex-1 rounded border border-slate-300 px-2 py-1 hover:bg-red-50"
        >
          {t("rail.clear")}
        </button>
      </div>

      {tool === "station" && (
        <Section title={t("rail.newStation")}>
          <Segmented
            label={t("rail.stationLevel")}
            value={props.stationOpts.level}
            options={levelOpts(t)}
            onChange={(level) => a.setStationOpts({ ...props.stationOpts, level })}
          />
          <Row label={t("rail.sidePlatforms")}>
            <Num
              label={t("rail.sidePlatforms")}
              unit=""
              value={props.stationOpts.sides}
              onChange={(sides) =>
                a.setStationOpts({ ...props.stationOpts, sides: Math.min(2, Math.round(sides)) })
              }
            />
          </Row>
          <Row label={t("rail.islandPlatforms")}>
            <Num
              label={t("rail.islandPlatforms")}
              unit=""
              value={props.stationOpts.islands}
              onChange={(islands) =>
                a.setStationOpts({ ...props.stationOpts, islands: Math.min(4, Math.round(islands)) })
              }
            />
          </Row>
        </Section>
      )}

      {(tool === "track" || draft) && (
        <Section title={draft ? t("rail.drawingTrack") : t("rail.newTrack")}>
          <Segmented<1 | 2>
            label={t("rail.tracks")}
            value={props.trackOpts.tracks}
            options={[
              { id: 1, label: t("rail.single") },
              { id: 2, label: t("rail.double") },
            ]}
            onChange={(tracks) => a.setTrackOpts({ ...props.trackOpts, tracks })}
          />
          <Segmented
            label={t("rail.level")}
            value={props.trackOpts.level}
            options={levelOpts(t)}
            onChange={(level) => a.setTrackOpts({ ...props.trackOpts, level })}
          />
          <Row label={t("rail.electrification")}>
            <select
              value={props.trackOpts.power}
              onChange={(e) => a.setTrackOpts({ ...props.trackOpts, power: e.target.value as Power })}
              className={input}
            >
              {POWER.map((o) => (
                <option key={o.id} value={o.id}>
                  {t(o.label)}
                </option>
              ))}
            </select>
          </Row>
          <Segmented<TrackUse>
            label={t("rail.use")}
            value={props.trackOpts.use}
            options={[
              { id: "running", label: t("rail.running") },
              { id: "storage", label: t("rail.storage") },
            ]}
            onChange={(use) => a.setTrackOpts({ ...props.trackOpts, use })}
          />
          {draft && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={a.finishDraft}
                className="flex-1 rounded bg-emerald-800 px-2 py-1 text-white"
              >
                {t("rail.finish")}
              </button>
              <button
                type="button"
                onClick={a.cancelDraft}
                className="flex-1 rounded border border-slate-300 px-2 py-1"
              >
                {t("rail.cancel")}
              </button>
            </div>
          )}
        </Section>
      )}

      {(tool === "turnout" || tool === "crossover") && (
        <Section title={tool === "turnout" ? t("rail.newTurnout") : t("rail.newCrossover")}>
          <Row label={t("rail.element")}>
            <select
              value={props.switchOpts.element ?? p.default_turnout}
              onChange={(e) => a.setSwitchOpts({ ...props.switchOpts, element: e.target.value })}
              className={input}
            >
              {view.turnouts.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Row>
          {tool === "turnout" ? (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={props.switchOpts.junction}
                onChange={(e) => a.setSwitchOpts({ ...props.switchOpts, junction: e.target.checked })}
              />
              {t("rail.doubleJunction")}
            </label>
          ) : (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={props.switchOpts.scissors}
                onChange={(e) => a.setSwitchOpts({ ...props.switchOpts, scissors: e.target.checked })}
              />
              {t("rail.scissors")}
            </label>
          )}
        </Section>
      )}

      {kind === "station" && sel && (
        <StationInspector st={doc.stations.find((s) => s.id === sel.id)!} {...props} />
      )}
      {kind === "track" && sel && <TrackInspector t={doc.tracks.find((s) => s.id === sel.id)!} {...props} />}
      {kind === "switch" && sel && (
        <SwitchInspector sw={doc.switches.find((s) => s.id === sel.id)!} {...props} />
      )}
      {kind === "signal" && sel && <SignalInspector sg={signalById(doc, sel.id, view.signals)!} {...props} />}

      <ServiceLinesPanel doc={doc} view={view} setDoc={a.setDoc} show={a.showIssue} {...props.service} />

      <Section
        title={view.signals.length ? `${t("rail.signals")} · ${view.signals.length}` : t("rail.signals")}
      >
        <p className="text-xs text-slate-600">
          {view.signals.length
            ? t("rail.signalsSome", { summary: signalSummary(tn, view.signals) })
            : t("rail.signalsNone")}
        </p>
        {view.signals_edited && (
          <>
            <p className="text-xs text-slate-600">{signalEdits(t, tn, view)}</p>
            <button
              type="button"
              onClick={a.resetSignals}
              className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
            >
              {t("rail.resetSignals")}
            </button>
          </>
        )}
      </Section>

      {props.existingRailways && (
        <Section title={`${t("rail.existing")} · ${tn("rail.joins", view.existing_joins.length)}`}>
          <p className="text-xs text-slate-600">{t("rail.existingNote", { count: view.existing_count })}</p>
          <ul className="flex flex-col gap-1">
            {view.existing_joins.map((j) => (
              <li key={`${j.track}-${j.end}`}>
                <button
                  type="button"
                  onClick={() => a.showIssue(j.lonlat, j.track)}
                  className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-start hover:bg-slate-100"
                >
                  <span style={{ color: COLORS.existing }}>●</span>
                  <span>
                    {j.name || t("rail.unnamedRailway")} · {j.railway.replace("_", " ")} ·{" "}
                    {j.continues ? t("rail.continues") : t("rail.newTurnoutExisting")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <DiamondSection doc={props.doc} view={view} actions={a} />

      <Section title={`${t("rail.streetRunning")} · ${view.street_running.length}`}>
        <p className="text-xs text-slate-600">{t("rail.streetRunningNote")}</p>
        <ul className="flex flex-col gap-1">
          {view.street_running.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => a.showIssue(r.lonlat, r.track)}
                className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-start hover:bg-slate-100"
              >
                <span style={{ color: r.running === "mixed" ? COLORS.warn : COLORS.info }}>
                  {r.running === "mixed" ? "▲" : "●"}
                </span>
                <span>
                  {r.street || t("rail.unnamedStreet")} · {fmtM(r.length_m)} ·{" "}
                  {r.running === "reserved"
                    ? t("rail.ownLane")
                    : r.running === "mixed"
                      ? t("rail.inTraffic")
                      : t("rail.pedestrianZone")}{" "}
                  · {Math.round(r.speed_limit_kmh)} km/h
                  {r.bus ? ` · ${t("rail.buses")}` : ""}
                  {r.stops.length ? ` · ${tn("rail.stops", r.stops.length)}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={`${t("rail.levelCrossings")} · ${view.level_crossings.length}`}>
        <p className="text-xs text-slate-600">{t("rail.levelCrossingsNote")}</p>
        {props.streetNote && <p className="text-xs text-amber-800">{props.streetNote}</p>}
        <ul className="flex flex-col gap-1">
          {view.level_crossings.map((x) => (
            <li key={x.id}>
              <button
                type="button"
                onClick={() => a.showIssue(x.lonlat, x.track)}
                className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-start hover:bg-slate-100"
              >
                <span style={{ color: x.standard ? COLORS.info : COLORS.warn }}>
                  {x.standard ? "●" : "▲"}
                </span>
                <span>
                  {x.street || (x.path ? t("rail.unnamedPath") : t("rail.unnamedStreet"))} ·{" "}
                  {Math.round(x.angle_deg)}° · {x.path ? `${t(PATH_USERS[x.path])} · ` : ""}
                  {t(PROTECTION[x.protection])}
                  {x.bus ? ` · ${t("rail.buses")}` : ""}
                  {x.trolley_wire ? ` · ${t("rail.trolleyWire")}` : ""}
                  {x.standard ? "" : ` · ${t("rail.specialSafety")}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title={`${t("rail.checks")} · ${tn("rail.errors", view.counts.errors)} · ${tn("rail.warnings", view.counts.warnings)}`}
      >
        {props.error && <p className="text-red-700">{props.error}</p>}
        <ul className="flex flex-col gap-1">
          {issues.map((i, n) => (
            <li key={n}>
              <button
                type="button"
                disabled={!i.at && !i.ref_id}
                onClick={() => a.showIssue(i.at, i.ref_id)}
                className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-start hover:bg-slate-100 disabled:hover:bg-transparent"
              >
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={{ background: CHIP[i.severity] }}
                  aria-label={t(`severity.${i.severity}`)}
                />
                <span>{i.text}</span>
              </button>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

/** Who uses a path crossing the track, for the level crossing list. */
const PATH_USERS = {
  foot: "rail.pathUsers.foot",
  cycle: "rail.pathUsers.cycle",
  foot_cycle: "rail.pathUsers.foot_cycle",
} as const satisfies Record<string, MessageKey>;

/** How a level crossing is protected, for the level crossing list. */
const PROTECTION = {
  barriers: "rail.barriers",
  traffic_signals: "rail.trafficSignals",
  path_gates: "rail.gates",
  marked: "rail.markedCrossing",
} as const satisfies Record<string, MessageKey>;

const SIGNAL_KINDS: { id: SignalKind; label: MessageKey }[] = [
  { id: "main", label: "rail.signal.main" },
  { id: "block", label: "rail.signal.block" },
  { id: "shunting", label: "rail.signal.shunting" },
  { id: "distant", label: "rail.signal.distant" },
  { id: "speed", label: "rail.signal.speed" },
  { id: "speed_warning", label: "rail.signal.speed_warning" },
];

/** Purpose: the electrification of a mode in words ("overhead", "third rail"), else the engine's id. */
function electrification(t: Translate, id: string): string {
  const key = `rail.power.${id}`;
  return hasMessage(key) ? t(key).toLowerCase() : id.replace("_", " ");
}

/** Purpose: counts of the plan's signals by kind, for the panel. */
function signalSummary(tn: TranslatePlural, list: RailView["signals"]): string {
  const n = (k: SignalKind) => list.filter((s) => s.kind === k).length;
  const markers = list.filter((s) => !s.lineside).length;
  const parts = [
    tn("rail.count.main", n("main")),
    tn("rail.count.block", n("block") - markers),
    markers ? tn("rail.count.markers", markers) : "",
    n("shunting") ? tn("rail.count.shunting", n("shunting")) : "",
    n("distant") ? tn("rail.count.distant", n("distant")) : "",
    n("speed") ? tn("rail.count.speed", n("speed")) : "",
    n("speed_warning") ? tn("rail.count.speedWarning", n("speed_warning")) : "",
  ];
  return parts.filter(Boolean).join(" · ");
}

/** Purpose: the planner's changes to the generated signals in a sentence. */
function signalEdits(t: Translate, tn: TranslatePlural, view: RailView): string {
  const own = view.signals.filter((s) => !s.auto).length;
  const parts = [
    own ? tn("rail.edits.own", own) : "",
    view.signals_removed ? tn("rail.edits.removed", view.signals_removed) : "",
  ].filter(Boolean);
  return parts.length ? t("rail.edits", { list: parts.join(", ") }) : "";
}

/** Purpose: inspector of one signal: kind, name, direction it governs, delete. */
function SignalInspector({ sg, doc, view, actions: a }: Props & { sg: Signal }) {
  const { t } = useI18n();
  const set = (f: (x: Signal) => Signal) => a.setDoc(updateSignal(doc, sg.id, f, view.signals));
  const sv = view.signals.find((x) => x.id === sg.id);
  const notes = view.issues.filter((i) => i.ref_id === sg.id);
  const where =
    sg.at.type === "track"
      ? t("rail.signalOnTrack", { track: sg.at.track, at: fmtM(sg.at.s) })
      : sg.at.type === "station"
        ? t("rail.signalOnStation")
        : t("rail.signalOnSwitch");
  return (
    <Section title={sg.name || t(SIGNAL_KINDS.find((k) => k.id === sg.kind)!.label)}>
      <p className="text-xs text-slate-600">
        {where}
        {sv && !sv.lineside ? ` · ${t("rail.blockMarker")}` : ""}
        {!sv ? ` · ${t("rail.notOnTrack")}` : ""}
        {sv?.auto ? ` · ${t("rail.generated")}` : ` · ${t("rail.yours")}`}
      </p>
      {notes.map((i, k) => (
        <p
          key={k}
          className={`text-xs ${i.severity === "error" ? "text-red-700" : i.severity === "warning" ? "text-amber-700" : "text-slate-600"}`}
        >
          {i.text}
        </p>
      ))}
      <Row label={t("rail.kind")}>
        <select
          value={sg.kind}
          onChange={(e) => set((x) => ({ ...x, kind: e.target.value as SignalKind }))}
          className={input}
        >
          {SIGNAL_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {t(k.label)}
            </option>
          ))}
        </select>
      </Row>
      {(sg.kind === "speed" || sg.kind === "speed_warning") && (
        <Row label={t("rail.speedKmh")}>
          <input
            aria-label={t("rail.signalSpeed")}
            type="number"
            min={5}
            step={5}
            value={sg.speed_kmh ?? ""}
            onChange={(e) =>
              set((x) => ({ ...x, speed_kmh: e.target.value ? Number(e.target.value) : null }))
            }
            className={input}
          />
        </Row>
      )}
      <Row label={t("rail.name")}>
        <input
          aria-label={t("rail.signalName")}
          value={sg.name}
          onChange={(e) => set((x) => ({ ...x, name: e.target.value }))}
          className={input}
        />
      </Row>
      <button
        type="button"
        className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
        onClick={() => set((x) => ({ ...x, facing: x.facing === 1 ? -1 : 1 }))}
      >
        {t("rail.turnRound")}
      </button>
      <Remove what={t("rail.deleteSignal")} onClick={() => a.remove(sg.id)} />
    </Section>
  );
}

/** `what` is the whole button text, such as "Delete signal (Del)". */
function Remove({ onClick, what }: { onClick: () => void; what: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border border-red-300 px-2 py-1 text-red-700 hover:bg-red-50"
    >
      {what}
    </button>
  );
}

/**
 * Purpose: the railway system of a station or track. Systems are separate infrastructure in one
 * drawing; `null` follows the mode for new elements.
 */
function ModeRow({ value, onChange }: { value: RailMode; onChange: (m: RailMode) => void }) {
  const { t } = useI18n();
  return (
    <Row label={t("rail.system")}>
      <select
        aria-label={t("rail.system")}
        value={value}
        onChange={(e) => onChange(e.target.value as RailMode)}
        className={input}
      >
        {RAIL_MODES.map((m) => (
          <option key={m.id} value={m.id}>
            {t(m.label)}
          </option>
        ))}
      </select>
    </Row>
  );
}

function StationInspector({ st, doc, view, actions: a }: Props & { st: Station }) {
  const { t, tn } = useI18n();
  const sv = view.stations.find((s) => s.id === st.id);
  const set = (f: (s: Station) => Station) => a.setDoc(update(doc, "stations", st.id, f));
  return (
    <Section title={t("rail.station")}>
      <input
        aria-label={t("rail.stationName")}
        value={st.name}
        onChange={(e) => set((s) => ({ ...s, name: e.target.value }))}
        onBlur={(e) => a.renameStation(st.id, e.target.value)}
        className={field}
      />
      <ModeRow
        value={sv?.mode ?? st.mode ?? doc.mode}
        onChange={(m) => set((x) => ({ ...x, mode: m === doc.mode ? null : m }))}
      />
      {sv && (
        <p className="text-xs text-slate-600">
          {sv.layout} · {tn("rail.tracksCount", sv.tracks)} · {tn("rail.edges", sv.platform_edges)} ·{" "}
          {t("rail.box", { length: fmtM(sv.box_length_m), width: fmtM(sv.box_width_m) })}
        </p>
      )}
      {sv?.height && (
        <p className="text-xs text-slate-600">
          Level, rails at {sv.height.rail_m.toFixed(1)} m above sea level · ground along it{" "}
          {sv.height.ground_min_m.toFixed(1)}–{sv.height.ground_max_m.toFixed(1)} m
        </p>
      )}
      <Segmented
        label={t("rail.stationLevel")}
        value={st.level}
        options={levelOpts(t)}
        onChange={(level) => set((s) => ({ ...s, level }))}
      />
      <Row label={t("rail.sidePlatforms")}>
        <Num
          label={t("rail.sidePlatforms")}
          unit=""
          value={st.side_platforms}
          onChange={(v) => set((s) => ({ ...s, side_platforms: Math.min(2, Math.round(v)) }))}
        />
      </Row>
      <Row label={t("rail.islandPlatforms")}>
        <Num
          label={t("rail.islandPlatforms")}
          unit=""
          value={st.island_platforms}
          onChange={(v) => set((s) => ({ ...s, island_platforms: Math.min(4, Math.round(v)) }))}
        />
      </Row>
      <Row label={t("rail.platformLength")}>
        <Num
          label={t("rail.platformLength")}
          unit="m"
          min={20}
          value={st.platform_length_m}
          onChange={(v) => set((s) => ({ ...s, platform_length_m: v }))}
        />
      </Row>
      <Row label={t("rail.rotation")}>
        <Num
          label={t("rail.rotation")}
          unit="°"
          value={st.rotation_deg}
          onChange={(v) => set((s) => ({ ...s, rotation_deg: v % 360 }))}
        />
      </Row>
      <Remove what={t("rail.deleteStation")} onClick={() => a.remove(st.id)} />
    </Section>
  );
}

function TrackInspector({ t: track, doc, view, sel, actions: a }: Props & { t: Track }) {
  const { t: tr } = useI18n();
  const t = track;
  const tv = view.tracks.find((x) => x.id === t.id);
  const set = (f: (x: Track) => Track) => a.setDoc(update(doc, "tracks", t.id, f));
  const pi = sel?.pi !== undefined ? t.points[sel.pi] : undefined;
  return (
    <Section title={t.name || tr("rail.trackN", { id: t.id })}>
      <input
        aria-label={tr("rail.trackName")}
        placeholder={tr("rail.name")}
        value={t.name}
        onChange={(e) => set((x) => ({ ...x, name: e.target.value }))}
        className={field}
      />
      <ModeRow value={tv?.mode ?? t.mode ?? doc.mode} onChange={(m) => set((x) => ({ ...x, mode: m }))} />
      {tv && (
        <p className="text-xs text-slate-600">
          {fmtM(tv.length_m)} · {tv.tracks === 2 ? tr("rail.doubleTrack") : tr("rail.singleTrack")}
          {tv.speed &&
            ` · ${tr("rail.trackSpeed", { speed: Math.round(tv.speed.max_kmh), time: fmtTime(tv.speed.time_s) })}`}
        </p>
      )}
      <Segmented<1 | 2>
        label={tr("rail.tracks")}
        value={t.tracks}
        options={[
          { id: 1, label: tr("rail.single") },
          { id: 2, label: tr("rail.double") },
        ]}
        onChange={(tracks) => set((x) => ({ ...x, tracks }))}
      />
      <Segmented
        label={tr("rail.level")}
        value={t.level}
        options={levelOpts(tr)}
        onChange={(level) => set((x) => ({ ...x, level }))}
      />
      <Row label={tr("rail.electrification")}>
        <select
          value={t.power}
          onChange={(e) => set((x) => ({ ...x, power: e.target.value as Power }))}
          className={input}
        >
          {POWER.map((o) => (
            <option key={o.id} value={o.id}>
              {tr(o.label)}
            </option>
          ))}
        </select>
      </Row>
      <Row label={tr("rail.bed")}>
        <select
          value={t.bed}
          onChange={(e) => set((x) => ({ ...x, bed: e.target.value as Track["bed"] }))}
          className={input}
        >
          <option value="auto">{tr("rail.power.auto")}</option>
          <option value="ballast">{tr("rail.bed.ballast")}</option>
          <option value="embedded">{tr("rail.bed.embedded")}</option>
        </select>
      </Row>
      <Segmented<TrackUse>
        label={tr("rail.use")}
        value={t.use}
        options={[
          { id: "running", label: tr("rail.running") },
          { id: "storage", label: tr("rail.storage") },
        ]}
        onChange={(use) => set((x) => ({ ...x, use }))}
      />
      {pi && sel?.pi !== undefined && (
        <div className="flex flex-col gap-2 rounded border border-amber-300 bg-amber-50 p-2">
          <b>{tr("rail.pointN", { n: sel.pi + 1 })}</b>
          <Segmented
            label={tr("rail.pointLevel")}
            value={pi.level ?? t.level}
            options={levelOpts(tr)}
            onChange={(level) =>
              set((x) => ({ ...x, points: x.points.map((q, i) => (i === sel.pi ? { ...q, level } : q)) }))
            }
          />
          <Row label={tr("rail.radiusEmpty")}>
            <input
              type="number"
              aria-label={tr("rail.curveRadius")}
              value={pi.radius_m ?? ""}
              min={0}
              onChange={(e) => {
                const v = e.target.value === "" ? null : Math.max(1, Number(e.target.value));
                set((x) => ({
                  ...x,
                  points: x.points.map((q, i) => (i === sel.pi ? { ...q, radius_m: v } : q)),
                }));
              }}
              className="w-20 rounded border border-slate-300 px-1 py-0.5 text-end"
            />
          </Row>
          <button
            type="button"
            className="rounded border border-red-300 px-2 py-1 text-red-700"
            onClick={() => {
              set((x) => ({ ...x, points: x.points.filter((_, i) => i !== sel.pi) }));
              a.select({ id: t.id });
            }}
          >
            {tr("rail.removePoint")}
          </button>
        </div>
      )}
      {tv && tv.curves.length > 0 && (
        <table className="w-full text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="text-start">{tr("rail.curve")}</th>
              <th className="text-end">R</th>
              <th className="text-end">{tr("rail.transition")}</th>
              <th className="text-end">{tr("rail.cant")}</th>
              <th className="text-end">{tr("rail.speed")}</th>
            </tr>
          </thead>
          <tbody>
            {tv.curves.map((c, i) => (
              <tr
                key={i}
                className={c.pi !== null ? "cursor-pointer hover:bg-slate-100" : ""}
                onClick={() => c.pi !== null && a.select({ id: t.id, pi: c.pi })}
                style={{ color: c.radius_m < view.params.min_radius_m ? COLORS.error : undefined }}
              >
                <td>
                  {c.pi !== null
                    ? tr("rail.pointN", { n: c.pi + 1 })
                    : VERTEX[c.kind]
                      ? tr(VERTEX[c.kind]!)
                      : c.kind}
                </td>
                <td className="text-end font-mono">{Math.round(c.radius_m)} m</td>
                <td className="text-end font-mono">{Math.round(c.transition_m)} m</td>
                <td className="text-end font-mono">{Math.round(c.cant_mm)} mm</td>
                <td className="text-end font-mono">{Math.round(c.speed_kmh)} km/h</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {tv?.elevation && <ElevationProfile e={tv.elevation} />}
      {tv && tv.ramps.length > 0 && (
        <ul className="text-xs text-slate-600">
          {tv.ramps.map((r, i) => (
            <li key={i}>
              {tr("rail.ramp", {
                from: tr(LEVEL_LABEL[r.from]),
                to: tr(LEVEL_LABEL[r.to]),
                dh: r.dh_m.toFixed(1),
                length: fmtM(r.length_m),
              })}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-slate-500">{tr("rail.trackHint")}</p>
      <Remove what={tr("rail.deleteTrack")} onClick={() => a.remove(t.id)} />
    </Section>
  );
}

/**
 * Purpose: a track's vertical profile from the terrain: the ground and the rail top along the track,
 * with its height range and steepest gradient.
 */
function ElevationProfile({ e }: { e: TrackElevation }) {
  const pts = e.profile;
  if (pts.length < 2) return null;
  const len = pts[pts.length - 1]![0] || 1;
  const zs = pts.flatMap((p) => [p[1], p[2]]);
  const lo = Math.min(...zs);
  const hi = Math.max(...zs, lo + 1);
  const W = 260;
  const H = 70;
  const line = (k: 1 | 2) =>
    pts
      .map(
        (p, i) =>
          `${i ? "L" : "M"}${((p[0] / len) * W).toFixed(1)},${(H - ((p[k] - lo) / (hi - lo)) * H).toFixed(1)}`,
      )
      .join(" ");
  const steep = Math.abs(e.steepest_permille);
  return (
    <div className="space-y-1">
      <p className="text-xs text-slate-600">
        Rails {e.rail_min_m.toFixed(1)}–{e.rail_max_m.toFixed(1)} m above sea level · steepest{" "}
        <span className={steep > e.max_permille + 0.5 ? "font-semibold text-red-700" : undefined}>
          {steep.toFixed(1)} ‰
        </span>{" "}
        (max {e.max_permille} ‰)
      </p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[70px] w-full rounded bg-slate-50"
        role="img"
        aria-label="Vertical profile: ground and rail top along the track"
      >
        <path d={line(1)} fill="none" stroke="#a16207" strokeWidth={1} strokeDasharray="3 2" />
        <path d={line(2)} fill="none" stroke="#1e293b" strokeWidth={1.5} />
      </svg>
      <p className="text-[11px] text-slate-500">
        Solid: rail top. Dashed: ground (Copernicus GLO-30, smoothed). Heights from a surface model, ±4 m.
      </p>
    </div>
  );
}

function SwitchInspector({ sw, doc, view, actions: a }: Props & { sw: Switch }) {
  const { t } = useI18n();
  const sv = view.switches.find((x) => x.id === sw.id);
  const set = (f: (x: Switch) => Switch) => a.setDoc(update(doc, "switches", sw.id, f));
  return (
    <Section title={sv?.label ?? t("rail.switch")}>
      {sv && (
        <p className="text-xs text-slate-600">
          {t("rail.switchFacts", {
            length: fmtM(sv.length_m),
            ratio: sv.crossing_ratio_n,
            radius: Math.round(sv.radius_m),
            speed: Math.round(sv.diverging_speed_kmh),
            at: fmtM(sv.s0),
          })}
        </p>
      )}
      <Row label={t("rail.element")}>
        <select
          value={sw.element}
          onChange={(e) => set((x) => ({ ...x, element: e.target.value }))}
          className={input}
        >
          {view.turnouts.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t("rail.positionAlong")}>
        <Num
          label={t("rail.switchPosition")}
          unit="m"
          value={sw.s}
          onChange={(s) => set((x) => ({ ...x, s }))}
        />
      </Row>
      <div className="flex gap-2">
        <button
          type="button"
          className="flex-1 rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
          onClick={() => set((x) => ({ ...x, side: x.side === 1 ? -1 : 1 }))}
        >
          {t("rail.otherSide")}
        </button>
        <button
          type="button"
          className="flex-1 rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
          onClick={() => set((x) => ({ ...x, direction: x.direction === 1 ? -1 : 1 }))}
        >
          {t("rail.reverse")}
        </button>
        {sw.kind !== "turnout" && (
          <button
            type="button"
            className="flex-1 rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
            onClick={() => set((x) => ({ ...x, flip: !x.flip }))}
          >
            {t("rail.mirror")}
          </button>
        )}
      </div>
      <Remove what={t("rail.deleteSwitch")} onClick={() => a.remove(sw.id)} />
    </Section>
  );
}

/**
 * Purpose: the same-level crossings of two alignments. A diamond of two single tracks can be made a
 * single or double slip from the catalogue, so trains can also turn from one track to the other.
 */
function DiamondSection({
  doc,
  view,
  actions: a,
}: {
  doc: Network;
  view: RailView;
  actions: RailPanelActions;
}) {
  const { t } = useI18n();
  const diamonds = view.crossings.filter((c) => c.kind === "diamond");
  if (!diamonds.length) return null;
  const slips = doc.slips ?? [];
  const setSlip = (crossing: string, slip: Slip | null) =>
    a.setDoc({
      ...doc,
      slips: [...slips.filter((s) => s.crossing !== crossing), ...(slip ? [slip] : [])],
    });
  return (
    <Section title={`${t("rail.diamonds")} · ${diamonds.length}`}>
      <p className="text-xs text-slate-600">{t("rail.diamondsNote")}</p>
      <ul className="flex flex-col gap-2">
        {diamonds.map((c) => {
          const slip = slips.find((s) => s.crossing === c.id) ?? null;
          const built = view.slips.find((s) => s.crossing === c.id);
          const spec = view.slip_elements.find((e) => e.id === slip?.element);
          return (
            <li key={c.id} className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => a.showIssue(c.lonlat, c.tracks[0])}
                className="rounded px-1 py-0.5 text-start hover:bg-slate-100"
              >
                {t("rail.diamondTracks", {
                  a: c.tracks[0],
                  b: c.tracks[1],
                  angle: c.angle_deg.toFixed(1),
                  ratio: c.ratio_n.toFixed(1),
                })}
                {built ? (built.ok ? ` · ${t("rail.slipBuilt")}` : ` · ${t("rail.slipNotPossible")}`) : ""}
              </button>
              {c.single_tracks && (
                <label className="flex items-center gap-2 px-1 text-xs">
                  <span>{t("rail.trackwork")}</span>
                  <select
                    aria-label={t("rail.trackworkAt", { id: c.id })}
                    className="flex-1 rounded border border-slate-300 px-1 py-0.5"
                    value={slip?.element ?? ""}
                    onChange={(e) =>
                      setSlip(
                        c.id,
                        e.target.value ? { crossing: c.id, element: e.target.value, side: 0 } : null,
                      )
                    }
                  >
                    <option value="">{t("rail.diamond")}</option>
                    {view.slip_elements.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {slip && spec?.element === "single_slip" && (
                <button
                  type="button"
                  className="btn btn-ghost self-start px-1 text-xs"
                  onClick={() => setSlip(c.id, { ...slip, side: slip.side === 1 ? 0 : 1 })}
                >
                  {t("rail.turnSlip")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
