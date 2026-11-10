import { type ReactNode, useMemo, useState } from "react";
import {
  card,
  fmtQty,
  modeLabel,
  num,
  type Sort,
  SortHeader,
  sorted,
  td,
  th,
  Tile,
} from "../costs/CostTables";
import { hhmm } from "../railways/serviceLines";
import type { Network, RailEngineLoader } from "../railways/types";
import type { StreetLinesDoc } from "../street-lines/saved";
import type { PreferencesDoc } from "../../workspace/preferences";
import { type LineFact, lineFacts } from "./lineFacts";
import {
  BRIDGES,
  LEVEL_LABEL,
  LEVELS,
  quantities,
  type Quantities,
  type RailQuantities,
  STRUCTURE_LABEL,
  STRUCTURES,
  TUNNELS,
} from "./quantities";
import { type HeightsFetcher, useRailBuild } from "./railBuild";

interface Props {
  railway: Network | null;
  streetLines: StreetLinesDoc | null;
  preferences: PreferencesDoc | null;
  /** Tests inject these. */
  loadRail?: RailEngineLoader;
  fetchHeights?: HeightsFetcher;
}

const km = (v: number) => `${fmtQty(v)} km`;
const int = (v: number) => new Intl.NumberFormat("en").format(Math.round(v));
const sumOf = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);

/**
 * The network tables of the Tables tab: a summary of the project, its infrastructure quantities, and the
 * service and fleet of each line. In English for now, like the cost tables.
 * Side effects: builds the railway with the rail engine and loads the terrain heights under it.
 */
export function NetworkTables({ railway, streetLines, preferences, loadRail, fetchHeights }: Props) {
  const { build, error } = useRailBuild(railway, loadRail, fetchHeights);
  const prefs = preferences?.values;
  const lines = streetLines?.lines ?? [];
  const facts = useMemo(
    () =>
      lineFacts({
        railway,
        view: build?.view ?? null,
        reports: build?.reports ?? {},
        streetLines: lines,
        prefs,
      }),
    [railway, build, lines, prefs],
  );
  const q = useMemo(() => quantities(railway, build?.view ?? null, lines), [railway, build, lines]);
  const waiting = !!railway?.tracks.length && !build && !error;
  const empty = !facts.length && !q.rail.length && !q.street.length;

  return (
    <div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          The railway design could not be read: {error}
        </p>
      )}
      {waiting ? (
        <p role="status" className="mt-6 text-slate-500">
          Measuring the railway…
        </p>
      ) : empty ? (
        <section aria-labelledby="summary-title" className="mt-6">
          <h2 id="summary-title" className="text-xl font-semibold tracking-tight">
            Summary
          </h2>
          <p className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-5 text-slate-600">
            Nothing to measure yet. Draw a railway or a street line in the Create tab.
          </p>
        </section>
      ) : (
        <>
          <Summary facts={facts} q={q} />
          <Infrastructure q={q} terrain={build?.terrain ?? null} />
          <ServiceAndFleet facts={facts} />
        </>
      )}
    </div>
  );
}

