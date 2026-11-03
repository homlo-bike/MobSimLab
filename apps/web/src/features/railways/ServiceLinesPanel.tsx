import { useState } from "react";
import { fmtM, fmtTime } from "./modes";
import { Num, Row, Section } from "./RailPanel";
import {
  addLine,
  hhmm,
  insertStop,
  lineMode,
  lineProblem,
  moveStop,
  parseHhmm,
  removeLine,
  trainById,
  trainsFor,
  updateLine,
} from "./serviceLines";
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
  show: (at: LonLat | null, ref: number | null) => void;
}

const field = "rounded border border-slate-300 bg-slate-50 px-2 py-1";

/** Purpose: "every 4 min, 8 min off-peak". */
function headways(l: ServiceLine): string {
  const f = (m: number) => `${Math.round(m * 10) / 10} min`;
  return l.peak_headway_min === l.offpeak_headway_min
    ? `every ${f(l.peak_headway_min)}`
    : `every ${f(l.peak_headway_min)} in the peaks, ${f(l.offpeak_headway_min)} off-peak`;
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
  show,
}: Props) {
  const lines = doc.lines ?? [];
  const [open, setOpen] = useState<string | null>(null);
  const name = (id: number) => doc.stations.find((s) => s.id === id)?.name ?? `Station ${id}`;
  const ready = lines.filter((l) => !lineProblem(doc, l));
  const report = (id: string) => publication?.result?.lines.find((r) => r.id === id) ?? null;
  const trips = publication?.result?.timetable.trips.length ?? 0;

  const add = () => {
    const [d, id] = addLine(doc, view.train_length_m);
    setDoc(d);
    setOpen(id);
    setPicking(null);
  };

  return (
    <Section title={`Service lines · ${lines.length}`}>
      <p className="text-xs text-slate-600">
        The lines trains run on this track: their stops, train and headways. Publish to plan the day&apos;s
        timetable on the drawn track and ride the trains in the journey planner.
      </p>
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
                className="flex w-full items-start gap-2 px-2 py-1.5 text-left hover:bg-slate-50"
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
                      : "No stops yet"}
                  </span>
                  <span className="block text-xs text-slate-600">
                    {problem ?? `${l.stations.length} stops · ${headways(l)}`}
                    {r && !publication?.stale ? ` · ${r.trips} trips` : ""}
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
                />
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={add}
          className="flex-1 rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
        >
          New line
        </button>
        <button
          type="button"
          onClick={publish}
          disabled={ready.length === 0 || view.counts.errors > 0}
          className="flex-1 rounded bg-emerald-800 px-2 py-1 text-white disabled:opacity-40"
        >
          {publication?.result && !publication.stale ? "Publish again" : "Publish timetable"}
        </button>
      </div>
      {view.counts.errors > 0 && lines.length > 0 && (
        <p className="text-xs text-amber-800">Fix the errors under Checks before publishing.</p>
      )}
      {publication?.error && <p className="text-xs text-red-700">{publication.error}</p>}
      {publication?.result && (
        <p className="text-xs text-slate-600" data-testid="lines-published">
          {publication.stale
            ? "The drawing changed since publishing. Publish again to update the journey planner."
            : `Published ${publication.result.lines.length} line${publication.result.lines.length === 1 ? "" : "s"} · ${trips} trips. Ride them in Simulator → Journey planner.`}
        </p>
      )}
      {publication?.result && !publication.stale && publication.result.notes.length > 0 && (
        <details className="text-xs text-slate-600">
          <summary>Notes · {publication.result.notes.length}</summary>
          <ul className="list-disc pl-4">
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
}) {
  const mode = lineMode(doc, l);
  const trains = trainsFor(mode);
  const train = trainById(l.vehicle);
  const free = doc.stations.filter((s) => !l.stations.includes(s.id));
  const name = (id: number) => doc.stations.find((s) => s.id === id)?.name ?? `Station ${id}`;
  const lonlat = (id: number) => view.stations.find((s) => s.id === id)?.lonlat ?? null;
  const length = train ? train.length_m * l.units : 0;
  const tooLong = train !== null && length > view.train_length_m + 0.5;

  return (
    <div className="flex flex-col gap-2 border-t border-slate-200 p-2">
      <div className="flex gap-2">
        <input
          aria-label="Line name"
          value={l.name}
          onChange={(e) => set((x) => ({ ...x, name: e.target.value }))}
          className={`${field} min-w-0 flex-1`}
        />
        <input
          type="color"
          aria-label="Line colour"
          value={l.color}
          onChange={(e) => set((x) => ({ ...x, color: e.target.value }))}
          className="h-8 w-10 rounded border border-slate-300"
        />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-600">Stops</span>
        <button
          type="button"
          aria-pressed={picking}
          onClick={() => setPicking(!picking)}
          className={`rounded border px-2 py-0.5 text-xs ${picking ? "border-emerald-800 bg-emerald-800 text-white" : "border-slate-300 hover:bg-slate-100"}`}
        >
          {picking ? "Done picking" : "Pick on the map"}
        </button>
      </div>
      {picking && (
        <p className="text-xs text-slate-600">
          Click stations on the map to add or remove them. A new stop goes where it fits along the line.
        </p>
      )}
      <ol className="flex flex-col gap-0.5" aria-label="Stops">
        {l.stations.map((id, i) => (
          <li key={id} className="flex items-center gap-1">
            <span className="w-5 text-right text-xs text-slate-500">{i + 1}</span>
            <button
              type="button"
              onClick={() => show(lonlat(id), id)}
              className="min-w-0 flex-1 truncate rounded px-1 text-left hover:bg-slate-100"
            >
              {name(id)}
            </button>
            <button
              type="button"
              aria-label={`Move ${name(id)} earlier`}
              disabled={i === 0}
              onClick={() => set((x) => moveStop(x, i, -1))}
              className="rounded px-1 text-slate-600 hover:bg-slate-100 disabled:opacity-30"
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={`Move ${name(id)} later`}
              disabled={i === l.stations.length - 1}
              onClick={() => set((x) => moveStop(x, i, 1))}
              className="rounded px-1 text-slate-600 hover:bg-slate-100 disabled:opacity-30"
            >
              ↓
            </button>
            <button
              type="button"
              aria-label={`Remove ${name(id)}`}
              onClick={() => set((x) => ({ ...x, stations: x.stations.filter((s) => s !== id) }))}
              className="rounded px-1 text-red-700 hover:bg-red-50"
            >
              ×
            </button>
          </li>
        ))}
      </ol>
      {free.length > 0 && (
        <select
          aria-label="Add stop"
          value=""
          onChange={(e) => {
            const id = Number(e.target.value);
            if (id) set((x) => insertStop(doc, x, id));
          }}
          className={field}
        >
          <option value="">Add stop…</option>
          {free.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}

      <Row label="Train">
        <select
          aria-label="Train"
          value={l.vehicle}
          onChange={(e) => set((x) => ({ ...x, vehicle: e.target.value }))}
          className={`${field} min-w-0 max-w-56`}
        >
          {!train && <option value="">Choose a train…</option>}
          {trains.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Units coupled">
        <Num
          label="Units coupled"
          unit=""
          min={1}
          value={l.units}
          onChange={(v) => set((x) => ({ ...x, units: Math.max(1, Math.min(4, Math.round(v))) }))}
        />
      </Row>
      {train && (
        <p className={`text-xs ${tooLong ? "text-amber-800" : "text-slate-600"}`}>
          {fmtM(length)} · {Math.round(train.top_speed_kmh)} km/h · {Math.round(train.capacity * l.units)}{" "}
          places
          {tooLong ? ` · longer than the ${fmtM(view.train_length_m)} the platforms take` : ""}
        </p>
      )}

      <Row label="First departure">
        <TimeInput
          label="First departure"
          value={l.first_min}
          onChange={(v) => set((x) => ({ ...x, first_min: v }))}
        />
      </Row>
      <Row label="Last departure">
        <TimeInput
          label="Last departure"
          value={l.last_min}
          onChange={(v) => set((x) => ({ ...x, last_min: v }))}
        />
      </Row>
      <Row label="Every, in the peaks">
        <Num
          label="Peak headway"
          unit="min"
          min={1}
          step={0.5}
          value={l.peak_headway_min}
          onChange={(v) => set((x) => ({ ...x, peak_headway_min: v }))}
        />
      </Row>
      <Row label="Every, off-peak">
        <Num
          label="Off-peak headway"
          unit="min"
          min={1}
          step={0.5}
          value={l.offpeak_headway_min}
          onChange={(v) => set((x) => ({ ...x, offpeak_headway_min: v }))}
        />
      </Row>
      <p className="text-xs text-slate-500">Peaks 07:00–09:00 and 16:00–19:00.</p>

      {report && (
        <div className="rounded bg-slate-100 p-2 text-xs" data-testid="line-report">
          <p>
            {report.trips} trips · {report.trains} train{report.trains === 1 ? "" : "s"}
            {report.outbound_s !== null && l.stations.length >= 2
              ? ` · ${name(l.stations[0]!)} → ${name(l.stations[l.stations.length - 1]!)} ${fmtTime(report.outbound_s)}`
              : ""}
          </p>
          {report.issues.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-amber-800">
              {report.issues.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={remove}
        className="rounded border border-red-300 px-2 py-1 text-red-700 hover:bg-red-50"
      >
        Delete line
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
      className="w-20 rounded border border-slate-300 px-1 py-0.5 text-right"
    />
  );
}
