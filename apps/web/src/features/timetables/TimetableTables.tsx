import { Fragment, useMemo, useState } from "react";
import { card, fmtQty, num, NumberField, td, th } from "../costs/CostTables";
import { paramValue, prefId } from "../costs/params";
import { loadWasmGtfs } from "../gtfs/engine";
import { gtfsAvailable, saveFeed } from "../gtfs/GtfsSection";
import type { GtfsEngineLoader } from "../gtfs/types";
import { prefixTimetable } from "../journey-planner/network";
import type { Timetable } from "../journey-planner/types";
import { lineMode } from "../railways/serviceLines";
import type { Network, RailEngineLoader } from "../railways/types";
import { fullTiming } from "../street-lines/modes";
import type { StreetLinesDoc } from "../street-lines/saved";
import {
  calendarFrom,
  DAY_TYPES,
  type DayTypeId,
  type ServiceCalendar,
  weekendOf,
} from "../../workspace/calendar";
import { englishDayTypeNames, useDayTypeText } from "../../workspace/dayTypeLabel";
import { type PreferencesDoc, withPref } from "../../workspace/preferences";
import { type Translate, useI18n } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/messages";
import { useModeLabel } from "../schematic/common";
import { blockSummary, fleetRow, railBlocks, streetBlocks, type BlockRun, type VehicleBlock } from "./blocks";
import { railLineFor } from "./dayTypes";
import { feedHolidays, mergeDays, streetDay } from "./feed";
import {
  clockS,
  directionGrids,
  downloadText,
  type LineDayTrips,
  printableTimetable,
  printDocument,
  routeTrips,
  timetableCsv,
  type TripTimes,
} from "./departures";
import { type DayPublications, useRailPublications } from "./railPublish";

interface Props {
  railway: Network | null;
  streetLines: StreetLinesDoc | null;
  preferences: PreferencesDoc | null;
  /** Saves the project's own values (longest terminal wait, spare share); absent when read only. */
  onPreferences?: (d: PreferencesDoc) => void;
  /** Project name, for the file names of the downloads. */
  projectName?: string;
  /** Tests inject the engines. */
  loadRail?: RailEngineLoader;
  loadGtfs?: GtfsEngineLoader;
}

/** One line on one day type: its trips and blocks. */
interface LineBlocks {
  key: string;
  name: string;
  color: string;
  mode: string;
  /** Units coupled per train (1 for street lines). */
  units: number;
  trips: TripTimes[];
  blocks: VehicleBlock[];
  /** The line's timetable on the day type, with that day's service id, for the GTFS download. */
  timetable: Timetable | null;
}

/** Day type names on screen, and as they read inside a sentence. */
const DAY_KEY: Record<DayTypeId, MessageKey> = {
  weekday: "tt.tbl.day.weekday",
  saturday: "tt.tbl.day.saturday",
  sunday: "tt.tbl.day.sunday",
  holiday: "tt.tbl.day.holiday",
};
const DAY_IN_KEY: Record<DayTypeId, MessageKey> = {
  weekday: "tt.tbl.dayIn.weekday",
  saturday: "tt.tbl.dayIn.saturday",
  sunday: "tt.tbl.dayIn.sunday",
  holiday: "tt.tbl.dayIn.holiday",
};

const WAIT_KEY = "timetable.max_terminal_wait_min";
const SPARE_KEY = "mode.spare_share";
const int = (v: number) => new Intl.NumberFormat("en").format(Math.round(v));
const hours = (s: number) =>
  `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, "0")} min`;

