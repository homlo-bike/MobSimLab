/**
 * The facts of each line of a project, for the network tables (summary, service and fleet) and for any
 * other view that needs a line's length, stops, running time, speed, frequency, fleet or capacity.
 * Fleet, vehicle-hours and vehicle-km come from the cost estimate's line summaries (ADR-0039), so the
 * tables and the costs always agree.
 */
import { BASE_PRICES } from "../costs/economy";
import { estimate, type LineSummary } from "../costs/model";
import { paramValue } from "../costs/params";
import { lineMode, trainById } from "../railways/serviceLines";
import type { LineReport, Network, RailView } from "../railways/types";
import type { SavedStreetLine } from "../street-lines/saved";
import { lineStats } from "../street-lines/summary";

/** One line of the project, rail or street, with what it offers. */
export interface LineFact {
  /** "rail:<line id>" or "street:<index>", as in the cost estimate. */
  id: string;
  kind: "rail" | "street";
  name: string;
  mode: string;
  color: string;
  /** End to end, one direction, km. Rail: straight between the stations it calls at; street: as routed. */
  lengthKm: number;
  /** Stops or stations served, one direction. */
  stops: number;
  /** Average distance between neighbouring stops, m; null with fewer than two stops. */
  spacingM: number | null;
  /** End-to-end trip time with stops, one direction, min; null when the line has no service yet. */
  tripMin: number | null;
  /** Average speed with stops (commercial speed), km/h; null without a trip time. */
  speedKmh: number | null;
  /** Minutes between departures in the peak and off peak; off peak null when the line has one headway. */
  peakHeadwayMin: number | null;
  offpeakHeadwayMin: number | null;
  /** First and last departure, minutes after midnight; null when not set (street lines). */
  firstMin: number | null;
  lastMin: number | null;
  /** Hours of service a day. */
  serviceHours: number;
  /** Whether the service hours are the library's assumption rather than set on the line. */
  hoursAssumed: boolean;
  /** Trips a weekday, both directions. */
  tripsPerDay: number;
  /** Vehicles or trains in service at the peak, and the fleet with spares (rail: units). */
  inService: number;
  fleet: number;
  /** Vehicle (rail: train) name, with units coupled. */
  vehicle: string | null;
  /** Passenger places per vehicle or train (seats plus standing at the planning density). */
  placesPerVehicle: number;
  /** Whether the places come from the assumption library rather than the chosen catalogue train. */
  placesAssumed: boolean;
  /** Passenger places an hour in one direction at the peak headway. */
  capacityPerHour: number;
  /** Vehicle- or train-hours and km a year, as in the cost estimate. */
  hoursPerYear: number;
  kmPerYear: number;
  /** Why the line has no service figures, when it has none. */
  problem: string | null;
}

export interface LineFactsInput {
  railway: Network | null;
  view: RailView | null;
  reports: Record<string, LineReport>;
  streetLines: SavedStreetLine[];
  prefs: Record<string, number> | undefined;
}

const per = (n: number, d: number) => (d > 0 ? n / d : 0);

/**
 * Purpose: the facts of every line of the project, rail service lines first, then street lines.
 * Inputs: the railway and its build with the published service lines, the street lines, the project values.
 * Output: one fact sheet per line, in the order of the cost estimate.
 */
export function lineFacts(input: LineFactsInput): LineFact[] {
  const { railway, view, reports, streetLines, prefs } = input;
  const est = estimate({ railway, view, reports, streetLines, prefs, prices: BASE_PRICES });
  const summary = new Map<string, LineSummary>(est.lines.map((l) => [l.id, l]));
  const out: LineFact[] = [];

  for (const l of railway?.lines ?? []) {
    const s = summary.get(`rail:${l.id}`);
    if (!s) continue;
    const r = reports[l.id];
    const train = trainById(l.vehicle);
    const units = Math.max(1, Math.round(l.units));
    const stops = l.stations.filter((id) => railway!.stations.some((st) => st.id === id)).length;
    const running = !!r && r.trains > 0;
    const tripS = running ? ((r.outbound_s ?? 0) + (r.return_s ?? r.outbound_s ?? 0)) / 2 : 0;
    const tripMin = tripS > 0 ? tripS / 60 : null;
    const places = (train?.capacity ?? 0) * units;
    out.push({
      id: s.id,
      kind: "rail",
      name: s.name,
      mode: lineMode(railway!, l),
      color: s.color,
      lengthKm: s.lengthKm,
      stops,
      spacingM: stops > 1 ? (s.lengthKm * 1000) / (stops - 1) : null,
      tripMin,
      speedKmh: tripMin ? s.lengthKm / (tripMin / 60) : null,
      peakHeadwayMin: l.peak_headway_min,
      offpeakHeadwayMin: l.offpeak_headway_min,
      firstMin: l.first_min,
      lastMin: l.last_min,
      serviceHours: Math.max(0, l.last_min - l.first_min) / 60,
      hoursAssumed: false,
      tripsPerDay: running ? r.trips : 0,
      inService: s.inService,
      fleet: s.fleet,
      vehicle: train ? (units > 1 ? `${train.name} × ${units}` : train.name) : null,
      placesPerVehicle: places,
      placesAssumed: false,
      capacityPerHour: running && l.peak_headway_min > 0 ? (60 / l.peak_headway_min) * places : 0,
      hoursPerYear: s.hoursPerYear,
      kmPerYear: s.kmPerYear,
      problem: running
        ? null
        : (r?.issues[0] ?? (train ? "The line could not be published." : "No train chosen.")),
    });
  }

  streetLines.forEach((l, i) => {
    const s = summary.get(`street:${i}`);
    if (!s) return;
    const mode = l.profile.mode;
    const stats = lineStats(l.view, l.timing);
    const headway = l.timing.headwayMin > 0 ? l.timing.headwayMin : null;
    // One direction: half the circuit's running time and its stops' dwell, without the layover.
    const tripMin = stats.cycleMin > 0 ? (stats.runMin + stats.dwellMin) / 2 : null;
    const hours = paramValue("cost.service_hours_per_day", mode, prefs)[1];
    const places = paramValue("mode.vehicle_capacity", mode, prefs)[1];
    out.push({
      id: s.id,
      kind: "street",
      name: s.name,
      mode,
      color: s.color,
      lengthKm: s.lengthKm,
      stops: stats.stops,
      spacingM: stats.stops > 1 ? (s.lengthKm * 1000) / (stats.stops - 1) : null,
      tripMin,
      speedKmh: tripMin ? s.lengthKm / (tripMin / 60) : null,
      peakHeadwayMin: headway,
      offpeakHeadwayMin: null,
      firstMin: null,
      lastMin: null,
      serviceHours: hours,
      hoursAssumed: true,
      tripsPerDay: headway ? Math.floor(per(hours * 60, headway)) * 2 : 0,
      inService: s.inService,
      fleet: s.fleet,
      vehicle: null,
      placesPerVehicle: places,
      placesAssumed: true,
      capacityPerHour: headway ? (60 / headway) * places : 0,
      hoursPerYear: s.hoursPerYear,
      kmPerYear: s.kmPerYear,
      problem: s.inService > 0 ? null : "The line has no route or headway yet.",
    });
  });
  return out;
}
