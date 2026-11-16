/**
 * Departure timetables of the project's lines (FR-TT-05): each trip's times at every stop, a grid per line and
 * direction for the Tables tab, a CSV file of every stop time, and a printable page per line and day type (saved
 * as PDF through the browser's print dialog, as the app's other reports are).
 */
import type { DayTypeId } from "../../workspace/calendar";
import type { Timetable } from "../journey-planner/types";
import { hhmm } from "../railways/serviceLines";
import { patternDepartures, type VehicleBlock } from "./blocks";

/** One stop of a trip. */
export interface TripStop {
  stopId: string;
  name: string;
  arriveS: number;
  departS: number;
}

/** One passenger trip. */
export interface TripTimes {
  id: string;
  direction: number;
  stops: TripStop[];
}

/** Purpose: a time of day from seconds after midnight, such as 05:12 or 24:40. */
export const clockS = (s: number) => hhmm(Math.round(s / 60));

/**
 * Purpose: every trip of one route of a timetable: its exact trips and its frequency patterns expanded as the
 * journey planner expands them (`<pattern_id>@<departure>`), in order of departure.
 */
export function routeTrips(tt: Timetable, routeId: string): TripTimes[] {
  const names = new Map(tt.stops.map((s) => [s.stop_id, s.stop_name]));
  const name = (id: string) => names.get(id) ?? id;
  const out: TripTimes[] = tt.trips
    .filter((t) => t.route_id === routeId && t.stop_times.length >= 2)
    .map((t) => ({
      id: t.trip_id,
      direction: t.direction_id ?? 0,
      stops: [...t.stop_times]
        .sort((a, b) => a.stop_sequence - b.stop_sequence)
        .map((s) => ({
          stopId: s.stop_id,
          name: name(s.stop_id),
          arriveS: s.arrival_time,
          departS: s.departure_time,
        })),
    }));
  for (const p of tt.frequency_patterns ?? []) {
    if (p.route_id !== routeId || p.stops.length < 2) continue;
    for (const dep0 of patternDepartures(p.periods)) {
      let t = dep0;
      out.push({
        id: `${p.pattern_id}@${dep0}`,
        direction: p.direction_id ?? 0,
        stops: p.stops.map((s, i) => {
          const arr = i === 0 ? t : t + s.run_time;
          const dep = i === 0 ? t : arr + s.dwell_time;
          t = dep;
          return { stopId: s.stop_id, name: name(s.stop_id), arriveS: arr, departS: dep };
        }),
      });
    }
  }
  return out.sort((a, b) => a.stops[0]!.departS - b.stops[0]!.departS || a.direction - b.direction);
}

/** The timetable of one direction: stops down, trips across. */
export interface DirectionGrid {
  direction: number;
  /** Stop names in the order of the trip that calls at the most stops. */
  stops: { stopId: string; name: string }[];
  trips: { id: string; times: (number | null)[] }[];
}

/**
 * Purpose: one grid per direction. A cell is the departure at the stop (the arrival at the trip's last stop), or
 * null where the trip does not call.
 */
export function directionGrids(trips: readonly TripTimes[]): DirectionGrid[] {
  const dirs = [...new Set(trips.map((t) => t.direction))].sort((a, b) => a - b);
  return dirs.map((direction) => {
    const own = trips.filter((t) => t.direction === direction);
    const longest = own.reduce((a, b) => (b.stops.length > a.stops.length ? b : a), own[0]!);
    const stops = longest.stops.map((s) => ({ stopId: s.stopId, name: s.name }));
    return {
      direction,
      stops,
      trips: own.map((t) => ({
        id: t.id,
        times: stops.map((s) => {
          const i = t.stops.findIndex((x) => x.stopId === s.stopId);
          if (i < 0) return null;
          const x = t.stops[i]!;
          return i === t.stops.length - 1 ? x.arriveS : x.departS;
        }),
      })),
    };
  });
}

/** A line's timetable on one day type, for the export. */
export interface LineDayTrips {
  line: string;
  mode: string;
  day: DayTypeId;
  trips: TripTimes[];
  blocks: VehicleBlock[];
}

/** Purpose: a CSV field, quoted where needed (RFC 4180). */
function field(v: string | number): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/**
 * Purpose: every stop time of the given lines and day types as CSV: line, mode, day type, direction, trip,
 * vehicle block, stop sequence, stop, arrival and departure (HH:MM:SS, past 24:00 after midnight, as in GTFS).
 */
