import { useI18n } from "../../i18n/i18n";
import { offeredModes, usePlannedModes } from "../../projects/plannedModes";
import { POWER, RAIL_MODES } from "./modes";
import { input, levelOpts, Row, Section } from "./panelControls";
import type { RailPanelProps as Props } from "./railPanelTypes";
import type { Network, Power, RailMode, Station, Track, TrackUse } from "./types";

/** Purpose: the one value all the items have, or `undefined` when they differ. */
export function shared<T, V>(items: readonly T[], get: (x: T) => V): V | undefined {
  if (!items.length) return undefined;
  const first = get(items[0]!);
  return items.every((x) => get(x) === first) ? first : undefined;
}

/** Purpose: the doc with `f` applied to every station or track whose id is in `ids`. */
export function updateAll<K extends "stations" | "tracks">(
  doc: Network,
  key: K,
  ids: readonly number[],
  f: (o: Network[K][number]) => Network[K][number],
): Network {
  const list = doc[key] as Network[K][number][];
  return { ...doc, [key]: list.map((o) => (ids.includes(o.id) ? f(o) : o)) };
}

/** Choice buttons where none is pressed while the selected items differ. */
function Choice<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | undefined;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-slate-600">{label}</span>
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
    </div>
  );
}

/** A list where an empty "different values" entry shows while the selected items differ. */
function Pick<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | undefined;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const { t } = useI18n();
  return (
    <Row label={label}>
      <select
        aria-label={label}
        value={value ?? ""}
        onChange={(e) => e.target.value && onChange(e.target.value as T)}
        className={input}
      >
        {value === undefined && <option value="">{t("rail.multi.mixed")}</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </Row>
  );
}