/** Purpose: every line's trips and blocks on one day type. */
function linesOn(
  day: DayTypeId,
  railway: Network | null,
  publications: DayPublications,
  streetLines: StreetLinesDoc | null,
  cal: ServiceCalendar,
  maxWaitMin: number,
  t: Translate,
): LineBlocks[] {
  const out: LineBlocks[] = [];
  const pub = publications[day];
  for (const line of pub ? (railway?.lines ?? []) : []) {
    const l = railLineFor(line, day);
    const mode = lineMode(railway!, l);
    const name = l.name || l.id;
    out.push({
      key: `rail:${l.id}`,
      name,
      color: l.color,
      mode,
      units: Math.max(1, Math.round(l.units)),
      trips: routeTrips(pub!.timetable, l.id),
      blocks: railBlocks(pub!.blocks ?? [], l.id, name, mode),
      timetable: null,
    });
  }
  for (const [i, s] of (streetLines?.lines ?? []).entries()) {
    const own = streetDay(s, day, cal);
    if (!own) continue;
    const { input, timetable } = own;
    out.push({
      key: `street:${i}`,
      name: input.name || t("tbl.streetLineName", { n: i + 1 }),
      color: input.color,
      mode: input.mode,
      units: 1,
      trips: timetable ? routeTrips(timetable, `street-${input.name}`) : [],
      blocks: streetBlocks({
        line: input,
        layoverMin: fullTiming(s.timing).layoverMin,
        hasDepot: !!(s.depotId || s.depot),
        maxWaitMin,
        timetable,
      }),
      timetable: timetable && prefixTimetable(timetable, `s${i}:`),
    });
  }
  return out;
}

/** Purpose: one timetable of every day type for the GTFS download (rail publications and street lines). */
export function allDays(
  byDay: Record<DayTypeId, LineBlocks[]>,
  publications: DayPublications,
): Timetable | null {
  return mergeDays(
    Object.fromEntries(
      DAY_TYPES.map((day) => {
        const rail = publications[day]?.timetable;
        return [
          day,
          [
            ...(rail ? [prefixTimetable(rail, "lines:")] : []),
            ...byDay[day].flatMap((l) => (l.timetable ? [l.timetable] : [])),
          ],
        ];
      }),
    ),
  );
}

/**
 * The timetables of the Tables tab, per day type (weekday, Saturday, Sunday, public holiday): the vehicle
 * blocks (FR-TT-04), each vehicle's runs from pull-out to pull-in with the fleet each line needs, and the
 * departures of each line (FR-TT-05) with CSV, PDF (print) and GTFS downloads. The downloads stay in English.
 * Side effects: publishes the railway's service lines with the rail engine.
 */
export function TimetableTables({
  railway,
  streetLines,
  preferences,
  onPreferences,
  projectName = "",
  loadRail,
  loadGtfs = loadWasmGtfs,
}: Props) {
  const { t } = useI18n();
  const dayText = useDayTypeText();
  const prefs = preferences?.values;
  const maxWaitMin = paramValue(WAIT_KEY, "*", prefs)[1];
  const options = useMemo(() => ({ max_idle_s: maxWaitMin * 60 }), [maxWaitMin]);
  const [day, setDay] = useState<DayTypeId>("weekday");
  const calKey = JSON.stringify(calendarFrom(preferences));
  const cal = useMemo(() => JSON.parse(calKey) as ServiceCalendar, [calKey]);
  const { publications, busy, error } = useRailPublications(railway, cal, options, prefs, loadRail);
  const byDay = useMemo(
    () =>
      Object.fromEntries(
        DAY_TYPES.map((d) => [d, linesOn(d, railway, publications, streetLines, cal, maxWaitMin, t)]),
      ) as Record<DayTypeId, LineBlocks[]>,
    [railway, publications, streetLines, cal, maxWaitMin, t],
  );
  const lines = byDay[day];

  const editable = !!onPreferences;
  const setPref = (id: string, v: number | null) => onPreferences?.(withPref(preferences, id, v));
  const nothing = !DAY_TYPES.some((d) => byDay[d].length) && !busy;
  const [failed, setFailed] = useState<string | null>(null);

  const rows = (): LineDayTrips[] =>
    DAY_TYPES.flatMap((d) =>
      byDay[d].map((l) => ({ line: l.name, mode: l.mode, day: d, trips: l.trips, blocks: l.blocks })),
    );
  const base = (projectName.trim() || "timetables").replace(/[^\p{L}\p{N}._-]+/gu, "-");
  const downloadCsv = () =>
    downloadText(`${base}-timetables.csv`, timetableCsv(rows()), "text/csv;charset=utf-8");
  const print = () =>
    printDocument(
      printableTimetable(
        rows(),
        englishDayTypeNames(weekendOf(cal)),
        `${projectName || "MobSimLab"} timetables`,
      ),
    );
  const exporter = gtfsAvailable().exporter;
  const downloadGtfs = async () => {
    setFailed(null);
    const tt = allDays(byDay, publications);
    if (!tt) return;
    try {
      const today = new Date();
      await saveFeed(loadGtfs, tt, {
        projectName,
        lang: "en",
        holidays: feedHolidays(cal, today, new Date(today.getTime() + 365 * 86_400_000)),
        weekend: weekendOf(cal),
      });
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section aria-labelledby="timetables-title" className="mt-10">
      <h2 id="timetables-title" className="text-xl font-semibold tracking-tight">
        {t("tt.tbl.title")}
      </h2>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <span className="font-medium">{t("tt.tbl.dayType")}</span>
          <select
            value={day}
            onChange={(e) => setDay(e.target.value as DayTypeId)}
            className="rounded border border-slate-300 px-2 py-1"
          >
            {DAY_TYPES.map((d) => (
              <option key={d} value={d}>
                {dayText(d, DAY_KEY)}
              </option>
            ))}
          </select>
        </label>
        {!nothing && (
          <span className="flex flex-wrap gap-2">
            <button type="button" className="btn" disabled={busy} onClick={downloadCsv}>
              {t("tt.tbl.csv")}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={print}>
              {t("tt.tbl.print")}
            </button>
            {exporter && (
              <button type="button" className="btn" disabled={busy} onClick={() => void downloadGtfs()}>
                {t("tt.tbl.gtfs")}
              </button>
            )}
          </span>
        )}
      </div>
      {!nothing && <p className="mt-1 text-xs text-slate-500">{t("tt.tbl.downloadsNote")}</p>}
      {(error || failed) && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error ? t("tt.tbl.railError", { error }) : t("tt.tbl.gtfsError", { error: failed ?? "" })}
        </p>
      )}
      {nothing ? (
        <p className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-5 text-slate-600">
          {t("tt.tbl.empty")}
        </p>
      ) : (
        <>
          <VehicleBlocks
            lines={lines}
            day={day}
            busy={busy}
            prefs={prefs}
            editable={editable}
            setPref={setPref}
          />
          <Departures lines={lines} day={day} />
        </>
      )}
    </section>
  );
}

