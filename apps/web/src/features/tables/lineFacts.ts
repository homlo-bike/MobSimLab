import type { EngineText } from "../../i18n/engine";
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
import { fullTiming } from "../street-lines/modes";
import { dayService, vehicleById } from "../street-lines/service";
import { lineStats } from "../street-lines/summary";
import { type Translate, translate } from "../../i18n/i18n";
import type { FerryLine } from "./ferries";
import type { RopewayLine } from "./ropeways";

/** One line of the project, rail or street, with what it offers. */
export interface LineFact {
  /** "rail:<line id>", "street:<index>" or "plugin:<line key>" (cable cars, ferries), as in the cost estimate. */
  id: string;
  kind: "rail" | "street" | "ropeway" | "ferry";
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
  /** First and last departure, minutes after midnight; null when not set. */
  firstMin: number | null;
  lastMin: number | null;
  /** Hours of service a day. */
  serviceHours: number;
  /** Trips a weekday, both directions. */
  tripsPerDay: number;
  /** Vehicles or trains in service at the peak, and the fleet with spares (rail: units). */
  inService: number;
  fleet: number;
  /** Vehicle (rail: train) name, with units coupled. */
  vehicle: string | null;
  /** Passenger places per vehicle or train (seats plus standing at the planning density). */
  placesPerVehicle: number;
  /** Whether the places come from the assumption library (a street line without a catalogue vehicle). */
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
  /** The cable car lines of the plugin tools. */
  ropeways?: readonly RopewayLine[];
  /** The ferry lines of the plugin tools. */
  ferries?: readonly FerryLine[];
  /** Translates the names and problems; English when absent. */
  t?: Translate;
  /** Shows an engine finding in the app language (English without it). */
  engineText?: (finding: EngineText) => string;
}

/**
 * Purpose: the facts of every line of the project, rail service lines first, then street lines, then cable cars, then ferries.
 * Inputs: the railway and its build with the published service lines, the street lines, the project values, the translator.
 * Output: one fact sheet per line, in the order of the cost estimate.
 */
export function lineFacts(input: LineFactsInput): LineFact[] {
  const { railway, view, reports, streetLines, prefs, ropeways = [], ferries = [] } = input;
  const t: Translate = input.t ?? ((key, vars) => translate("en", key, vars));
  const est = estimate({
    railway,
    view,
    reports,
    streetLines,
    prefs,
    prices: BASE_PRICES,
    ropeways,
    ferries,
    t,
  });
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
        : ((r?.issues[0] !== undefined
            ? (input.engineText ?? ((f) => f.text))({ text: r.issues[0], msg: r.issue_msgs?.[0] })
            : undefined) ?? t(train ? "net.problem.unpublished" : "net.problem.noTrain")),
    });
  }

  streetLines.forEach((l, i) => {
    const s = summary.get(`street:${i}`);
    if (!s) return;
    const mode = l.profile.mode;
    const timing = fullTiming(l.timing);
    const stats = lineStats(l.view, timing);
    const headway = timing.headwayMin > 0 ? timing.headwayMin : null;
    // One direction: half the circuit's running time and its stops' dwell, without the layover.
    const tripMin = stats.cycleMin > 0 ? (stats.runMin + stats.dwellMin) / 2 : null;
    const service = dayService(timing, stats.cycleMin);
    const vehicle = vehicleById(l.vehicle);
    const places = vehicle?.capacity ?? paramValue("mode.vehicle_capacity", mode, prefs)[1];
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
      offpeakHeadwayMin: timing.offPeakHeadwayMin > 0 ? timing.offPeakHeadwayMin : null,
      firstMin: timing.firstMin,
      lastMin: timing.lastMin,
      serviceHours: service.serviceHours,
      tripsPerDay: headway && stats.vehicles > 0 ? service.tripsPerDay : 0,
      inService: s.inService,
      fleet: s.fleet,
      vehicle: vehicle?.name ?? null,
      placesPerVehicle: places,
      placesAssumed: !vehicle,
      capacityPerHour: headway ? (60 / headway) * places : 0,
      hoursPerYear: s.hoursPerYear,
      kmPerYear: s.kmPerYear,
      problem: s.inService > 0 ? null : t("net.problem.noService"),
    });
  });

  for (const r of ropeways) {
    const s = summary.get(r.id);
    if (!s) continue;
    const tripMin = r.tripS / 60;
    out.push({
      id: r.id,
      kind: "ropeway",
      name: r.name,
      mode: r.mode,
      color: r.color,
      lengthKm: r.lengthKm,
      stops: r.stations,
      spacingM: r.stations > 1 ? (r.lengthKm * 1000) / (r.stations - 1) : null,
      tripMin,
      speedKmh: tripMin > 0 ? r.lengthKm / (tripMin / 60) : null,
      peakHeadwayMin: r.headwayS / 60,
      offpeakHeadwayMin: null,
      firstMin: r.firstS / 60,
      lastMin: r.lastS / 60,
      serviceHours: Math.max(0, r.lastS - r.firstS) / 3600,
      tripsPerDay: r.tripsPerDay,
      inService: s.inService,
      fleet: s.fleet,
      vehicle: null,
      placesPerVehicle: r.placesPerCabin,
      placesAssumed: false,
      capacityPerHour: (3600 / r.headwayS) * r.placesPerCabin,
      hoursPerYear: s.hoursPerYear,
      kmPerYear: s.kmPerYear,
      problem: null,
    });
  }

  for (const f of ferries) {
    const s = summary.get(f.id);
    if (!s) continue;
    const tripMin = f.tripS / 60;
    out.push({
      id: f.id,
      kind: "ferry",
      name: f.name,
      mode: f.mode,
      color: f.color,
      lengthKm: f.lengthKm,
      stops: f.piers,
      spacingM: f.piers > 1 ? (f.lengthKm * 1000) / (f.piers - 1) : null,
      tripMin,
      speedKmh: tripMin > 0 ? f.lengthKm / (tripMin / 60) : null,
      peakHeadwayMin: f.headwayS / 60,
      offpeakHeadwayMin: null,
      firstMin: f.firstS / 60,
      lastMin: f.lastS / 60,
      serviceHours: Math.max(0, f.lastS - f.firstS) / 3600,
      tripsPerDay: f.tripsPerDay,
      inService: s.inService,
      fleet: s.fleet,
      vehicle: null,
      placesPerVehicle: f.placesPerVessel,
      placesAssumed: false,
      capacityPerHour: (3600 / f.headwayS) * f.placesPerVessel,
      hoursPerYear: s.hoursPerYear,
      kmPerYear: s.kmPerYear,
      problem: null,
    });
  }
  return out;
}
