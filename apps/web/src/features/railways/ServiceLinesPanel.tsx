import { useEffect, useState } from "react";
import { type Translate, useI18n } from "../../i18n/i18n";
import { fmtM, fmtTime } from "./modes";
import { Num, Row, Section } from "./RailPanel";
import {
  hhmm,
  lineMode,
  lineProblem,
  moveStop,
  parseHhmm,
  removeLine,
  trainById,
  trainsFor,
  updateLine,
} from "./serviceLines";
import { TimeDistanceGraph } from "./TimeDistanceGraph";
import type { LonLat, Network, RailView, ServiceLine, ServicePublication } from "./types";

/** The last publication, and whether the drawing changed since. */
export interface Publication {
  result: ServicePublication | null;
  error: string | null;
  stale: boolean;
}

interface Props {
  doc: Network;
  view: RailView;
  setDoc: (d: Network) => void;
  publication: Publication | null;
  publish: () => void;
  /** The line whose stops map clicks on stations add, if any. */
  picking: string | null;
  setPicking: (id: string | null) => void;
  newLine: () => void;
  show: (at: LonLat | null, ref: number | null) => void;
}

const field = "rounded border border-slate-300 bg-slate-50 px-2 py-1";

/** Purpose: "every 4 min, 8 min off-peak". */
function headways(t: Translate, l: ServiceLine): string {
  const f = (m: number) => `${Math.round(m * 10) / 10} min`;
  return l.peak_headway_min === l.offpeak_headway_min
    ? t("rail.line.every", { every: f(l.peak_headway_min) })
    : t("rail.line.everyPeak", { peak: f(l.peak_headway_min), offpeak: f(l.offpeak_headway_min) });
}

/**
 * Purpose: the service lines section of the railway panel. The planner adds a line, picks its stops
 * (from the list or by clicking stations on the map), its train from the vehicle catalogue and its
 * headways, then publishes: the timetable planner plans the day on the drawn track and the trains are
 * available in the journey planner.
 */
