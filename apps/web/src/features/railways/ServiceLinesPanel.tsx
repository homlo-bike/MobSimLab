import { useEffect, useState } from "react";
import { CommentBadge, ObjectComments } from "../comments/Comments";
import { type Translate, useI18n } from "../../i18n/i18n";
import { fmtM, fmtTime } from "./modes";
import { DayTypeChoice } from "../timetables/DayTypeChoice";
import { type DayService, editDay, hasOwnDay, railWeekday, shownDay, withDay } from "../timetables/dayTypes";
import { type DayTypeId, serviceDayFor, type ServiceCalendar } from "../../workspace/calendar";
import { Num, Row, Section } from "./panelControls";
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
import {
  type Access,
  type Grade,
  type StopAccess,
  accessRules,
  gradeGap,
  gradeStep,
  lineAccess,
} from "./platformAccess";
import { usedVehicles } from "../../workspace/preferences";
import { useVehiclesOff } from "../../workspace/projectVehicles";
import type { CatalogueTrain, LonLat, Network, RailView, ServiceLine, ServicePublication } from "./types";

/** The last publication, and whether the drawing changed since. */
export interface Publication {
  result: ServicePublication | null;
  /** The publication of every day type with lines (weekday is `result`). */
  byDay?: Partial<Record<DayTypeId, ServicePublication>>;
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
  /** The project's design rules (Project preferences) as `<mode>.<field>`; the library's when absent. */
  designValues?: Readonly<Record<string, number>> | null;
  /** The project calendar (peak windows of each day type); the default calendar when absent. */
  calendar?: ServiceCalendar;
}

/** The default calendar (its day types' usual peaks). */
const NO_CALENDAR: ServiceCalendar = {};

