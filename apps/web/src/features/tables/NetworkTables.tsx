import { useEngineText } from "../../i18n/engine";
import { Fragment, type ReactNode, useMemo, useState } from "react";
import { card, fmtQty, num, type Sort, SortHeader, sorted, td, th, Tile } from "../costs/CostTables";
import { EnergySection } from "../energy/EnergySection";
import type { EnergyEstimate } from "../energy/types";
import { energyInTables } from "../energy/params";
import type { EnergyEngineLoader } from "../energy/types";
import { hhmm } from "../railways/serviceLines";
import { useModeLabel } from "../schematic/common";
import { type Translate, type TranslatePlural, useI18n } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/messages";
import type { Network, RailEngineLoader } from "../railways/types";
import type { StreetLinesDoc } from "../street-lines/saved";
import type { PreferencesDoc } from "../../workspace/preferences";
import type { Triple } from "../benefits/params";
import { type LineFact, lineFacts } from "./lineFacts";
import { activePlugins } from "../../plugins/registry";
import { ferryLines, type FerryLine } from "./ferries";
import { ropewayLines, type RopewayLine } from "./ropeways";
import type { SavedPluginLine } from "../../kits/saved";
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
import { TablePart } from "./sections";

interface Props {
  railway: Network | null;
  streetLines: StreetLinesDoc | null;
  /** The plugin tools' lines by line key (the cable cars and ferries are listed). */
  pluginLines?: Readonly<Record<string, SavedPluginLine>>;
  preferences: PreferencesDoc | null;
  /** Saves the project's own values (the energy section's grid intensity and battery bus share). */
  onPreferences?: (d: PreferencesDoc) => void;
  /**
   * Projected riders a weekday per line id (low, medium, high), from the benefit estimate; null while it
   * is not ready.
   */
  riders?: Record<string, Triple> | null;
  /** Told the energy section's estimate (the multi-year run takes the energy a year from it). */
  onEnergy?: (e: EnergyEstimate | null) => void;
  /** Tests inject these. */
  loadRail?: RailEngineLoader;
  loadEnergy?: EnergyEngineLoader;
  fetchHeights?: HeightsFetcher;
}

const int = (v: number) => new Intl.NumberFormat("en").format(Math.round(v));
const compact = (v: number) =>
  new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v);
const sumOf = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);
/** Purpose: kilometres in the language's unit format. */
const kmIn = (t: Translate) => (v: number) => t("tbl.u.km", { v: fmtQty(v) });
/** Purpose: a count with the language's plural form, the count in this table's number format. */
const plural = (tn: TranslatePlural, key: "net.modes", n: number) => tn(key, n, { count: int(n) });

/**
 * The network tables of the Tables tab: a summary of the project, its infrastructure quantities, the
 * service and fleet of each line, and, with the energy plugin, their energy and emissions, in the chosen language.
 * Side effects: builds the railway with the rail engine and loads the terrain heights under it.
 */
export function NetworkTables({
  railway,
  streetLines,
  pluginLines,
  preferences,
  onPreferences,
  riders = null,
  onEnergy,
  loadRail,
  loadEnergy,
  fetchHeights,
}: Props) {
  const { t } = useI18n();
  const engineText = useEngineText();
  const { build, error } = useRailBuild(railway, loadRail, fetchHeights);
  const prefs = preferences?.values;
  const lines = streetLines?.lines ?? [];
  // The cable car plugin may be turned off for the project: its lines then leave the tables.
  const plugins = activePlugins();
  const ropeways = useMemo(() => ropewayLines(pluginLines, undefined, plugins), [pluginLines, plugins]);
  const ferries = useMemo(() => ferryLines(pluginLines, undefined, plugins), [pluginLines, plugins]);
  const facts = useMemo(
    () =>
      lineFacts({
        railway,
        view: build?.view ?? null,
        reports: build?.reports ?? {},
        streetLines: lines,
        prefs,
        ropeways,
        ferries,
        t,
        engineText,
      }),
    [railway, build, lines, prefs, ropeways, ferries, t, engineText],
  );
  const q = useMemo(() => quantities(railway, build?.view ?? null, lines, t), [railway, build, lines, t]);
  const waiting = !!railway?.tracks.length && !build && !error;
  const empty = !facts.length && !q.rail.length && !q.street.length;

  return (
    <div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {t("tbl.railwayUnreadable", { error })}
        </p>
      )}
      {waiting ? (
        <p role="status" className="mt-6 text-slate-500">
          {t("net.measuring")}
        </p>
      ) : empty ? (
        <section aria-labelledby="summary-title" className="mt-6">
          <h2 id="summary-title" className="text-xl font-semibold tracking-tight">
            {t("net.summary")}
          </h2>
          <p className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-5 text-slate-600">
            {t("net.nothing")}
          </p>
        </section>
      ) : (
        <>
          <TablePart id="network.summary">
            <Summary facts={facts} q={q} ropeways={ropeways} ferries={ferries} />
          </TablePart>
          <TablePart id="network.infrastructure">
            <Infrastructure q={q} terrain={build?.terrain ?? null} />
          </TablePart>
          <TablePart id="network.service">
            <ServiceAndFleet facts={facts} riders={riders} />
          </TablePart>
          {energyInTables() && (
            <TablePart id="network.energy">
              <EnergySection
                facts={facts}
                preferences={preferences}
                onPreferences={onPreferences}
                loadEngine={loadEnergy}
                onEstimate={onEnergy}
              />
            </TablePart>
          )}
        </>
      )}
    </div>
  );
}