export function ServiceLinesPanel({
  doc,
  view,
  setDoc,
  publication,
  publish,
  picking,
  setPicking,
  newLine,
  show,
}: Props) {
  const { t, tn } = useI18n();
  const lines = doc.lines ?? [];
  const [open, setOpen] = useState<string | null>(null);
  const name = (id: number) => doc.stations.find((s) => s.id === id)?.name ?? t("rail.stationN", { id });
  const ready = lines.filter((l) => !lineProblem(doc, l));
  const report = (id: string) => publication?.result?.lines.find((r) => r.id === id) ?? null;
  const trips = publication?.result?.timetable.trips.length ?? 0;

  // The line whose stops are being picked on the map is the one open here.
  useEffect(() => {
    if (picking) setOpen(picking);
  }, [picking]);

  return (
    <Section title={`${t("rail.line.title")} · ${lines.length}`}>
      <p className="text-xs text-slate-600">{t("rail.line.intro")}</p>
      <ul className="flex flex-col gap-1">
        {lines.map((l) => {
          const r = report(l.id);
          const problem = lineProblem(doc, l);
          return (
            <li key={l.id} className="rounded border border-slate-200">
              <button
                type="button"
                aria-expanded={open === l.id}
                onClick={() => {
                  setOpen(open === l.id ? null : l.id);
                  if (picking && picking !== l.id) setPicking(null);
                }}
                className="flex w-full items-start gap-2 px-2 py-1.5 text-start hover:bg-slate-50"
              >
                <span
                  className="mt-0.5 rounded px-1.5 text-xs font-semibold text-white"
                  style={{ background: l.color }}
                >
                  {l.name || "—"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {l.stations.length >= 2
                      ? `${name(l.stations[0]!)} – ${name(l.stations[l.stations.length - 1]!)}`
                      : t("rail.line.noStops")}
                  </span>
                  <span className="block text-xs text-slate-600">
                    {problem ? t(problem) : `${tn("rail.stops", l.stations.length)} · ${headways(t, l)}`}
                    {r && !publication?.stale ? ` · ${tn("rail.line.trips", r.trips)}` : ""}
                  </span>
                </span>
              </button>
              {open === l.id && (
                <LineEditor
                  doc={doc}
                  view={view}
                  line={l}
                  set={(f) => setDoc(updateLine(doc, l.id, f))}
                  remove={() => {
                    setDoc(removeLine(doc, l.id));
                    setOpen(null);
                    if (picking === l.id) setPicking(null);
                  }}
                  picking={picking === l.id}
                  setPicking={(on) => setPicking(on ? l.id : null)}
                  show={show}
                  report={publication?.stale ? null : r}
                  published={publication?.stale ? null : (publication?.result ?? null)}
                />
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={newLine}
          className="flex-1 rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
        >
          {t("rail.line.new")}
        </button>
        <button
          type="button"
          onClick={publish}
          disabled={ready.length === 0 || view.counts.errors > 0}
          className="flex-1 rounded bg-emerald-800 px-2 py-1 text-white disabled:opacity-40"
        >
          {publication?.result && !publication.stale ? t("rail.line.publishAgain") : t("rail.line.publish")}
        </button>
      </div>
      {view.counts.errors > 0 && lines.length > 0 && (
        <p className="text-xs text-amber-800">{t("rail.line.fixFirst")}</p>
      )}
      {publication?.error && <p className="text-xs text-red-700">{publication.error}</p>}
      {publication?.result && (
        <p className="text-xs text-slate-600" data-testid="lines-published">
          {publication.stale
            ? t("rail.line.stale")
            : t("rail.line.published", {
                lines: tn("rail.line.lines", publication.result.lines.length),
                trips: tn("rail.line.trips", trips),
              })}
        </p>
      )}
      {publication?.result && !publication.stale && publication.result.notes.length > 0 && (
        <details className="text-xs text-slate-600">
          <summary>
            {t("rail.line.notes")} · {publication.result.notes.length}
          </summary>
          <ul className="list-disc ps-4">
            {publication.result.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}

function LineEditor({
  doc,
  view,
  line: l,
  set,
  remove,
  picking,
  setPicking,
  show,
  report,
  published,
}: {
  doc: Network;
  view: RailView;
  line: ServiceLine;
  set: (f: (l: ServiceLine) => ServiceLine) => void;
  remove: () => void;
  picking: boolean;
  setPicking: (on: boolean) => void;
  show: (at: LonLat | null, ref: number | null) => void;
  report: ServicePublication["lines"][number] | null;
  /** The publication the report comes from, for the time-distance graph. */
  published: ServicePublication | null;
}) {
  const { t, tn } = useI18n();
  const [graph, setGraph] = useState(false);
  const mode = lineMode(doc, l);
  const trains = trainsFor(mode);
  const train = trainById(l.vehicle);
  const name = (id: number) => doc.stations.find((s) => s.id === id)?.name ?? t("rail.stationN", { id });
  const lonlat = (id: number) => view.stations.find((s) => s.id === id)?.lonlat ?? null;
  const length = train ? train.length_m * l.units : 0;

  return (
    <div className="flex flex-col gap-2 border-t border-slate-200 p-2">
      <div className="flex gap-2">
        <input
          aria-label={t("rail.line.name")}
          value={l.name}
          onChange={(e) => set((x) => ({ ...x, name: e.target.value }))}
          className={`${field} min-w-0 flex-1`}
        />
        <input
          type="color"
          aria-label={t("rail.line.colour")}
          value={l.color}
          onChange={(e) => set((x) => ({ ...x, color: e.target.value }))}
          className="h-8 w-10 rounded border border-slate-300"
        />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-600">{t("rail.line.stops")}</span>
        <button
          type="button"
          aria-pressed={picking}
          onClick={() => setPicking(!picking)}
          className={`rounded border px-2 py-0.5 text-xs ${picking ? "border-emerald-800 bg-emerald-800 text-white" : "border-slate-300 hover:bg-slate-100"}`}
        >
          {picking ? t("common.done") : t("rail.line.addStops")}
        </button>
      </div>
      {picking && <p className="text-xs text-slate-600">{t("rail.line.pickHint")}</p>}
      <ol className="flex flex-col gap-0.5" aria-label={t("rail.line.stops")}>
        {l.stations.map((id, i) => (
          <li key={id} className="flex items-center gap-1">
            <span className="w-5 text-end text-xs text-slate-500">{i + 1}</span>
            <button
              type="button"
              onClick={() => show(lonlat(id), id)}
              className="min-w-0 flex-1 truncate rounded px-1 text-start hover:bg-slate-100"
            >
              {name(id)}
            </button>
            <button
              type="button"
              aria-label={t("rail.line.earlier", { name: name(id) })}
              disabled={i === 0}
              onClick={() => set((x) => moveStop(x, i, -1))}
              className="rounded px-1 text-slate-600 hover:bg-slate-100 disabled:opacity-30"
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={t("rail.line.later", { name: name(id) })}
              disabled={i === l.stations.length - 1}
              onClick={() => set((x) => moveStop(x, i, 1))}
              className="rounded px-1 text-slate-600 hover:bg-slate-100 disabled:opacity-30"
            >
              ↓
            </button>
            <button
              type="button"
              aria-label={t("rail.line.remove", { name: name(id) })}
              onClick={() => set((x) => ({ ...x, stations: x.stations.filter((s) => s !== id) }))}
              className="rounded px-1 text-red-700 hover:bg-red-50"
            >
              ×
            </button>
          </li>
        ))}
      </ol>
      <Row label={t("rail.line.train")}>
        <select
          aria-label={t("rail.line.train")}
          value={l.vehicle}
          onChange={(e) => set((x) => ({ ...x, vehicle: e.target.value }))}
          className={`${field} min-w-0 max-w-56`}
        >
          {!train && <option value="">{t("rail.line.chooseTrain")}</option>}
          {trains.map((tr) => (
            <option key={tr.id} value={tr.id}>
              {tr.name}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t("rail.line.units")}>
        <Num
          label={t("rail.line.units")}
          unit=""
          min={1}
          value={l.units}
          onChange={(v) => set((x) => ({ ...x, units: Math.max(1, Math.min(4, Math.round(v))) }))}
        />
      </Row>
      {train && (
        <p className="text-xs text-slate-600" data-testid="train-length">
          {t("rail.line.trainFacts", {
            length: fmtM(length),
            speed: Math.round(train.top_speed_kmh),
            places: Math.round(train.capacity * l.units),
          })}
        </p>
      )}

      <Row label={t("rail.line.first")}>
        <TimeInput
          label={t("rail.line.first")}
          value={l.first_min}
          onChange={(v) => set((x) => ({ ...x, first_min: v }))}
        />
      </Row>
      <Row label={t("rail.line.last")}>
        <TimeInput
          label={t("rail.line.last")}
          value={l.last_min}
          onChange={(v) => set((x) => ({ ...x, last_min: v }))}
        />
      </Row>
      <Row label={t("rail.line.everyPeaks")}>
        <Num
          label={t("rail.line.peakHeadway")}
          unit="min"
          min={1}
          step={0.5}
          value={l.peak_headway_min}
          onChange={(v) => set((x) => ({ ...x, peak_headway_min: v }))}
        />
      </Row>
      <Row label={t("rail.line.everyOffpeak")}>
        <Num
          label={t("rail.line.offpeakHeadway")}
          unit="min"
          min={1}
          step={0.5}
          value={l.offpeak_headway_min}
          onChange={(v) => set((x) => ({ ...x, offpeak_headway_min: v }))}
        />
      </Row>
      <p className="text-xs text-slate-500">{t("rail.line.peaks")}</p>

      {report && (
        <div className="rounded bg-slate-100 p-2 text-xs" data-testid="line-report">
          <p>
            {tn("rail.line.trips", report.trips)} · {tn("rail.line.trains", report.trains)}
            {report.outbound_s !== null && l.stations.length >= 2
              ? ` · ${name(l.stations[0]!)} → ${name(l.stations[l.stations.length - 1]!)} ${fmtTime(report.outbound_s)}`
              : ""}
          </p>
          {report.issues.length > 0 && (
            <ul className="mt-1 list-disc ps-4 text-amber-800">
              {report.issues.map((text, i) => (
                <li key={i}>{text}</li>
              ))}
            </ul>
          )}
          {published && report.trips > 0 && (
            <button
              type="button"
              onClick={() => setGraph(true)}
              className="mt-1.5 rounded border border-slate-300 bg-white px-2 py-0.5 hover:bg-slate-50"
            >
              {t("rail.tdg.open")}
            </button>
          )}
        </div>
      )}
      {graph && published && (
        <TimeDistanceGraph
          publication={published}
          lineId={l.id}
          lineName={l.name || l.id}
          onClose={() => setGraph(false)}
        />
      )}

      <button
        type="button"
        onClick={remove}
        className="rounded border border-red-300 px-2 py-1 text-red-700 hover:bg-red-50"
      >
        {t("rail.line.delete")}
      </button>
    </div>
  );
}

/** Purpose: an "HH:MM" field that keeps what is typed until it is a valid time. */
function TimeInput({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      aria-label={label}
      inputMode="numeric"
      value={text ?? hhmm(value)}
      onChange={(e) => {
        setText(e.target.value);
        const v = parseHhmm(e.target.value);
        if (v !== null) onChange(v);
      }}
      onBlur={() => setText(null)}
      className="w-20 rounded border border-slate-300 px-1 py-0.5 text-end"
    />
  );
}