/** Purpose: the project at a glance: size, fleet and service, in total and per mode. */
function Summary({ facts, q }: { facts: LineFact[]; q: Quantities }) {
  const railKm = sumOf(q.rail, (r) => r.routeKm);
  const streetKm = sumOf(q.street, (s) => s.routeKm);
  const stations = sumOf(q.rail, (r) => sumOf(LEVELS, (l) => r.stations[l]));
  const stops = sumOf(q.street, (s) => s.stops);
  const tunnels = sumOf(q.rail, (r) => sumOf(TUNNELS, (s) => r.byStructure[s]));
  const bridges = sumOf(q.rail, (r) => sumOf(BRIDGES, (s) => r.byStructure[s]));
  const modes = [
    ...new Set([...q.rail.map((r) => r.mode), ...q.street.map((s) => s.mode), ...facts.map((f) => f.mode)]),
  ];
  const fleet = sumOf(facts, (f) => f.fleet);
  const peak = sumOf(facts, (f) => f.inService);
  return (
    <section aria-labelledby="summary-title" className="mt-6">
      <h2 id="summary-title" className="text-xl font-semibold tracking-tight">
        Summary
      </h2>
      <p className="mt-1 max-w-3xl text-slate-600">
        The size of the project and the service it runs, from the railway design, its service lines and the
        street lines.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          title="Lines"
          value={int(facts.length)}
          sub={`${int(modes.length)} ${modes.length === 1 ? "mode" : "modes"}`}
        />
        <Tile
          title="Route length"
          value={km(railKm + streetKm)}
          sub={`${km(railKm)} railway, ${km(streetKm)} street lines`}
        />
        <Tile
          title="Stations and stops"
          value={int(stations + stops)}
          sub={`${int(stations)} stations, ${int(stops)} stops`}
        />
        <Tile title="Fleet with spares" value={int(fleet)} sub={`${int(peak)} in service at the peak`} />
        <Tile
          title="Vehicle-km a year"
          value={new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(
            sumOf(facts, (f) => f.kmPerYear),
          )}
          sub="trains counted once, however many units"
        />
        <Tile
          title="Peak capacity"
          value={int(sumOf(facts, (f) => f.capacityPerHour))}
          sub="places an hour, one direction, all lines"
        />
        <Tile title="In tunnel" value={km(tunnels)} sub="cut and cover and bored, route length" />
        <Tile title="On bridges and viaducts" value={km(bridges)} sub="route length" />
      </div>
      <section className={card} aria-labelledby="summary-by-mode">
        <h3 id="summary-by-mode" className="caps m-0">
          Per mode
        </h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className={th}>Mode</th>
                <th className={`${th} text-right`}>Lines</th>
                <th className={`${th} text-right`}>Route length</th>
                <th className={`${th} text-right`}>Stations or stops</th>
                <th className={`${th} text-right`}>Fleet</th>
                <th className={`${th} text-right`}>Vehicle-km a year</th>
              </tr>
            </thead>
            <tbody>
              {modes.map((m) => {
                const r = q.rail.find((x) => x.mode === m);
                const ss = q.street.filter((x) => x.mode === m);
                const fs = facts.filter((f) => f.mode === m);
                return (
                  <tr key={m} className="border-b border-slate-100">
                    <td className={td}>{modeLabel(m)}</td>
                    <td className={num}>{int(fs.length)}</td>
                    <td className={num}>{km((r?.routeKm ?? 0) + sumOf(ss, (s) => s.routeKm))}</td>
                    <td className={num}>
                      {int((r ? sumOf(LEVELS, (l) => r.stations[l]) : 0) + sumOf(ss, (s) => s.stops))}
                    </td>
                    <td className={num}>{int(sumOf(fs, (f) => f.fleet))}</td>
                    <td className={num}>{int(sumOf(fs, (f) => f.kmPerYear))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

/** One row of the rail quantities table: a label and a value per mode. */
interface QRow {
  label: string;
  indent?: boolean;
  value: (r: RailQuantities) => number | null;
  fmt: (v: number) => string;
  /** Summed in the total column (gradients are not). */
  additive?: boolean;
}

/** Purpose: the infrastructure quantities: rail per mode, and street lines one by one. */
function Infrastructure({ q, terrain }: { q: Quantities; terrain: "ready" | "failed" | "none" | null }) {
  const permille = (v: number) => `${fmtQty(v)} ‰`;
  const rows: QRow[] = [
    { label: "Route length", value: (r) => r.routeKm, fmt: km, additive: true },
    { label: "Track length", value: (r) => r.trackKm, fmt: km, additive: true },
    { label: "Double track", indent: true, value: (r) => r.doubleKm, fmt: km, additive: true },
    { label: "Single track", indent: true, value: (r) => r.singleKm, fmt: km, additive: true },
    ...STRUCTURES.map<QRow>((s) => ({
      label: STRUCTURE_LABEL[s],
      indent: true,
      value: (r) => r.byStructure[s],
      fmt: km,
      additive: true,
    })),
    ...LEVELS.map<QRow>((l) => ({
      label: `Stations ${LEVEL_LABEL[l].toLowerCase()}`,
      value: (r) => r.stations[l],
      fmt: int,
      additive: true,
    })),
    { label: "Platform edges", value: (r) => r.platformEdges, fmt: int, additive: true },
    { label: "Switches and crossings", value: (r) => r.switches, fmt: int, additive: true },
    { label: "Level crossings with streets", value: (r) => r.crossingsStreet, fmt: int, additive: true },
    { label: "Level crossings with paths", value: (r) => r.crossingsPath, fmt: int, additive: true },
    { label: "In streets, own lane", value: (r) => r.street.reserved, fmt: km, additive: true },
    { label: "In streets, in road traffic", value: (r) => r.street.mixed, fmt: km, additive: true },
    { label: "In a pedestrian zone", value: (r) => r.street.pedestrian_zone, fmt: km, additive: true },
    { label: "Lineside signals", value: (r) => r.signals, fmt: int, additive: true },
    { label: "Steepest gradient", value: (r) => r.steepest?.permille ?? null, fmt: permille },
  ];
  // Rows that are zero for every mode are left out, except the lengths and the gradient.
  const shown = rows.filter(
    (row, i) => i < 2 || !row.additive || q.rail.some((r) => (row.value(r) ?? 0) > 0.0005),
  );
  const total = q.rail.length > 1;
  return (
    <section aria-labelledby="infra-title" className="mt-10">
      <h2 id="infra-title" className="text-xl font-semibold tracking-tight">
        Infrastructure quantities
      </h2>
      <p className="mt-1 max-w-3xl text-slate-600">
        What the project builds: track by construction type (as set per track in the railway tool), stations,
        switches and crossings, and the streets the lines use.
      </p>
      {q.rail.length > 0 && (
        <section className={card} aria-labelledby="infra-rail">
          <h3 id="infra-rail" className="caps m-0">
            Railway
          </h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[24rem] text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className={th}>Quantity</th>
                  {q.rail.map((r) => (
                    <th key={r.mode} className={`${th} text-right`}>
                      {modeLabel(r.mode)}
                    </th>
                  ))}
                  {total && <th className={`${th} text-right`}>Total</th>}
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => {
                  const vals = q.rail.map((r) => row.value(r));
                  return (
                    <tr key={row.label} className="border-b border-slate-100">
                      <th
                        scope="row"
                        className={`${td} text-left font-normal ${row.indent ? "ps-6 text-slate-600" : ""}`}
                      >
                        {row.label}
                      </th>
                      {vals.map((v, i) => (
                        <td key={q.rail[i]!.mode} className={num}>
                          {v === null ? "—" : row.fmt(v)}
                          {row.label === "Steepest gradient" && q.rail[i]!.steepest && (
                            <span className="block text-xs text-slate-500">
                              {q.rail[i]!.steepest!.track}, limit {permille(q.rail[i]!.steepest!.limit)}
                            </span>
                          )}
                        </td>
                      ))}
                      {total && (
                        <td className={`${num} font-medium`}>
                          {row.additive ? row.fmt(sumOf(vals, (v) => v ?? 0)) : ""}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {terrain !== "ready" && (
            <p className="mt-3 text-xs text-slate-500">
              {terrain === "failed"
                ? "The terrain heights did not load, so some gradients are missing. Open the Tables tab again to retry."
                : "Gradients follow once the terrain heights load."}
            </p>
          )}
        </section>
      )}
      {q.street.length > 0 && (
        <section className={card} aria-labelledby="infra-street">
          <h3 id="infra-street" className="caps m-0">
            Street lines
          </h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className={th}>Line</th>
                  <th className={`${th} text-right`}>Route length</th>
                  <th className={`${th} text-right`}>Stops</th>
                  <th className={`${th} text-right`}>In bus lanes</th>
                  <th className={`${th} text-right`}>In road traffic</th>
                  <th className={`${th} text-right`}>Level crossings</th>
                </tr>
              </thead>
              <tbody>
                {q.street.map((s) => (
                  <tr key={s.id} className="border-b border-slate-100">
                    <td className={td}>
                      {s.name}
                      <span className="block text-xs text-slate-500">{modeLabel(s.mode)}</span>
                    </td>
                    <td className={num}>{km(s.routeKm)}</td>
                    <td className={num}>{int(s.stops)}</td>
                    <td className={num}>{km(s.busLaneKm)}</td>
                    <td className={num}>{km(s.mixedKm)}</td>
                    <td className={num}>{int(s.levelCrossings)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Route length is one direction; bus lanes and road traffic are over the round trip, on main roads.
          </p>
        </section>
      )}
    </section>
  );
}

type FactKey =
  | "name"
  | "length"
  | "stops"
  | "spacing"
  | "trip"
  | "speed"
  | "headway"
  | "hours"
  | "trips"
  | "fleet"
  | "places"
  | "capacity";

/** Purpose: the service and fleet of each line, sortable by any column. */
function ServiceAndFleet({ facts }: { facts: LineFact[] }) {
  const [sort, setSort] = useState<Sort<FactKey>>(null);
  const rows = sorted(facts, sort, (f, k) => {
    switch (k) {
      case "name":
        return f.name;
      case "length":
        return f.lengthKm;
      case "stops":
        return f.stops;
      case "spacing":
        return f.spacingM ?? 0;
      case "trip":
        return f.tripMin ?? 0;
      case "speed":
        return f.speedKmh ?? 0;
      case "headway":
        return f.peakHeadwayMin ?? 0;
      case "hours":
        return f.serviceHours;
      case "trips":
        return f.tripsPerDay;
      case "fleet":
        return f.fleet;
      case "places":
        return f.placesPerVehicle;
      case "capacity":
        return f.capacityPerHour;
    }
  });
  const H = (label: string, k: FactKey, right = true) => (
    <SortHeader label={label} k={k} sort={sort} setSort={setSort} right={right} />
  );
  const dash = "—";
  const sub = (text: ReactNode) => <span className="block text-xs text-slate-500">{text}</span>;
  const assumedHours = facts.some((f) => f.hoursAssumed);
  const assumedPlaces = facts.some((f) => f.placesAssumed);
  return (
    <section aria-labelledby="service-title" className="mt-10">
      <h2 id="service-title" className="text-xl font-semibold tracking-tight">
        Service and fleet
      </h2>
      <p className="mt-1 max-w-3xl text-slate-600">
        Each line's frequency, operating hours, trips, fleet and the places it offers, on a weekday. Fleet and
        vehicle-km are the same as in the cost tables.
      </p>
      {facts.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-5 text-slate-600">
          No lines yet. Add a service line in the railway tool or draw a street line.
        </p>
      ) : (
        <section className={card} aria-label="Service and fleet per line">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[64rem] text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  {H("Line", "name", false)}
                  {H("Length", "length")}
                  {H("Stops", "stops")}
                  {H("Stop spacing", "spacing")}
                  {H("Trip time", "trip")}
                  {H("Average speed", "speed")}
                  {H("Every", "headway")}
                  {H("Service hours", "hours")}
                  {H("Trips a day", "trips")}
                  {H("Fleet", "fleet")}
                  {H("Places per vehicle", "places")}
                  {H("Capacity an hour", "capacity")}
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.id} className="border-b border-slate-100">
                    <td className={td}>
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="inline-block h-3 w-3 shrink-0 rounded-full"
                          style={{ background: f.color }}
                        />
                        <span className="font-medium">{f.name}</span>
                      </span>
                      {sub(f.problem ? `${modeLabel(f.mode)}. ${f.problem}` : modeLabel(f.mode))}
                    </td>
                    <td className={num}>{km(f.lengthKm)}</td>
                    <td className={num}>{int(f.stops)}</td>
                    <td className={num}>{f.spacingM === null ? dash : `${int(f.spacingM)} m`}</td>
                    <td className={num}>{f.tripMin === null ? dash : `${fmtQty(f.tripMin)} min`}</td>
                    <td className={num}>{f.speedKmh === null ? dash : `${fmtQty(f.speedKmh)} km/h`}</td>
                    <td className={num}>
                      {f.peakHeadwayMin === null ? dash : `${fmtQty(f.peakHeadwayMin)} min`}
                      {f.offpeakHeadwayMin !== null && sub(`off peak ${fmtQty(f.offpeakHeadwayMin)} min`)}
                    </td>
                    <td className={num}>
                      {`${fmtQty(f.serviceHours)} h`}
                      {f.firstMin !== null && f.lastMin !== null
                        ? sub(`${hhmm(f.firstMin)}–${hhmm(f.lastMin)}`)
                        : sub("assumed")}
                    </td>
                    <td className={num}>{int(f.tripsPerDay)}</td>
                    <td className={num}>
                      {int(f.fleet)}
                      {sub(`${int(f.inService)} at the peak`)}
                    </td>
                    <td className={num}>
                      {int(f.placesPerVehicle)}
                      {sub(f.vehicle ?? "assumed")}
                    </td>
                    <td className={num}>
                      {int(f.capacityPerHour)}
                      {sub("one direction")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="mt-3 list-disc ps-5 text-xs text-slate-500">
            <li>
              Rail lengths are straight between the stations a line calls at, as in the cost tables. Trip time
              includes the stops; average speed is length over trip time.
            </li>
            <li>
              Rail fleets count units: a line of 4 trains of 2 coupled units has a fleet of 8. Spares come
              from the assumption library (mode.spare_share).
            </li>
            {assumedHours && (
              <li>
                Street lines have no first and last departure yet, so their service hours are the library's
                (cost.service_hours_per_day).
              </li>
            )}
            {assumedPlaces && (
              <li>
                Street lines have no catalogue vehicle yet, so their places per vehicle are the library's
                (mode.vehicle_capacity). Rail lines use the chosen train's seats plus standing places.
              </li>
            )}
          </ul>
        </section>
      )}
    </section>
  );
}