export function timetableCsv(rows: readonly LineDayTrips[]): string {
  const hms = (s: number) => {
    const r = Math.round(s);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(Math.floor(r / 3600))}:${p(Math.floor((r % 3600) / 60))}:${p(r % 60)}`;
  };
  const out = [
    [
      "line",
      "mode",
      "day_type",
      "direction",
      "trip_id",
      "block",
      "stop_sequence",
      "stop",
      "arrival",
      "departure",
    ].join(","),
  ];
  for (const r of rows) {
    const blockOf = new Map<string, string>();
    for (const b of r.blocks) for (const run of b.runs) blockOf.set(run.trip, `${r.line}/${b.n}`);
    for (const t of r.trips)
      t.stops.forEach((s, i) =>
        out.push(
          [
            r.line,
            r.mode,
            r.day,
            t.direction,
            t.id,
            blockOf.get(t.id) ?? "",
            i + 1,
            s.name,
            hms(s.arriveS),
            hms(s.departS),
          ]
            .map(field)
            .join(","),
        ),
      );
  }
  return out.join("\r\n") + "\r\n";
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * Purpose: one printable page per line and day type: for each direction the departures from the first stop by
 * hour, and the minutes from the first stop to every stop (those of the first trip).
 * Inputs: the lines' trips, the day type names, the page title.
 * Output: a full HTML document.
 */
export function printableTimetable(
  rows: readonly LineDayTrips[],
  dayLabel: Record<DayTypeId, string>,
  title: string,
): string {
  const pages = rows
    .filter((r) => r.trips.length)
    .map((r) => {
      const dirs = directionGrids(r.trips).map((g) => {
        const first = g.trips[0]!;
        const from = g.stops[0]!.name;
        const to = g.stops[g.stops.length - 1]!.name;
        const byHour = new Map<number, string[]>();
        for (const t of g.trips) {
          const dep = t.times[0];
          if (dep === null || dep === undefined) continue;
          const m = Math.round(dep / 60);
          const h = Math.floor(m / 60);
          byHour.set(h, [...(byHour.get(h) ?? []), String(m % 60).padStart(2, "0")]);
        }
        const hours = [...byHour.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([h, ms]) => `<tr><th>${String(h).padStart(2, "0")}</th><td>${ms.join(" ")}</td></tr>`)
          .join("");
        const start = first.times[0] ?? 0;
        const stops = g.stops
          .map((s, i) => {
            const v = first.times[i];
            return `<tr><td>${esc(s.name)}</td><td class="n">${v === null || v === undefined ? "|" : Math.round((v - start) / 60)}</td></tr>`;
          })
          .join("");
        return (
          `<section><h2>${esc(from)} → ${esc(to)}</h2><div class="cols">` +
          `<table class="hours"><caption>Departures from ${esc(from)}</caption>${hours}</table>` +
          `<table class="stops"><caption>Minutes from ${esc(from)}</caption>${stops}</table></div></section>`
        );
      });
      return `<article><h1>${esc(r.line)} <small>${esc(dayLabel[r.day])}</small></h1>${dirs.join("")}</article>`;
    });
  return (
    `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>` +
    `@page{size:A4 portrait;margin:12mm}body{font:10pt system-ui,sans-serif;color:#0f172a;margin:0}` +
    `article{break-after:page}article:last-child{break-after:auto}h1{font-size:18pt;margin:0 0 4mm}` +
    `h1 small{font-size:11pt;font-weight:500;color:#475569;margin-left:3mm}h2{font-size:11pt;margin:5mm 0 2mm}` +
    `.cols{display:flex;gap:8mm;align-items:flex-start}table{border-collapse:collapse}` +
    `caption{text-align:left;font-weight:600;font-size:9pt;color:#475569;padding-bottom:1mm}` +
    `th,td{padding:0.6mm 2mm;border-bottom:0.2mm solid #e2e8f0;vertical-align:top;text-align:left}` +
    `.hours th{width:9mm;font-variant-numeric:tabular-nums}.hours td{font-variant-numeric:tabular-nums;word-spacing:1.5mm}` +
    `.stops .n{text-align:right;font-variant-numeric:tabular-nums}` +
    `</style></head><body>${pages.join("")}</body></html>`
  );
}

/**
 * Purpose: open the browser's print dialog with a document, so it can be printed or saved as PDF.
 * Side effect: a hidden frame is added, printed and removed.
 */
export function printDocument(html: string): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.append(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  const done = () => setTimeout(() => frame.remove(), 500);
  win.addEventListener("afterprint", done);
  setTimeout(() => {
    win.focus();
    win.print();
    done();
  }, 50);
}

/** Purpose: let the browser save a text file. */
export function downloadText(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