/** A number field left empty while the selected items differ; a typed number goes to all of them. */
function Amount({
  label,
  value,
  unit,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number | undefined;
  unit: string;
  min: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  const { t } = useI18n();
  return (
    <Row label={label}>
      <span className="flex items-center gap-1">
        <input
          type="number"
          aria-label={label}
          min={min}
          max={max}
          value={value === undefined ? "" : Math.round(value * 10) / 10}
          placeholder={t("rail.multi.mixedShort")}
          onChange={(e) => {
            if (e.target.value.trim() === "") return;
            const v = Number(e.target.value);
            if (!Number.isFinite(v)) return;
            onChange(Math.min(max ?? Infinity, Math.max(min, v)));
          }}
          className="w-20 rounded border border-slate-300 px-1 py-0.5 text-end"
        />
        <span className="w-7 text-slate-500">{unit}</span>
      </span>
    </Row>
  );
}

/**
 * Purpose: the settings several selected tracks share (Shift-click adds a track to the selection). A setting
 * shows its value when all the tracks have it, else nothing; a change applies to every selected track.
 */
export function MultiTrackInspector({ ids, doc, view, actions: a }: Props & { ids: readonly number[] }) {
  const { t } = useI18n();
  const planned = usePlannedModes();
  const tracks = doc.tracks.filter((x) => ids.includes(x.id));
  const set = (f: (x: Track) => Track) => a.setDoc(updateAll(doc, "tracks", ids, f));
  const mode = shared(tracks, (x) => view.tracks.find((v) => v.id === x.id)?.mode ?? x.mode ?? doc.mode);
  return (
    <Section title={t("rail.multi.tracks", { count: tracks.length })}>
      <p className="text-xs text-slate-600">{t("rail.multi.hint")}</p>
      <Pick<RailMode>
        label={t("rail.system")}
        value={mode}
        options={offeredModes(RAIL_MODES, (m) => m.id, planned, mode ?? doc.mode).map((m) => ({
          id: m.id,
          label: t(m.label),
        }))}
        onChange={(m) => set((x) => ({ ...x, mode: m }))}
      />
      <Choice<1 | 2>
        label={t("rail.tracks")}
        value={shared(tracks, (x) => x.tracks)}
        options={[
          { id: 1, label: t("rail.single") },
          { id: 2, label: t("rail.double") },
        ]}
        onChange={(n) => set((x) => ({ ...x, tracks: n }))}
      />
      <Choice
        label={t("rail.level")}
        value={shared(tracks, (x) => x.level)}
        options={levelOpts(t)}
        onChange={(level) => set((x) => ({ ...x, level }))}
      />
      <Pick<Power>
        label={t("rail.electrification")}
        value={shared(tracks, (x) => x.power)}
        options={POWER.map((o) => ({ id: o.id, label: t(o.label) }))}
        onChange={(power) => set((x) => ({ ...x, power }))}
      />
      <Pick<Track["bed"]>
        label={t("rail.bed")}
        value={shared(tracks, (x) => x.bed)}
        options={[
          { id: "auto", label: t("rail.power.auto") },
          { id: "ballast", label: t("rail.bed.ballast") },
          { id: "embedded", label: t("rail.bed.embedded") },
        ]}
        onChange={(bed) => set((x) => ({ ...x, bed }))}
      />
      <Choice<TrackUse>
        label={t("rail.use")}
        value={shared(tracks, (x) => x.use)}
        options={[
          { id: "running", label: t("rail.running") },
          { id: "storage", label: t("rail.storage") },
        ]}
        onChange={(use) => set((x) => ({ ...x, use }))}
      />
    </Section>
  );
}

/**
 * Purpose: the settings several selected stations share (Shift-click adds a station to the selection). A
 * setting shows its value when all the stations have it, else nothing; a change applies to every one.
 */
export function MultiStationInspector({ ids, doc, view, actions: a }: Props & { ids: readonly number[] }) {
  const { t } = useI18n();
  const planned = usePlannedModes();
  const stations = doc.stations.filter((x) => ids.includes(x.id));
  const set = (f: (x: Station) => Station) => a.setDoc(updateAll(doc, "stations", ids, f));
  const mode = shared(stations, (x) => view.stations.find((v) => v.id === x.id)?.mode ?? x.mode ?? doc.mode);
  return (
    <Section title={t("rail.multi.stations", { count: stations.length })}>
      <p className="text-xs text-slate-600">{t("rail.multi.hint")}</p>
      <Pick<RailMode>
        label={t("rail.system")}
        value={mode}
        options={offeredModes(RAIL_MODES, (m) => m.id, planned, mode ?? doc.mode).map((m) => ({
          id: m.id,
          label: t(m.label),
        }))}
        onChange={(m) => set((x) => ({ ...x, mode: m === doc.mode ? null : m }))}
      />
      <Choice
        label={t("rail.stationLevel")}
        value={shared(stations, (x) => x.level)}
        options={levelOpts(t)}
        onChange={(level) => set((x) => ({ ...x, level }))}
      />
      <Amount
        label={t("rail.sidePlatforms")}
        unit=""
        min={0}
        max={2}
        value={shared(stations, (x) => x.side_platforms)}
        // A station needs a platform: without an island, at least one side platform.
        onChange={(v) =>
          set((s) => ({ ...s, side_platforms: Math.max(s.island_platforms > 0 ? 0 : 1, Math.round(v)) }))
        }
      />
      <Amount
        label={t("rail.islandPlatforms")}
        unit=""
        min={0}
        max={3}
        value={shared(stations, (x) => x.island_platforms)}
        onChange={(v) =>
          set((s) => {
            const island = Math.round(v);
            return {
              ...s,
              island_platforms: island,
              side_platforms: island > 0 ? s.side_platforms : Math.max(1, s.side_platforms),
            };
          })
        }
      />
      <Amount
        label={t("rail.platformLength")}
        unit="m"
        min={20}
        value={shared(stations, (x) => x.platform_length_m)}
        onChange={(v) => set((s) => ({ ...s, platform_length_m: v }))}
      />
    </Section>
  );
}