/** Purpose: a time of day from seconds after midnight, such as 07:00. */
const clock = (s: number) =>
  `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.round((s % 3600) / 60)).padStart(2, "0")}`;

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
  show,
  designValues = null,
  calendar = NO_CALENDAR,
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
                <CommentBadge type="service-line" id={l.id} />
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
                  designValues={designValues}
                  publication={publication?.stale ? null : publication}
                  calendar={calendar}
                />
              )}
              {open === l.id && (
                <div className="px-2 pb-2">
                  <ObjectComments type="service-line" id={l.id} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {/* New lines are made with the "Create service line" tool in the tool palette. */}
      <div className="flex gap-2">
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
  designValues,
  publication,
  calendar,
}: {
  doc: Network;
  view: RailView;
  line: ServiceLine;
  set: (f: (l: ServiceLine) => ServiceLine) => void;
  remove: () => void;
  picking: boolean;
  setPicking: (on: boolean) => void;
  show: (at: LonLat | null, ref: number | null) => void;
  designValues: Readonly<Record<string, number>> | null;
  /** The last publication (null while stale): the report and graph show the chosen day type's. */
  publication: Publication | null;
  calendar: ServiceCalendar;
}) {
  const { t, tn } = useI18n();
  const [graph, setGraph] = useState(false);
  const mode = lineMode(doc, l);
  const vehiclesOff = useVehiclesOff();
  const trains = usedVehicles(trainsFor(mode), vehiclesOff, l.vehicle);
  const train = trainById(l.vehicle);
  const name = (id: number) => doc.stations.find((s) => s.id === id)?.name ?? t("rail.stationN", { id });
  const lonlat = (id: number) => view.stations.find((s) => s.id === id)?.lonlat ?? null;
  const length = train ? train.length_m * l.units : 0;
  // The day type whose times and headways the fields show and change.
  const [day, setDay] = useState<DayTypeId>("weekday");
  const shown = shownDay(railWeekday(l), l.days, day);
  const published = (day === "weekday" ? publication?.result : publication?.byDay?.[day]) ?? null;
  const report = published?.lines.find((r) => r.id === l.id) ?? null;
  const peaks = serviceDayFor(calendar, day)
    .peaks.map(([a, b]) => `${clock(a)}–${clock(b)}`)
    .join(", ");
  const setDayService = (patch: Partial<DayService>) =>
    set((x) => {
      const next = editDay(railWeekday(x), x.days, day, patch);
      return {
        ...x,
        first_min: next.weekday.firstMin,
        last_min: next.weekday.lastMin,
        peak_headway_min: next.weekday.peakHeadwayMin,
        offpeak_headway_min: next.weekday.offPeakHeadwayMin,
        days: next.days,
      };
    });

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

      {train && l.stations.length > 0 && (
        <PlatformAccess
          doc={doc}
          line={l}
          train={train}
          designValues={designValues}
          show={(id) => show(lonlat(id), id)}
        />
      )}

      <DayTypeChoice
        day={day}
        onDay={setDay}
        own={hasOwnDay(l.days, day)}
        onOwn={(own) =>
          day !== "weekday" && set((x) => ({ ...x, days: withDay(x.days, day, own ? shown : null) }))
        }
      />
      <Row label={t("rail.line.first")}>
        <TimeInput
          label={t("rail.line.first")}
          value={shown.firstMin}
          onChange={(v) => setDayService({ firstMin: v })}
        />
      </Row>
      <Row label={t("rail.line.last")}>
        <TimeInput
          label={t("rail.line.last")}
          value={shown.lastMin}
          onChange={(v) => setDayService({ lastMin: v })}
        />
      </Row>
      <Row label={t("rail.line.everyPeaks")}>
        <Num
          label={t("rail.line.peakHeadway")}
          unit="min"
          min={1}
          step={0.5}
          value={shown.peakHeadwayMin}
          onChange={(v) => setDayService({ peakHeadwayMin: v })}
        />
      </Row>
      <Row label={t("rail.line.everyOffpeak")}>
        <Num
          label={t("rail.line.offpeakHeadway")}
          unit="min"
          min={1}
          step={0.5}
          value={shown.offPeakHeadwayMin}
          onChange={(v) => setDayService({ offPeakHeadwayMin: v })}
        />
      </Row>
      <p className="text-xs text-slate-500">{peaks && t("rail.line.peaks", { peaks })}</p>

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

const ACCESS_STYLE: Record<Access, string> = {
  level: "bg-emerald-100 text-emerald-900",
  step: "bg-sky-100 text-sky-900",
  aid: "bg-amber-100 text-amber-900",
  clash: "bg-red-100 text-red-900",
};

/** Purpose: "+20 mm" / "−150 mm" (a signed step: positive is up into the train). */
const signedMm = (mm: number) => `${mm > 0 ? "+" : mm < 0 ? "−" : "±"}${Math.abs(Math.round(mm))} mm`;

const ACCESS_FILL: Record<Access, string> = {
  level: "#047857",
  step: "#0369a1",
  aid: "#b45309",
  clash: "#b91c1c",
};

/**
 * Purpose: the platform access check of a line (TSI PRM step and gap, platform length), against the limits in
 * Project preferences. Stops that board the same way share one cross-section of platform and train, with the
 * step and the gap measured on it and checked against their limits. A train without a floor height in the
 * catalogue is drawn at the mode's default floor height, marked as assumed.
 */
function PlatformAccess({
  doc,
  line,
  train,
  designValues,
  show,
}: {
  doc: Network;
  line: ServiceLine;
  train: CatalogueTrain;
  designValues: Readonly<Record<string, number>> | null;
  show: (station: number) => void;
}) {
  const { t } = useI18n();
  const stops = lineAccess(doc, line, train, (m) => accessRules(designValues, m));
  if (stops.length === 0) return null;
  // Stops with the same platform, floor and gap look the same: one drawing for each such group.
  const groups = new Map<string, StopAccess[]>();
  for (const s of stops) {
    const k = `${s.platform_height_mm}|${s.floor_height_mm}|${s.horizontal_mm}|${JSON.stringify(s.rules)}`;
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  return (
    <div className="flex flex-col gap-2" data-testid="platform-access">
      <p className="text-xs font-semibold text-slate-700">{t("rail.access.title")}</p>
      {[...groups.values()].map((g) => {
        const s = g[0]!;
        return (
          <div key={s.station} className="rounded border border-slate-200 p-2 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`rounded px-1.5 py-0.5 font-semibold ${ACCESS_STYLE[s.access]}`}>
                {t(`rail.access.${s.access}`)}
              </span>
              {g.map((x) => (
                <button
                  key={x.station}
                  type="button"
                  onClick={() => show(x.station)}
                  className="rounded px-0.5 text-slate-800 underline decoration-slate-300 hover:bg-slate-100"
                >
                  {x.name}
                </button>
              ))}
            </div>
            <CrossSection stop={s} />
            <Measure
              label={t("rail.access.stepLabel")}
              value={signedMm(s.vertical_mm)}
              grade={gradeStep(s.vertical_mm, s.rules)}
              limit={t("rail.access.limits", {
                level: `±${s.rules.level_gap_vertical_mm}`,
                step: `+${s.rules.step_above_platform_mm} / −${s.rules.step_below_platform_mm}`,
              })}
            />
            {s.horizontal_mm !== null && (
              <Measure
                label={t("rail.access.gapLabel")}
                value={`${Math.round(s.horizontal_mm)} mm`}
                grade={gradeGap(s.horizontal_mm, s.rules)}
                limit={t("rail.access.limits", {
                  level: `${s.rules.level_gap_horizontal_mm}`,
                  step: `${s.rules.step_gap_horizontal_mm}`,
                })}
              />
            )}
            {s.floor_assumed && (
              <p className="mt-1 text-amber-800" data-testid="floor-assumed">
                ⚠ {t("rail.access.floorAssumedShort", { value: s.floor_height_mm })}
              </p>
            )}
            {g
              .filter((x) => x.platform_length_m < x.needed_length_m)
              .map((x) => (
                <p key={x.station} className="mt-1 text-red-800">
                  ✗{" "}
                  {t("rail.access.shortAt", {
                    name: x.name,
                    platform: fmtM(x.platform_length_m),
                    needed: fmtM(x.needed_length_m),
                  })}
                </p>
              ))}
          </div>
        );
      })}
    </div>
  );
}

const GRADE_MARK: Record<Grade, [string, string]> = {
  level: ["✓", "text-emerald-700"],
  step: ["✓", "text-sky-700"],
  over: ["✗", "text-red-700"],
};
const GRADE_HEX: Record<Grade, string> = { level: "#047857", step: "#0369a1", over: "#b91c1c" };

/** Purpose: one measure, whether it meets the level-access or the step limit (or neither), and the limits. */
function Measure({
  label,
  value,
  grade,
  limit,
}: {
  label: string;
  value: string;
  grade: Grade;
  limit: string;
}) {
  const { t } = useI18n();
  const [mark, colour] = GRADE_MARK[grade];
  return (
    <div className="mt-1 grid grid-cols-[3rem_4.5rem_1fr] items-baseline gap-x-1.5">
      <span className="text-slate-600">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
      <span className={colour}>
        <span className="font-bold">{mark}</span> {grade === "over" ? limit : t(`rail.access.${grade}`)}
      </span>
    </div>
  );
}

/**
 * Purpose: a true-to-scale cross-section at the door: the rail, the platform at its height, the train's floor at
 * its height and the gap between the platform edge and the train, with the platform height, the floor height,
 * the step and the gap labelled.
 */
function CrossSection({ stop: s }: { stop: StopAccess }) {
  const { t } = useI18n();
  const W = 320;
  const mm = 90 / 1400; // px per mm, heights true to scale
  const body = 44; // drawn height of the car body above its floor, px
  const H = Math.round(body + 16 + Math.max(s.platform_height_mm, s.floor_height_mm, 400) * mm + 20);
  const base = H - 14; // rail top
  const y = (h: number) => base - Math.max(0, h) * mm;
  const edge = 120; // platform edge, px
  const gapMm = s.horizontal_mm ?? 0;
  const gapPx = Math.max(0, Math.min(70, gapMm * 0.2)); // 5 mm per px, clamped
  const left = edge + (gapMm < 0 ? gapMm * 0.2 : gapPx); // the train's side
  const pTop = y(s.platform_height_mm);
  const fTop = y(s.floor_height_mm);
  const fill = ACCESS_FILL[s.access];
  const gapColour = GRADE_HEX[gradeGap(gapMm, s.rules)];
  const stepColour = GRADE_HEX[gradeStep(s.vertical_mm, s.rules)];
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mt-1.5 h-auto w-full max-w-80"
      role="img"
      aria-label={t("rail.access.detail", {
        vertical: signedMm(s.vertical_mm),
        platform: s.platform_height_mm,
        gap: `${Math.round(gapMm)} mm`,
      })}
    >
      {/* ground and rail */}
      <line x1={0} y1={base + 6} x2={W} y2={base + 6} stroke="#94a3b8" />
      <rect x={left + 30} y={base} width={10} height={6} fill="var(--diagram-muted, #475569)" />
      <rect x={W - 40} y={base} width={10} height={6} fill="var(--diagram-muted, #475569)" />
      {/* platform */}
      <rect
        x={0}
        y={pTop}
        width={edge}
        height={base + 6 - pTop}
        fill="var(--diagram-ground, #e2e8f0)"
        stroke="#94a3b8"
      />
      <text x={6} y={Math.min(base, pTop + 13)} fontSize={10} fill="var(--diagram-muted-strong, #334155)">
        {t("rail.access.platformMm", { value: s.platform_height_mm })}
      </text>
      {/* train: floor, door opening and body */}
      <rect x={left} y={fTop - body} width={W - left} height={body} fill={fill} opacity={0.12} />
      <line x1={left} y1={fTop - body} x2={left} y2={fTop} stroke={fill} strokeWidth={2} />
      <line x1={left} y1={fTop} x2={W} y2={fTop} stroke={fill} strokeWidth={3} />
      <rect
        x={left + 24}
        y={fTop}
        width={W - left - 48}
        height={Math.max(0, base - fTop - 2)}
        fill="var(--diagram-rule, #cbd5e1)"
        opacity={0.5}
      />
      <text
        x={W - 6}
        y={fTop - body + 14}
        fontSize={10}
        fill="var(--diagram-muted-strong, #334155)"
        textAnchor="end"
      >
        {t("rail.access.floorMm", { value: s.floor_height_mm })}
        {s.floor_assumed ? " ⚠" : ""}
      </text>
      {/* gap */}
      {s.horizontal_mm !== null && (
        <g stroke={gapColour} fill={gapColour}>
          <line x1={edge} y1={pTop - 16} x2={edge} y2={pTop - 4} />
          <line x1={left} y1={pTop - 16} x2={left} y2={pTop - 4} />
          <line x1={Math.min(edge, left)} y1={pTop - 10} x2={Math.max(edge, left)} y2={pTop - 10} />
          <text x={edge - 4} y={pTop - 20} fontSize={10} stroke="none" textAnchor="end">
            {t("rail.access.gapLabel")} {Math.round(gapMm)} mm
          </text>
        </g>
      )}
      {/* step */}
      <g stroke={stepColour} fill={stepColour}>
        <line x1={left + 14} y1={pTop} x2={left + 14} y2={fTop} strokeDasharray="3 2" />
        <line x1={edge - 6} y1={pTop} x2={left + 18} y2={pTop} strokeDasharray="3 2" />
        <text
          x={left + 20}
          y={Math.abs(fTop - pTop) < 14 ? Math.max(pTop, fTop) + 13 : (pTop + fTop) / 2 + 4}
          fontSize={10}
          stroke="none"
        >
          {t("rail.access.stepLabel")} {signedMm(s.vertical_mm)}
        </text>
      </g>
    </svg>
  );
}

/** Purpose: an "HH:MM" field that keeps what is typed until it is a valid time. */
export function TimeInput({
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