/** Purpose: the project at a glance: size, fleet and service, in total and per mode. */
function Summary({
  facts,
  q,
  ropeways,
  ferries,
}: {
  facts: LineFact[];
  q: Quantities;
  ropeways: RopewayLine[];
  ferries: FerryLine[];
}) {
  const { t, tn } = useI18n();
  const modeLabel = useModeLabel();
  const km = kmIn(t);
  const railKm = sumOf(q.rail, (r) => r.routeKm);
  const streetKm = sumOf(q.street, (s) => s.routeKm);
  const stations = sumOf(q.rail, (r) => sumOf(LEVELS, (l) => r.stations[l]));
  const stops = sumOf(q.street, (s) => s.stops);
  const ropeKm = sumOf(ropeways, (r) => r.lengthKm);
  const ropeStations = sumOf(ropeways, (r) => r.stations);
  const ferryKm = sumOf(ferries, (f) => f.lengthKm);
  const piers = sumOf(ferries, (f) => f.piers);
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
        {t("net.summary")}
      </h2>
      <p className="mt-1 max-w-3xl text-slate-600">{t("net.summaryIntro")}</p>
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile title={t("tbl.lines")} value={int(facts.length)} sub={plural(tn, "net.modes", modes.length)} />
        <Tile
          title={t("tbl.routeLength")}
          value={km(railKm + streetKm + ropeKm + ferryKm)}
          sub={
            ferryKm > 0
              ? ropeKm > 0
                ? t("net.routeSubCableFerry", {
                    rail: km(railKm),
                    street: km(streetKm),
                    cable: km(ropeKm),
                    ferry: km(ferryKm),
                  })
                : t("net.routeSubFerry", { rail: km(railKm), street: km(streetKm), ferry: km(ferryKm) })
              : ropeKm > 0
                ? t("net.routeSubCable", { rail: km(railKm), street: km(streetKm), cable: km(ropeKm) })
                : t("net.routeSub", { rail: km(railKm), street: km(streetKm) })
          }
        />
        <Tile
          title={t("net.stationsAndStops")}
          value={int(stations + ropeStations + piers + stops)}
          sub={t("net.stationsSub", { stations: int(stations + ropeStations + piers), stops: int(stops) })}
        />
        <Tile title={t("tbl.fleetSpares")} value={int(fleet)} sub={t("net.inServiceSub", { n: int(peak) })} />
        <Tile
          title={t("tbl.vehicleKmYear")}
          value={new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(
            sumOf(facts, (f) => f.kmPerYear),
          )}
          sub={t("net.vkmSub")}
        />
        <Tile
          title={t("net.peakCapacity")}
          value={int(sumOf(facts, (f) => f.capacityPerHour))}
          sub={t("net.peakCapacitySub")}
        />
        <Tile title={t("tbl.inTunnel")} value={km(tunnels)} sub={t("net.tunnelSub")} />
        <Tile title={t("tbl.onBridges")} value={km(bridges)} sub={t("net.routeLengthSub")} />
      </div>
      <section className={card} aria-labelledby="summary-by-mode">
        <h3 id="summary-by-mode" className="caps m-0">
          {t("tbl.perMode")}
        </h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className={th}>{t("tbl.mode")}</th>
                <th className={`${th} text-right`}>{t("tbl.lines")}</th>
                <th className={`${th} text-right`}>{t("tbl.routeLength")}</th>
                <th className={`${th} text-right`}>{t("net.stationsOrStops")}</th>
                <th className={`${th} text-right`}>{t("tbl.fleet")}</th>
                <th className={`${th} text-right`}>{t("tbl.vehicleKmYear")}</th>
              </tr>
            </thead>
            <tbody>
              {modes.map((m) => {
                const r = q.rail.find((x) => x.mode === m);
                const ss = q.street.filter((x) => x.mode === m);
                const rs = ropeways.filter((x) => x.mode === m);
                const fe = ferries.filter((x) => x.mode === m);
                const fs = facts.filter((f) => f.mode === m);
                return (
                  <tr key={m} className="border-b border-slate-100">
                    <td className={td}>{modeLabel(m)}</td>
                    <td className={num}>{int(fs.length)}</td>
                    <td className={num}>
                      {km(
                        (r?.routeKm ?? 0) +
                          sumOf(ss, (s) => s.routeKm) +
                          sumOf(rs, (x) => x.lengthKm) +
                          sumOf(fe, (x) => x.lengthKm),
                      )}
                    </td>
                    <td className={num}>
                      {int(
                        (r ? sumOf(LEVELS, (l) => r.stations[l]) : 0) +
                          sumOf(ss, (s) => s.stops) +
                          sumOf(rs, (x) => x.stations) +
                          sumOf(fe, (x) => x.piers),
                      )}
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
  /** Identifies the row (its message key). */
  id: string;
  label: string;
  indent?: boolean;
  value: (r: RailQuantities) => number | null;
  fmt: (v: number) => string;
  /** Summed in the total column (gradients are not). */
  additive?: boolean;
}

/** Purpose: the infrastructure quantities: rail per mode, and street lines one by one. */
function Infrastructure({ q, terrain }: { q: Quantities; terrain: "ready" | "failed" | "none" | null }) {
  const { t } = useI18n();
  const modeLabel = useModeLabel();
  const km = kmIn(t);
  const permille = (v: number) => `${fmtQty(v)} ‰`;
  const row = (id: MessageKey, value: QRow["value"], fmt: QRow["fmt"], indent = false): QRow => ({
    id,
    label: t(id),
    indent,
    value,
    fmt,
    additive: true,
  });
  const rows: QRow[] = [
    row("tbl.routeLength", (r) => r.routeKm, km),
    row("tbl.trackLength", (r) => r.trackKm, km),
    row("net.doubleTrack", (r) => r.doubleKm, km, true),
    row("net.singleTrack", (r) => r.singleKm, km, true),
    ...STRUCTURES.map((s) => row(STRUCTURE_LABEL[s], (r) => r.byStructure[s], km, true)),
    ...LEVELS.map((l) => row(LEVEL_LABEL[l], (r) => r.stations[l], int)),
    row("net.platformEdges", (r) => r.platformEdges, int),
    row("cost.cat.switches", (r) => r.switches, int),
    row("net.crossingsStreet", (r) => r.crossingsStreet, int),
    row("net.crossingsPath", (r) => r.crossingsPath, int),
    row("net.streetOwnLane", (r) => r.street.reserved, km),
    row("net.streetMixed", (r) => r.street.mixed, km),
    row("net.pedestrianZone", (r) => r.street.pedestrian_zone, km),
    row("net.signals", (r) => r.signals, int),
    { ...row("net.steepest", (r) => r.steepest?.permille ?? null, permille), additive: false },
  ];
  // Rows that are zero for every mode are left out, except the lengths and the gradient.
  const shown = rows.filter(
    (row, i) => i < 2 || !row.additive || q.rail.some((r) => (row.value(r) ?? 0) > 0.0005),
  );
  const total = q.rail.length > 1;
  return (
    <section aria-labelledby="infra-title" className="mt-10">
      <h2 id="infra-title" className="text-xl font-semibold tracking-tight">
        {t("net.infra")}
      </h2>
      <p className="mt-1 max-w-3xl text-slate-600">{t("net.infraIntro")}</p>
      {q.rail.length > 0 && (
        <section className={card} aria-labelledby="infra-rail">
          <h3 id="infra-rail" className="caps m-0">
            {t("net.railway")}
          </h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[24rem] text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className={th}>{t("tbl.quantity")}</th>
                  {q.rail.map((r) => (
                    <th key={r.mode} className={`${th} text-right`}>
                      {modeLabel(r.mode)}
                    </th>
                  ))}
                  {total && <th className={`${th} text-right`}>{t("tbl.total")}</th>}
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => {
                  const vals = q.rail.map((r) => row.value(r));
                  return (
                    <tr key={row.id} className="border-b border-slate-100">
                      <th
                        scope="row"
                        className={`${td} text-left font-normal ${row.indent ? "ps-6 text-slate-600" : ""}`}
                      >
                        {row.label}
                      </th>
                      {vals.map((v, i) => (
                        <td key={q.rail[i]!.mode} className={num}>
                          {v === null ? "—" : row.fmt(v)}
                          {row.id === "net.steepest" && q.rail[i]!.steepest && (
                            <span className="block text-xs text-slate-500">
                              {t("net.steepestSub", {
                                track: q.rail[i]!.steepest!.track,
                                limit: permille(q.rail[i]!.steepest!.limit),
                              })}
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
              {terrain === "failed" ? t("net.terrainFailed") : t("net.terrainWaiting")}
            </p>
          )}
        </section>
      )}
      {q.street.length > 0 && (
        <section className={card} aria-labelledby="infra-street">
          <h3 id="infra-street" className="caps m-0">
            {t("net.streetLines")}
          </h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className={th}>{t("tbl.line")}</th>
                  <th className={`${th} text-right`}>{t("tbl.routeLength")}</th>
                  <th className={`${th} text-right`}>{t("tbl.stops")}</th>
                  <th className={`${th} text-right`}>{t("net.inBusLanes")}</th>
                  <th className={`${th} text-right`}>{t("net.inRoadTraffic")}</th>
                  <th className={`${th} text-right`}>{t("net.levelCrossings")}</th>
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
          <p className="mt-3 text-xs text-slate-500">{t("net.streetNote")}</p>
        </section>
      )}
    </section>
  );
}

type FactKey =
  | "name"
  | "length"
  | "stops"
  | "trip"
  | "headway"
  | "hours"
  | "trips"
  | "fleet"
  | "places"
  | "capacity"
  | "riders";

/** Purpose: the service and fleet of each line, sortable by any column. */
function ServiceAndFleet({ facts, riders }: { facts: LineFact[]; riders: Record<string, Triple> | null }) {
  const { t } = useI18n();
  const modeLabel = useModeLabel();
  const km = kmIn(t);
  const min = (v: number) => t("tbl.u.min", { v: fmtQty(v) });
  const [sort, setSort] = useState<Sort<FactKey>>(null);
  const rows = sorted(facts, sort, (f, k) => {
    switch (k) {
      case "name":
        return f.name;
      case "length":
        return f.lengthKm;
      case "stops":
        return f.stops;
      case "trip":
        return f.tripMin ?? 0;
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
      case "riders":
        return riders?.[f.id]?.[1] ?? -1;
    }
  });
  const H = (label: string, k: FactKey, right = true) => (
    <SortHeader label={label} k={k} sort={sort} setSort={setSort} right={right} />
  );
  const dash = "—";
  const sub = (text: ReactNode) => <span className="block text-xs text-slate-500">{text}</span>;
  const assumedPlaces = facts.some((f) => f.placesAssumed);
  return (
    <section aria-labelledby="service-title" className="mt-10">
      <h2 id="service-title" className="text-xl font-semibold tracking-tight">
        {t("net.service")}
      </h2>
      <p className="mt-1 max-w-3xl text-slate-600">{t("net.serviceIntro")}</p>
      {facts.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-5 text-slate-600">
          {t("tbl.noLines")}
        </p>
      ) : (
        <section className={card} aria-label={t("net.serviceAria")}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[55rem] text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  {H(t("tbl.line"), "name", false)}
                  {H(t("tbl.length"), "length")}
                  {H(t("tbl.stops"), "stops")}
                  {H(t("net.tripTime"), "trip")}
                  {H(t("net.every"), "headway")}
                  {H(t("net.serviceHours"), "hours")}
                  {H(t("net.trips"), "trips")}
                  {H(t("tbl.fleet"), "fleet")}
                  {H(t("net.places"), "places")}
                  {H(t("net.capacity"), "capacity")}
                  {H(t("net.ridersDay"), "riders")}
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => (
                  <Fragment key={f.id}>
                    <tr className={f.problem ? "" : "border-b border-slate-100"}>
                      <td className={`${td} min-w-[9rem]`}>
                        <span className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className="inline-block h-3 w-3 shrink-0 rounded-full"
                            style={{ background: f.color }}
                          />
                          <span className="font-medium">{f.name}</span>
                        </span>
                        {sub(f.vehicle ? `${modeLabel(f.mode)}, ${f.vehicle}` : modeLabel(f.mode))}
                      </td>
                      <td className={num}>{km(f.lengthKm)}</td>
                      <td className={num}>
                        {int(f.stops)}
                        {f.spacingM !== null && sub(t("net.spacing", { m: int(f.spacingM) }))}
                      </td>
                      <td className={num}>
                        {f.tripMin === null ? dash : min(f.tripMin)}
                        {f.speedKmh !== null && sub(t("tbl.u.kmh", { v: fmtQty(f.speedKmh) }))}
                      </td>
                      <td className={num}>
                        {f.peakHeadwayMin === null
                          ? dash
                          : f.peakHeadwayMin < 1
                            ? t("tbl.u.s", { v: fmtQty(f.peakHeadwayMin * 60) })
                            : min(f.peakHeadwayMin)}
                        {f.offpeakHeadwayMin !== null &&
                          sub(t("net.offPeak", { min: fmtQty(f.offpeakHeadwayMin) }))}
                      </td>
                      <td className={num}>
                        {t("tbl.u.h", { v: fmtQty(f.serviceHours) })}
                        {f.firstMin !== null && f.lastMin !== null
                          ? sub(`${hhmm(f.firstMin)}–${hhmm(f.lastMin)}`)
                          : sub(t("net.assumed"))}
                      </td>
                      <td className={num}>
                        {int(f.tripsPerDay)}
                        {sub(t("net.aDay"))}
                      </td>
                      <td className={num}>
                        {int(f.fleet)}
                        {sub(t("net.atPeak", { n: int(f.inService) }))}
                      </td>
                      <td className={num}>
                        {int(f.placesPerVehicle)}
                        {sub(
                          t(
                            f.placesAssumed
                              ? "net.assumed"
                              : f.kind === "rail"
                                ? "net.perTrain"
                                : f.kind === "ropeway"
                                  ? "net.perCabin"
                                  : f.kind === "ferry"
                                    ? "net.perVessel"
                                    : "net.perVehicle",
                          ),
                        )}
                      </td>
                      <td className={num}>
                        {int(f.capacityPerHour)}
                        {sub(t("net.perHour"))}
                      </td>
                      <td className={num}>
                        {riders?.[f.id] ? (
                          <>
                            {int(riders[f.id]![1])}
                            {sub(`${compact(riders[f.id]![0])}–${compact(riders[f.id]![2])}`)}
                            {f.placesPerVehicle * f.tripsPerDay > 0 &&
                              sub(
                                t("net.ofPlaces", {
                                  pct: int((100 * riders[f.id]![1]) / (f.placesPerVehicle * f.tripsPerDay)),
                                }),
                              )}
                          </>
                        ) : (
                          dash
                        )}
                      </td>
                    </tr>
                    {f.problem && (
                      <tr className="border-b border-slate-100">
                        <td colSpan={11} className="px-2 pb-2 text-xs text-amber-800">
                          {t("net.noFigures", { problem: f.problem })}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="mt-3 list-disc ps-5 text-xs text-slate-500">
            <li>{t("net.note.capacity")}</li>
            <li>{t("net.note.fleet")}</li>
            <li>
              {t("net.note.riders")}
              {riders ? "" : ` ${t("net.note.ridersWaiting")}`}
            </li>
            {assumedPlaces && <li>{t("net.note.places")}</li>}
          </ul>
        </section>
      )}
    </section>
  );
}