/** Purpose: the departures of one line and direction: stops down, trips across. */
function Departures({ lines, day }: { lines: LineBlocks[]; day: DayTypeId }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const line = lines.find((l) => l.key === chosen) ?? lines[0] ?? null;
  const grids = useMemo(() => (line ? directionGrids(line.trips) : []), [line]);
  const { t } = useI18n();
  const dayText = useDayTypeText();
  const modeLabel = useModeLabel();
  return (
    <section className={card} aria-labelledby="departures-title">
      <h3 id="departures-title" className="caps m-0">
        {t("tt.tbl.departures", { day: dayText(day, DAY_IN_KEY) })}
      </h3>
      {line && (
        <label className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{t("tt.tbl.line")}</span>
          <select
            value={line.key}
            onChange={(e) => setChosen(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1"
          >
            {lines.map((l) => (
              <option key={l.key} value={l.key}>
                {l.name} ({modeLabel(l.mode)})
              </option>
            ))}
          </select>
        </label>
      )}
      {!grids.length && <p className="mt-2 text-sm text-slate-600">{t("tt.tbl.noTrips")}</p>}
      {grids.map((g) => {
        const from = g.stops[0]?.name ?? "";
        const to = g.stops[g.stops.length - 1]?.name ?? "";
        return (
          <div key={g.direction} className="mt-4">
            <p className="text-sm font-medium">
              {from} → {to}{" "}
              <span className="font-normal text-slate-500">{t("tt.tbl.nTrips", { n: g.trips.length })}</span>
            </p>
            <div className="mt-1 overflow-x-auto">
              <table className="text-xs">
                <caption className="sr-only">
                  {t("tt.tbl.dirCaption", { line: line!.name, from, to })}
                </caption>
                <tbody>
                  {g.stops.map((s, i) => (
                    <tr key={s.stopId} className="border-b border-slate-100">
                      <th
                        scope="row"
                        className="sticky left-0 bg-white px-2 py-1 text-left font-medium whitespace-nowrap"
                      >
                        {s.name}
                      </th>
                      {g.trips.map((t) => (
                        <td key={t.id} className="px-1.5 py-1 text-right tabular-nums">
                          {t.times[i] === null || t.times[i] === undefined ? "|" : clockS(t.times[i]!)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function VehicleBlocks({
  lines,
  day,
  busy,
  prefs,
  editable,
  setPref,
}: {
  lines: LineBlocks[];
  day: DayTypeId;
  busy: boolean;
  prefs: PreferencesDoc["values"] | undefined;
  editable: boolean;
  setPref: (id: string, v: number | null) => void;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const line = lines.find((l) => l.key === chosen) ?? lines[0] ?? null;
  const rows = lines.map((l) => ({
    l,
    f: fleetRow(l.name, l.mode, l.blocks, paramValue(SPARE_KEY, l.mode, prefs)[1], l.units),
  }));
  const modes = [...new Set(lines.map((l) => l.mode))];
  const waitLib = paramValue(WAIT_KEY, "*", undefined)[1];
  const { t } = useI18n();
  const dayText = useDayTypeText();
  const modeLabel = useModeLabel();
  return (
    <section className={card} aria-labelledby="blocks-title">
      <h3 id="blocks-title" className="caps m-0">
        {t("tt.tbl.blocksTitle", { day: dayText(day, DAY_IN_KEY) })}
      </h3>
      <p className="mt-1 text-sm text-slate-600">{t("tt.tbl.blocksIntro")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <span>{t("tt.tbl.wait")}</span>
          <NumberField
            label={t("tt.tbl.waitAria")}
            value={prefs?.[WAIT_KEY]}
            placeholder={fmtQty(waitLib)}
            editable={editable}
            onCommit={(v) => setPref(WAIT_KEY, v)}
          />
        </label>
        {modes.map((m) => {
          const id = prefId(SPARE_KEY, m);
          const own = prefs?.[id];
          return (
            <label key={m} className="flex items-center gap-2">
              <span>{t("tt.tbl.spare", { mode: modeLabel(m) })}</span>
              <NumberField
                label={t("tt.tbl.spareAria", { mode: modeLabel(m) })}
                value={own === undefined ? undefined : Number((own * 100).toPrecision(4))}
                placeholder={fmtQty(paramValue(SPARE_KEY, m, undefined)[1] * 100)}
                editable={editable}
                onCommit={(v) => setPref(id, v === null ? null : v / 100)}
              />
            </label>
          );
        })}
      </div>
      {busy && (
        <p role="status" className="mt-3 text-sm text-slate-500">
          {t("tt.tbl.planning")}
        </p>
      )}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>{t("tt.tbl.line")}</th>
              <th className={`${th} text-right`}>{t("tt.tbl.blocks")}</th>
              <th className={`${th} text-right`}>{t("tt.tbl.spares")}</th>
              <th className={`${th} text-right`}>{t("tt.tbl.fleet")}</th>
              <th className={`${th} text-right`}>{t("tt.tbl.trips")}</th>
              <th className={`${th} text-right`}>{t("tt.tbl.vehHours")}</th>
              <th className={`${th} text-right`}>{t("tt.tbl.vehKm")}</th>
              <th className={`${th} text-right`}>{t("tt.tbl.ofWhichEmpty")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ l, f }) => (
              <tr key={l.key} className="border-b border-slate-100">
                <td className={td}>
                  <span className="inline-flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="inline-block h-3 w-3 shrink-0 rounded-full"
                      style={{ background: l.color }}
                    />
                    <span className="font-medium">{l.name}</span>
                  </span>
                  <span className="block text-xs text-slate-500">{modeLabel(l.mode)}</span>
                </td>
                <td className={num}>{int(f.blocks)}</td>
                <td className={num}>{`${fmtQty(f.spareShare * 100)}%`}</td>
                <td className={num}>
                  {int(f.fleet)}
                  {f.units > 1 && (
                    <span className="block text-xs text-slate-500">
                      {t("tt.tbl.unitsPerTrain", { n: f.units })}
                    </span>
                  )}
                </td>
                <td className={num}>{int(f.trips)}</td>
                <td className={num}>{fmtQty(f.vehicleHours)}</td>
                <td className={num}>{fmtQty(f.serviceKm + f.emptyKm)}</td>
                <td className={num}>{fmtQty(f.emptyKm)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {line && (
        <div className="mt-5">
          <label className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{t("tt.tbl.blocksOf")}</span>
            <select
              value={line.key}
              onChange={(e) => setChosen(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1"
            >
              {lines.map((l) => (
                <option key={l.key} value={l.key}>
                  {l.name} ({modeLabel(l.mode)})
                </option>
              ))}
            </select>
          </label>
          <BlockList line={line} day={day} />
        </div>
      )}
      <ul className="mt-3 list-disc ps-5 text-xs text-slate-500">
        <li>{t("tt.tbl.note.rail")}</li>
        <li>{t("tt.tbl.note.hours")}</li>
        <li>{t("tt.tbl.note.library")}</li>
      </ul>
    </section>
  );
}

const KIND: Record<BlockRun["kind"], MessageKey> = {
  service: "tt.tbl.kind.service",
  pull_out: "tt.tbl.kind.pull_out",
  pull_in: "tt.tbl.kind.pull_in",
};

/** Purpose: the blocks of one line, each with its runs on demand. */
function BlockList({ line, day }: { line: LineBlocks; day: DayTypeId }) {
  const [open, setOpen] = useState<number | null>(null);
  const { t } = useI18n();
  const dayText = useDayTypeText();
  if (!line.blocks.length)
    return (
      <p className="mt-2 text-sm text-slate-600">
        {t("tt.tbl.lineNoTrips", { day: dayText(day, DAY_IN_KEY) })}
      </p>
    );
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[40rem] text-sm">
        <thead>
          <tr className="border-b border-slate-200">
            <th className={th}>{t("tt.tbl.block")}</th>
            <th className={`${th} text-right`}>{t("tt.tbl.starts")}</th>
            <th className={`${th} text-right`}>{t("tt.tbl.ends")}</th>
            <th className={`${th} text-right`}>{t("tt.tbl.trips")}</th>
            <th className={`${th} text-right`}>{t("tt.tbl.inService")}</th>
            <th className={`${th} text-right`}>{t("tt.tbl.km")}</th>
          </tr>
        </thead>
        <tbody>
          {line.blocks.map((b) => {
            const s = blockSummary(b);
            const first = b.runs[0]!;
            const last = b.runs[b.runs.length - 1]!;
            const isOpen = open === b.n;
            return (
              <Fragment key={b.n}>
                <tr className="border-b border-slate-100">
                  <td className={td}>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : b.n)}
                      className="font-medium text-blue-700 hover:underline"
                    >
                      {line.name}/{b.n}
                    </button>
                  </td>
                  <td className={num}>
                    {clockS(s.startS)}
                    <span className="block text-xs text-slate-500">
                      {first.from ?? t("tt.tbl.depotLower")}
                    </span>
                  </td>
                  <td className={num}>
                    {clockS(s.endS)}
                    <span className="block text-xs text-slate-500">{last.to ?? t("tt.tbl.depotLower")}</span>
                  </td>
                  <td className={num}>{int(s.trips)}</td>
                  <td className={num}>{hours(s.endS - s.startS)}</td>
                  <td className={num}>{fmtQty(s.serviceKm + s.emptyKm)}</td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <td colSpan={6} className="px-2 py-2">
                      <table className="w-full text-xs">
                        <caption className="sr-only">
                          {t("tt.tbl.runsCaption", { block: `${line.name}/${b.n}` })}
                        </caption>
                        <thead>
                          <tr>
                            <th className={th}>{t("tt.tbl.run")}</th>
                            <th className={th}>{t("tt.tbl.from")}</th>
                            <th className={`${th} text-right`}>{t("tt.tbl.departs")}</th>
                            <th className={th}>{t("tt.tbl.to")}</th>
                            <th className={`${th} text-right`}>{t("tt.tbl.arrives")}</th>
                            <th className={`${th} text-right`}>{t("tt.tbl.km")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {b.runs.map((r) => (
                            <tr key={r.trip}>
                              <td className={td}>{t(KIND[r.kind])}</td>
                              <td className={td}>{r.from ?? t("tt.tbl.depot")}</td>
                              <td className={num}>{clockS(r.departS)}</td>
                              <td className={td}>{r.to ?? t("tt.tbl.depot")}</td>
                              <td className={num}>{clockS(r.arriveS)}</td>
                              <td className={num}>{fmtQty(r.km)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
