import { signalById, update, updateSignal } from "./doc";
import { COLORS, fmtM, fmtTime, LEVEL_LABEL, LEVELS, POWER, RAIL_MODES } from "./modes";
import type { Selection } from "./RailwayEditor";
import type {
  Level,
  LonLat,
  Network,
  Power,
  RailMode,
  RailView,
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
export type RailTool = "select" | "station" | "track" | "turnout" | "crossover" | "signal" | "pan";

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
  example: () => void;
  clear: () => void;
  showIssue: (at: LonLat | null, ref: number | null) => void;
  /** Rename a station and the stations next to it; a name used farther away gets a number. */
  renameStation: (id: number, name: string) => void;
  fit: () => void;
  downloadTopology: () => void;
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
}

const CHIP: Record<Severity, string> = {
  ok: COLORS.ok,
  info: COLORS.info,
  warning: COLORS.warn,
  error: COLORS.error,
};
const VERTEX: Record<string, string> = {
  leadstart: "Out of start",
  lead_start: "Out of start",
  leadend: "Into end",
  lead_end: "Into end",
};
const field = "rounded border border-slate-300 bg-slate-50 px-2 py-1";
const input = `${field} min-w-0 max-w-56`;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function Num({
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
        className="w-20 rounded border border-slate-300 px-1 py-0.5 text-right"
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

const LEVEL_OPTS = LEVELS.map((l) => ({ id: l.id, label: l.short }));

/**
 * Purpose: the railway side panel, laid out like the railways tab of the mockup: mode and its
 * design values, settings for new elements, the inspector for the selection, and live checks.
 */
export function RailPanel(props: Props) {
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
  const issues = view.issues;

  return (
    <div className="flex flex-col gap-3 p-4 text-sm">
      <h2 className="text-xl font-semibold">Railway</h2>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-slate-600">Mode for new stations and tracks</span>
        <select value={doc.mode} onChange={(e) => a.setMode(e.target.value as RailMode)} className={field}>
          {RAIL_MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-slate-600">
        Gauge {p.gauge_mm} mm · track centres {p.track_centre_m} m · min radius {p.min_radius_m} m
        (recommended {p.recommended_radius_m} m) · max gradient {p.max_gradient_permille} ‰ · design speed{" "}
        {p.design_speed_kmh} km/h · platforms {p.platform_length_m} m at {p.platform_height_mm} mm ·{" "}
        {String(p.electrification).replace("_", " ")}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Stat value={`${view.counts.route_km.toFixed(2)} km`} label="Route" />
        <Stat value={`${view.counts.track_km.toFixed(2)} km`} label="Track" />
        <Stat value={String(doc.stations.length)} label="Stations" />
        <Stat value={String(doc.switches.length)} label="Switches" />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={a.example}
          className="flex-1 rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
        >
          Example
        </button>
        <button
          type="button"
          onClick={a.fit}
          className="flex-1 rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
        >
          Zoom to all
        </button>
        <button
          type="button"
          onClick={a.clear}
          className="flex-1 rounded border border-slate-300 px-2 py-1 hover:bg-red-50"
        >
          Clear
        </button>
      </div>

      {tool === "station" && (
        <Section title="New station">
          <Segmented
            label="Station level"
            value={props.stationOpts.level}
            options={LEVEL_OPTS}
            onChange={(level) => a.setStationOpts({ ...props.stationOpts, level })}
          />
          <Row label="Side platforms">
            <Num
              label="Side platforms"
              unit=""
              value={props.stationOpts.sides}
              onChange={(sides) =>
                a.setStationOpts({ ...props.stationOpts, sides: Math.min(2, Math.round(sides)) })
              }
            />
          </Row>
          <Row label="Island platforms">
            <Num
              label="Island platforms"
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
        <Section title={draft ? "Drawing track" : "New track"}>
          <Segmented<1 | 2>
            label="Tracks"
            value={props.trackOpts.tracks}
            options={[
              { id: 1, label: "Single" },
              { id: 2, label: "Double" },
            ]}
            onChange={(tracks) => a.setTrackOpts({ ...props.trackOpts, tracks })}
          />
          <Segmented
            label="Level"
            value={props.trackOpts.level}
            options={LEVEL_OPTS}
            onChange={(level) => a.setTrackOpts({ ...props.trackOpts, level })}
          />
          <Row label="Electrification">
            <select
              value={props.trackOpts.power}
              onChange={(e) => a.setTrackOpts({ ...props.trackOpts, power: e.target.value as Power })}
              className={input}
            >
              {POWER.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </Row>
          <Segmented<TrackUse>
            label="Use"
            value={props.trackOpts.use}
            options={[
              { id: "running", label: "Running" },
              { id: "storage", label: "Storage" },
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
                Finish (Enter)
              </button>
              <button
                type="button"
                onClick={a.cancelDraft}
                className="flex-1 rounded border border-slate-300 px-2 py-1"
              >
                Cancel (Esc)
              </button>
            </div>
          )}
        </Section>
      )}

      {(tool === "turnout" || tool === "crossover") && (
        <Section title={tool === "turnout" ? "New turnout" : "New crossover"}>
          <Row label="Element">
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
              Double junction on double track
            </label>
          ) : (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={props.switchOpts.scissors}
                onChange={(e) => a.setSwitchOpts({ ...props.switchOpts, scissors: e.target.checked })}
              />
              Scissors crossover
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

      <Section title="Trains">
        <Row label={`Train length (${p.label})`}>
          <Num
            label="Train length"
            unit="m"
            value={view.train_length_m}
            onChange={(v) => a.setDoc({ ...doc, train_length_m: v || null })}
          />
        </Row>
      </Section>

      <Section title="Operations">
        <p className="text-xs text-slate-600">
          The track graph for timetables and train control: sections, allowed movements, switches, platform
          edges, crossings, level crossings and depot groups.
        </p>
        <button
          type="button"
          onClick={a.downloadTopology}
          disabled={view.tracks.length === 0}
          className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100 disabled:opacity-40"
        >
          Download track topology (JSON){view.counts.errors > 0 ? " · has errors" : ""}
        </button>
      </Section>

      <Section title={view.signals.length ? `Signals · ${view.signals.length}` : "Signals"}>
        <p className="text-xs text-slate-600">
          {view.signals.length
            ? `${signalSummary(view.signals)}. They are generated from the design and follow it as it changes. Click a signal to change or delete it, or use the Signal tool to add one; each change is checked.`
            : "Signals are generated from the design: at switches, crossings, platform ends and on plain line at line speed."}
        </p>
        {view.signals_edited && (
          <>
            <p className="text-xs text-slate-600">{signalEdits(view)}</p>
            <button
              type="button"
              onClick={a.resetSignals}
              className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
            >
              Reset to generated signals
            </button>
          </>
        )}
      </Section>

      {props.existingRailways && (
        <Section
          title={`Existing railways · ${view.existing_joins.length} join${view.existing_joins.length === 1 ? "" : "s"}`}
        >
          <p className="text-xs text-slate-600">
            Railways already built, from OpenStreetMap, drawn in purple under the design (
            {view.existing_count} loaded). Start or end a track on one and it joins it: the editor checks the
            gauge, the railway system and the power supply there.
          </p>
          <ul className="flex flex-col gap-1">
            {view.existing_joins.map((j) => (
              <li key={`${j.track}-${j.end}`}>
                <button
                  type="button"
                  onClick={() => a.showIssue(j.lonlat, j.track)}
                  className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-left hover:bg-slate-100"
                >
                  <span style={{ color: COLORS.existing }}>●</span>
                  <span>
                    {j.name || "Unnamed railway"} · {j.railway.replace("_", " ")} ·{" "}
                    {j.continues ? "continues the line" : "new turnout in the existing track"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <DiamondSection doc={props.doc} view={view} actions={a} />

      <Section title={`Street running · ${view.street_running.length}`}>
        <p className="text-xs text-slate-600">
          Where tram track in the street runs along a street. The tram keeps to the street&apos;s speed limit
          there. It needs its own lane, or it runs in the traffic and is held up by it.
        </p>
        <ul className="flex flex-col gap-1">
          {view.street_running.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => a.showIssue(r.lonlat, r.track)}
                className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-left hover:bg-slate-100"
              >
                <span style={{ color: r.running === "mixed" ? COLORS.warn : COLORS.info }}>
                  {r.running === "mixed" ? "▲" : "●"}
                </span>
                <span>
                  {r.street || "Unnamed street"} · {fmtM(r.length_m)} ·{" "}
                  {r.running === "reserved"
                    ? "own lane"
                    : r.running === "mixed"
                      ? "in traffic"
                      : "pedestrian zone"}{" "}
                  · {Math.round(r.speed_limit_kmh)} km/h
                  {r.bus ? " · buses" : ""}
                  {r.stops.length ? ` · ${r.stops.length} stop${r.stops.length > 1 ? "s" : ""}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={`Level crossings · ${view.level_crossings.length}`}>
        <p className="text-xs text-slate-600">
          Where street-level track crosses a street that buses, trolleybuses and other road vehicles use. The
          railway closes the street before each train; road vehicles wait at the stop lines.
        </p>
        {props.streetNote && <p className="text-xs text-amber-800">{props.streetNote}</p>}
        <ul className="flex flex-col gap-1">
          {view.level_crossings.map((x) => (
            <li key={x.id}>
              <button
                type="button"
                onClick={() => a.showIssue(x.lonlat, x.track)}
                className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-left hover:bg-slate-100"
              >
                <span style={{ color: x.standard ? COLORS.info : COLORS.warn }}>
                  {x.standard ? "●" : "▲"}
                </span>
                <span>
                  {x.street || "Unnamed street"} · {Math.round(x.angle_deg)}° ·{" "}
                  {x.protection === "barriers" ? "barriers" : "traffic signals"}
                  {x.bus ? " · buses" : ""}
                  {x.trolley_wire ? " · trolleybus wire" : ""}
                  {x.standard ? "" : " · special safety measures"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={`Checks · ${view.counts.errors} errors · ${view.counts.warnings} warnings`}>
        {props.error && <p className="text-red-700">{props.error}</p>}
        <ul className="flex flex-col gap-1">
          {issues.map((i, n) => (
            <li key={n}>
              <button
                type="button"
                disabled={!i.at && !i.ref_id}
                onClick={() => a.showIssue(i.at, i.ref_id)}
                className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-left hover:bg-slate-100 disabled:hover:bg-transparent"
              >
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={{ background: CHIP[i.severity] }}
                  aria-label={i.severity}
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

const SIGNAL_KINDS: { id: SignalKind; label: string }[] = [
  { id: "main", label: "Main signal" },
  { id: "block", label: "Block signal" },
  { id: "shunting", label: "Shunting signal" },
  { id: "distant", label: "Distant signal" },
];

/** Purpose: counts of the plan's signals by kind, for the panel. */
function signalSummary(list: RailView["signals"]): string {
  const n = (k: SignalKind) => list.filter((s) => s.kind === k).length;
  const markers = list.filter((s) => !s.lineside).length;
  const parts = [
    `${n("main")} main`,
    `${n("block") - markers} block`,
    markers ? `${markers} block markers (cab signalling)` : "",
    n("shunting") ? `${n("shunting")} shunting` : "",
    n("distant") ? `${n("distant")} distant` : "",
  ];
  return parts.filter(Boolean).join(" · ");
}

/** Purpose: the planner's changes to the generated signals in a sentence. */
function signalEdits(view: RailView): string {
  const own = view.signals.filter((s) => !s.auto).length;
  const parts = [
    own ? `${own} of yours` : "",
    view.signals_removed ? `${view.signals_removed} generated removed or replaced` : "",
  ].filter(Boolean);
  return parts.length ? `Your changes: ${parts.join(", ")}.` : "";
}

/** Purpose: inspector of one signal: kind, name, direction it governs, delete. */
function SignalInspector({ sg, doc, view, actions: a }: Props & { sg: Signal }) {
  const set = (f: (x: Signal) => Signal) => a.setDoc(updateSignal(doc, sg.id, f, view.signals));
  const sv = view.signals.find((x) => x.id === sg.id);
  const notes = view.issues.filter((i) => i.ref_id === sg.id);
  const where =
    sg.at.type === "track"
      ? `on track ${sg.at.track} at ${fmtM(sg.at.s)}`
      : sg.at.type === "station"
        ? `on a station track`
        : `on a switch leg`;
  return (
    <Section title={sg.name || SIGNAL_KINDS.find((k) => k.id === sg.kind)!.label}>
      <p className="text-xs text-slate-600">
        {where}
        {sv && !sv.lineside ? " · block marker (cab signalling)" : ""}
        {!sv ? " · no longer on a track" : ""}
        {sv?.auto ? " · generated from the design" : " · yours"}
      </p>
      {notes.map((i, k) => (
        <p
          key={k}
          className={`text-xs ${i.severity === "error" ? "text-red-700" : i.severity === "warning" ? "text-amber-700" : "text-slate-600"}`}
        >
          {i.text}
        </p>
      ))}
      <Row label="Kind">
        <select
          value={sg.kind}
          onChange={(e) => set((x) => ({ ...x, kind: e.target.value as SignalKind }))}
          className={input}
        >
          {SIGNAL_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Name">
        <input
          aria-label="Signal name"
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
        Turn round (F)
      </button>
      <Remove what="signal" onClick={() => a.remove(sg.id)} />
    </Section>
  );
}

function Remove({ onClick, what }: { onClick: () => void; what: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border border-red-300 px-2 py-1 text-red-700 hover:bg-red-50"
    >
      Delete {what} (Del)
    </button>
  );
}

/**
 * Purpose: the railway system of a station or track. Systems are separate infrastructure in one
 * drawing; `null` follows the mode for new elements.
 */
function ModeRow({ value, onChange }: { value: RailMode; onChange: (m: RailMode) => void }) {
  return (
    <Row label="Railway system">
      <select
        aria-label="Railway system"
        value={value}
        onChange={(e) => onChange(e.target.value as RailMode)}
        className={input}
      >
        {RAIL_MODES.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </Row>
  );
}

function StationInspector({ st, doc, view, actions: a }: Props & { st: Station }) {
  const sv = view.stations.find((s) => s.id === st.id);
  const set = (f: (s: Station) => Station) => a.setDoc(update(doc, "stations", st.id, f));
  return (
    <Section title="Station">
      <input
        aria-label="Station name"
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
          {sv.layout} · {sv.tracks} tracks · {sv.platform_edges} platform edges · box {fmtM(sv.box_length_m)}{" "}
          × {fmtM(sv.box_width_m)}
        </p>
      )}
      <Segmented
        label="Station level"
        value={st.level}
        options={LEVEL_OPTS}
        onChange={(level) => set((s) => ({ ...s, level }))}
      />
      <Row label="Side platforms">
        <Num
          label="Side platforms"
          unit=""
          value={st.side_platforms}
          onChange={(v) => set((s) => ({ ...s, side_platforms: Math.min(2, Math.round(v)) }))}
        />
      </Row>
      <Row label="Island platforms">
        <Num
          label="Island platforms"
          unit=""
          value={st.island_platforms}
          onChange={(v) => set((s) => ({ ...s, island_platforms: Math.min(4, Math.round(v)) }))}
        />
      </Row>
      <Row label="Platform length">
        <Num
          label="Platform length"
          unit="m"
          min={20}
          value={st.platform_length_m}
          onChange={(v) => set((s) => ({ ...s, platform_length_m: v }))}
        />
      </Row>
      <Row label="Rotation">
        <Num
          label="Rotation"
          unit="°"
          value={st.rotation_deg}
          onChange={(v) => set((s) => ({ ...s, rotation_deg: v % 360 }))}
        />
      </Row>
      <Remove what="station" onClick={() => a.remove(st.id)} />
    </Section>
  );
}

function TrackInspector({ t, doc, view, sel, actions: a }: Props & { t: Track }) {
  const tv = view.tracks.find((x) => x.id === t.id);
  const set = (f: (x: Track) => Track) => a.setDoc(update(doc, "tracks", t.id, f));
  const pi = sel?.pi !== undefined ? t.points[sel.pi] : undefined;
  return (
    <Section title={t.name || `Track ${t.id}`}>
      <input
        aria-label="Track name"
        placeholder="Name"
        value={t.name}
        onChange={(e) => set((x) => ({ ...x, name: e.target.value }))}
        className={field}
      />
      <ModeRow value={tv?.mode ?? t.mode ?? doc.mode} onChange={(m) => set((x) => ({ ...x, mode: m }))} />
      {tv && (
        <p className="text-xs text-slate-600">
          {fmtM(tv.length_m)} · {tv.tracks === 2 ? "double" : "single"} track
          {tv.speed &&
            ` · up to ${Math.round(tv.speed.max_kmh)} km/h · ${fmtTime(tv.speed.time_s)} end to end`}
        </p>
      )}
      <Segmented<1 | 2>
        label="Tracks"
        value={t.tracks}
        options={[
          { id: 1, label: "Single" },
          { id: 2, label: "Double" },
        ]}
        onChange={(tracks) => set((x) => ({ ...x, tracks }))}
      />
      <Segmented
        label="Level"
        value={t.level}
        options={LEVEL_OPTS}
        onChange={(level) => set((x) => ({ ...x, level }))}
      />
      <Row label="Electrification">
        <select
          value={t.power}
          onChange={(e) => set((x) => ({ ...x, power: e.target.value as Power }))}
          className={input}
        >
          {POWER.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Track bed">
        <select
          value={t.bed}
          onChange={(e) => set((x) => ({ ...x, bed: e.target.value as Track["bed"] }))}
          className={input}
        >
          <option value="auto">Mode default</option>
          <option value="ballast">Ballast</option>
          <option value="embedded">Embedded in street</option>
        </select>
      </Row>
      <Segmented<TrackUse>
        label="Use"
        value={t.use}
        options={[
          { id: "running", label: "Running" },
          { id: "storage", label: "Storage" },
        ]}
        onChange={(use) => set((x) => ({ ...x, use }))}
      />
      {pi && sel?.pi !== undefined && (
        <div className="flex flex-col gap-2 rounded border border-amber-300 bg-amber-50 p-2">
          <b>Point {sel.pi + 1}</b>
          <Segmented
            label="Point level"
            value={pi.level ?? t.level}
            options={LEVEL_OPTS}
            onChange={(level) =>
              set((x) => ({ ...x, points: x.points.map((q, i) => (i === sel.pi ? { ...q, level } : q)) }))
            }
          />
          <Row label="Radius (empty = largest that fits)">
            <input
              type="number"
              aria-label="Curve radius"
              value={pi.radius_m ?? ""}
              min={0}
              onChange={(e) => {
                const v = e.target.value === "" ? null : Math.max(1, Number(e.target.value));
                set((x) => ({
                  ...x,
                  points: x.points.map((q, i) => (i === sel.pi ? { ...q, radius_m: v } : q)),
                }));
              }}
              className="w-20 rounded border border-slate-300 px-1 py-0.5 text-right"
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
            Remove point
          </button>
        </div>
      )}
      {tv && tv.curves.length > 0 && (
        <table className="w-full text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="text-left">Curve</th>
              <th className="text-right">R</th>
              <th className="text-right">Transition</th>
              <th className="text-right">Cant</th>
              <th className="text-right">Speed</th>
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
                <td>{c.pi !== null ? `Point ${c.pi + 1}` : (VERTEX[c.kind] ?? c.kind)}</td>
                <td className="text-right font-mono">{Math.round(c.radius_m)} m</td>
                <td className="text-right font-mono">{Math.round(c.transition_m)} m</td>
                <td className="text-right font-mono">{Math.round(c.cant_mm)} mm</td>
                <td className="text-right font-mono">{Math.round(c.speed_kmh)} km/h</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {tv && tv.ramps.length > 0 && (
        <ul className="text-xs text-slate-600">
          {tv.ramps.map((r, i) => (
            <li key={i}>
              Ramp {LEVEL_LABEL[r.from]} → {LEVEL_LABEL[r.to]}: {r.dh_m.toFixed(1)} m over {fmtM(r.length_m)}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-slate-500">
        Click a point to edit it. Drag the square handles to change the straight out of a station or switch.
      </p>
      <Remove what="track" onClick={() => a.remove(t.id)} />
    </Section>
  );
}

function SwitchInspector({ sw, doc, view, actions: a }: Props & { sw: Switch }) {
  const sv = view.switches.find((x) => x.id === sw.id);
  const set = (f: (x: Switch) => Switch) => a.setDoc(update(doc, "switches", sw.id, f));
  return (
    <Section title={sv?.label ?? "Switch"}>
      {sv && (
        <p className="text-xs text-slate-600">
          {fmtM(sv.length_m)} long · 1:{sv.crossing_ratio_n} · R {Math.round(sv.radius_m)} m ·{" "}
          {Math.round(sv.diverging_speed_kmh)} km/h diverging · at {fmtM(sv.s0)}
        </p>
      )}
      <Row label="Element">
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
      <Row label="Position along track">
        <Num label="Switch position" unit="m" value={sw.s} onChange={(s) => set((x) => ({ ...x, s }))} />
      </Row>
      <div className="flex gap-2">
        <button
          type="button"
          className="flex-1 rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
          onClick={() => set((x) => ({ ...x, side: x.side === 1 ? -1 : 1 }))}
        >
          Other side
        </button>
        <button
          type="button"
          className="flex-1 rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
          onClick={() => set((x) => ({ ...x, direction: x.direction === 1 ? -1 : 1 }))}
        >
          Reverse
        </button>
        {sw.kind !== "turnout" && (
          <button
            type="button"
            className="flex-1 rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
            onClick={() => set((x) => ({ ...x, flip: !x.flip }))}
          >
            Mirror
          </button>
        )}
      </div>
      <Remove what="switch" onClick={() => a.remove(sw.id)} />
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
  const diamonds = view.crossings.filter((c) => c.kind === "diamond");
  if (!diamonds.length) return null;
  const slips = doc.slips ?? [];
  const setSlip = (crossing: string, slip: Slip | null) =>
    a.setDoc({
      ...doc,
      slips: [...slips.filter((s) => s.crossing !== crossing), ...(slip ? [slip] : [])],
    });
  return (
    <Section title={`Diamond crossings · ${diamonds.length}`}>
      <p className="text-xs text-slate-600">
        Where two tracks cross on one level. Between two single tracks crossing at the angle of a catalogue
        slip, the diamond can be a slip: trains can then also turn from one track to the other.
      </p>
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
                className="rounded px-1 py-0.5 text-left hover:bg-slate-100"
              >
                Tracks {c.tracks[0]} and {c.tracks[1]} · {c.angle_deg.toFixed(1)}° (1:{c.ratio_n.toFixed(1)})
                {built ? (built.ok ? " · slip built" : " · slip not possible here, see checks") : ""}
              </button>
              {c.single_tracks && (
                <label className="flex items-center gap-2 px-1 text-xs">
                  <span>Trackwork</span>
                  <select
                    aria-label={`Trackwork at crossing ${c.id}`}
                    className="flex-1 rounded border border-slate-300 px-1 py-0.5"
                    value={slip?.element ?? ""}
                    onChange={(e) =>
                      setSlip(
                        c.id,
                        e.target.value ? { crossing: c.id, element: e.target.value, side: 0 } : null,
                      )
                    }
                  >
                    <option value="">Diamond</option>
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
                  Turn the slip to the other side
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
