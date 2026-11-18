import { cleanFeatures, STATION_FEATURES, SymbolPicker } from "../stations/features";
import { useI18n } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/messages";
import { update, updateSignal } from "./doc";
import { fmtM } from "./modes";
import { field, input, levelOpts, ModeRow, Num, Remove, Row, Section, Segmented } from "./panelControls";
import type { RailPanelProps as Props } from "./railPanelTypes";
import type { Signal, SignalKind, Station, Switch } from "./types";

const SIGNAL_KINDS: { id: SignalKind; label: MessageKey }[] = [
  { id: "main", label: "rail.signal.main" },
  { id: "block", label: "rail.signal.block" },
  { id: "shunting", label: "rail.signal.shunting" },
  { id: "distant", label: "rail.signal.distant" },
  { id: "speed", label: "rail.signal.speed" },
  { id: "speed_warning", label: "rail.signal.speed_warning" },
];

/** Purpose: inspector of one signal: kind, name, direction it governs, delete. */
export function SignalInspector({ sg, doc, view, actions: a }: Props & { sg: Signal }) {
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

export function StationInspector({ st, doc, view, actions: a }: Props & { st: Station }) {
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
          {t("rail.levelHeight", {
            rail: sv.height.rail_m.toFixed(1),
            min: sv.height.ground_min_m.toFixed(1),
            max: sv.height.ground_max_m.toFixed(1),
          })}
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
          // A station needs a platform: without an island, at least one side platform.
          min={st.island_platforms > 0 ? 0 : 1}
          value={st.side_platforms}
          onChange={(v) =>
            set((s) => ({
              ...s,
              side_platforms: Math.max(s.island_platforms > 0 ? 0 : 1, Math.min(2, Math.round(v))),
            }))
          }
        />
      </Row>
      <Row label={t("rail.islandPlatforms")}>
        <Num
          label={t("rail.islandPlatforms")}
          unit=""
          value={st.island_platforms}
          onChange={(v) =>
            set((s) => {
              const island = Math.min(3, Math.round(v));
              // Taking the last island away leaves a side platform, never 0 + 0.
              return {
                ...s,
                island_platforms: island,
                side_platforms: island > 0 ? s.side_platforms : Math.max(1, s.side_platforms),
              };
            })
          }
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
          wrap={360}
          value={st.rotation_deg}
          onChange={(v) => set((s) => ({ ...s, rotation_deg: v }))}
        />
      </Row>
      <span className="text-slate-700">{t("station.features")}</span>
      <SymbolPicker
        options={STATION_FEATURES}
        value={cleanFeatures(st.features)}
        label={t("station.features")}
        onChange={(f) => set((s) => ({ ...s, features: f.length ? f : undefined }))}
        t={t}
      />
      <Remove what={t("rail.deleteStation")} onClick={() => a.remove(st.id)} />
    </Section>
  );
}

export function SwitchInspector({ sw, doc, view, actions: a }: Props & { sw: Switch }) {
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
      {(sw.kind === "crossover" || sw.kind === "scissors") && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={sw.kind === "scissors"}
            onChange={(e) => set((x) => ({ ...x, kind: e.target.checked ? "scissors" : "crossover" }))}
          />
          {t("rail.scissors")}
        </label>
      )}
      <Row label={t("rail.positionAlong")}>
        <Num
          label={t("rail.positionAlong")}
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
