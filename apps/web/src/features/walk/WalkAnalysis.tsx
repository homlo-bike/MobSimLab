import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatInt, hasMessage, tNow, useI18n } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/messages";
import { fetchPopulation, type PopulationFetcher, type PopulationSource } from "../noise/population";
import { loadRailEngine } from "../railways/engine";
import type { Network, RailEngineLoader } from "../railways/types";
import { fetchWalkTile, loadWalkEngine } from "../street-lines/engine";
import type { StreetLinesDoc } from "../street-lines/saved";
import { drawWalk, type GapPoint, removeWalk, type SpacingPair } from "./mapLayer";
import {
  BAND_COLORS,
  GAP_CELL_M,
  MAX_MINUTES,
  MAX_WALK_TILES,
  MIN_MINUTES,
  mergeNetworks,
  peopleDemand,
  type ProjectLine,
  type ProjectNetwork,
  railNetwork,
  ruleMinutes,
  spacingGuidance,
  stopPoints,
  streetNetwork,
  studyArea,
  walkSettings,
  walkTiles,
} from "./model";
import type {
  CatchmentGeoJson,
  CoverageResult,
  LonLat,
  SpacingResult,
  WalkEngine,
  WalkEngineLoader,
  WalkTileFetcher,
} from "./types";

interface Props {
  map: MapLibreMap | null;
  streetLines: StreetLinesDoc | null;
  railway: Network | null;
  /** Project preferences: `analysis.walk_rule_minutes`, `demand.walk_speed_kmh`, `walk.crossing_delay_s`. */
  preferences?: Record<string, number>;
  /** Tests inject these. */
  loadWalk?: WalkEngineLoader;
  loadRail?: RailEngineLoader;
  fetchTile?: WalkTileFetcher;
  fetchPeople?: PopulationFetcher;
}

/** Gaps listed and drawn. */
const GAPS = 10;

type Coverage =
  | { kind: "idle" }
  | { kind: "busy"; step: string }
  | {
      kind: "done";
      minutes: number;
      result: CoverageResult;
      catchment: CatchmentGeoJson;
      people: PopulationSource | null;
      notes: string[];
    }
  | { kind: "error"; text: string };

/** Spacing of one direction of a line. */
interface LineSpacing {
  line: ProjectLine;
  direction: number;
  result: SpacingResult;
}

/**
 * Purpose: the walk coverage, its gaps and the stop spacing in the GIS tab (ADR-0035 §5–§6 on the project's
 * own lines): how much of the area round the saved street lines and railway stations is within the walk
 * rule (15 minutes by default) along streets and footpaths, the largest places beyond it, and the distance
 * between consecutive stops against the mode's usual range.
 * Side effects: loads the walk tiles and the population grid from the API on demand; draws the walk
 * network, the gaps and the flagged stop pairs on the map while shown.
 */
export function WalkAnalysis({
  map,
  streetLines,
  railway,
  preferences,
  loadWalk = loadWalkEngine,
  loadRail = loadRailEngine,
  fetchTile = fetchWalkTile,
  fetchPeople = fetchPopulation,
}: Props) {
  const { t } = useI18n();
  const [minutes, setMinutes] = useState(() => ruleMinutes(preferences));
  const [stepFree, setStepFree] = useState(false);
  const [onMap, setOnMap] = useState(true);
  const [coverage, setCoverage] = useState<Coverage>({ kind: "idle" });
  const [rail, setRail] = useState<ProjectNetwork>({ stops: [], lines: [] });
  const [spacing, setSpacing] = useState<LineSpacing[] | null>(null);
  // The engine with the walk network of the last calculation (on-foot distances for the spacing).
  const engine = useRef<WalkEngine | null>(null);
  const [graphVersion, setGraphVersion] = useState(0);

  // The railway's stations where they are built (the rail engine places them).
  const railKey = JSON.stringify(railway ?? null);
  useEffect(() => {
    let live = true;
    if (!railway?.stations.length) {
      setRail({ stops: [], lines: [] });
      return;
    }
    void loadRail()
      .then((e) => {
        try {
          const view = e.build(railway, null);
          if (live) setRail(railNetwork(railway, view));
        } finally {
          e.dispose();
        }
      })
      .catch(() => live && setRail({ stops: [], lines: [] }));
    return () => {
      live = false;
    };
  }, [railKey, loadRail]);

  const streetKey = JSON.stringify(streetLines ?? null);
  const network = useMemo(() => mergeNetworks(streetNetwork(streetLines), rail), [streetKey, rail]);
  const names = useMemo(() => new Map(network.stops.map((s) => [s.id, s])), [network]);

  useEffect(
    () => () => {
      engine.current?.dispose();
      engine.current = null;
      if (map) removeWalk(map);
    },
    [map],
  );

  // Stop spacing: along each direction, and on foot once a walk network is loaded.
  useEffect(() => {
    let live = true;
    if (!network.lines.length) {
      setSpacing([]);
      return;
    }
    const settings = walkSettings(preferences, stepFree);
    void (async () => {
      const own = engine.current ? null : await loadWalk();
      const e = engine.current ?? own!;
      try {
        const out: LineSpacing[] = [];
        for (const line of network.lines) {
          const g = spacingGuidance(line.mode);
          line.directions.forEach((d, i) => {
            const stops = d.stops.flatMap((id) => {
              const s = names.get(id);
              return s ? [{ id, lon: s.lonlat[0], lat: s.lonlat[1] }] : [];
            });
            if (stops.length < 2) return;
            const result = e.spacing({
              stops,
              route: d.route,
              guidance_m: g ? [g[0], g[2]] : null,
              settings,
            });
            out.push({ line, direction: i, result });
          });
        }
        if (live) setSpacing(out);
      } catch {
        if (live) setSpacing([]);
      } finally {
        own?.dispose();
      }
    })();
    return () => {
      live = false;
    };
  }, [network, names, graphVersion, loadWalk]);

  const gaps: GapPoint[] = useMemo(
    () =>
      coverage.kind === "done"
        ? coverage.result.uncovered.slice(0, GAPS).map((u, i) => ({
            lonlat: [u.lon, u.lat] as LonLat,
            rank: i + 1,
            minutes: u.nearest === null ? null : u.nearest / 60,
          }))
        : [],
    [coverage],
  );
  const pairs: SpacingPair[] = useMemo(
    () =>
      (spacing ?? []).flatMap((s) =>
        s.result.segments.flatMap((g) => {
          const a = names.get(g.from);
          const b = names.get(g.to);
          return a && b && g.flag ? [{ from: a.lonlat, to: b.lonlat, flag: g.flag }] : [];
        }),
      ),
    [spacing, names],
  );

  // Draw what is calculated while the map layer is on.
  useEffect(() => {
    if (!map) return;
    if (!onMap) {
      removeWalk(map);
      return;
    }
    drawWalk(map, {
      catchment: coverage.kind === "done" ? coverage.catchment : null,
      gaps,
      spacing: pairs,
    });
  }, [map, onMap, coverage, gaps, pairs]);

  async function compute() {
    const limit = Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(minutes)));
    try {
      setCoverage({ kind: "busy", step: tNow("walk.collecting") });
      const stops = network.stops;
      if (!stops.length) {
        setCoverage({ kind: "error", text: tNow("walk.drawFirst") });
        return;
      }
      const settings = walkSettings(preferences, stepFree);
      const reach = (limit / 60) * settings.walk_speed_kmh * 1000;
      const area = studyArea(stops, reach)!;
      const tiles = walkTiles(area);
      if (tiles.length > MAX_WALK_TILES) {
        setCoverage({
          kind: "error",
          text: tNow("walk.tooLarge", { tiles: tiles.length, max: MAX_WALK_TILES }),
        });
        return;
      }
      const e = await loadWalk();
      try {
        let done = 0;
        for (const [x, y] of tiles) {
          setCoverage({
            kind: "busy",
            step: tNow("walk.loadingTiles", { done, count: tiles.length }),
          });
          e.addOsm(await fetchTile(x, y));
          done++;
        }
        e.build();
      } catch (err) {
        e.dispose();
        throw err;
      }
      engine.current?.dispose();
      engine.current = e;
      setGraphVersion((v) => v + 1);

      const notes: string[] = [];
      let people: PopulationSource | null = null;
      let demand = null;
      setCoverage({ kind: "busy", step: tNow("walk.loadingPopulation") });
      try {
        const a = await fetchPeople(area);
        if (a.status === "ready") {
          demand = peopleDemand(a.grid, area);
          people = a.source;
          if (!demand.length) demand = null;
        } else if (a.status === "loading")
          notes.push(tNow("walk.popDownloading", { countries: a.countries.join(", ") }));
        else notes.push(tNow("walk.popUnavailable", { reason: a.reason }));
      } catch (err) {
        notes.push(tNow("walk.popUnavailable", { reason: err instanceof Error ? err.message : String(err) }));
      }
      if (!demand) people = null;

      setCoverage({ kind: "busy", step: tNow("walk.computing") });
      await new Promise((r) => setTimeout(r, 30));
      const points = stopPoints(stops);
      const result = e.coverage({
        stops: points,
        groups: [
          { label: `${limit} min`, stops: points.map((_, i) => i), metric: "time", limit: limit * 60 },
        ],
        demand,
        study_area: area,
        settings,
        list_uncovered: GAPS,
        street_cells_m: demand ? null : GAP_CELL_M,
      });
      const catchment = e.catchment(points, limit, settings);
      if (result.stops_off_network.length)
        notes.push(
          tNow("walk.offNetwork", {
            stops: result.stops_off_network.map((id) => names.get(id)?.name ?? id).join(", "),
          }),
        );
      setCoverage({ kind: "done", minutes: limit, result, catchment, people, notes });
    } catch (err) {
      setCoverage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    }
  }

  const flyTo = (at: LonLat) => map?.flyTo({ center: at, zoom: Math.max(map.getZoom(), 15.5) });
  const hasStops = network.stops.length > 0;
  const pct = (v: number) => (Math.round(v * 1000) / 10).toLocaleString();
  const r = coverage.kind === "done" ? coverage.result : null;
  const byPeople = r?.demand_kind === "points";

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2" aria-label={t("walk.title")}>
        <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">{t("walk.title")}</h3>
        <p className="text-xs text-slate-600">{t("walk.intro")}</p>
        <label className="flex items-center justify-between gap-2 text-xs">
          {t("walk.minutes")}
          <input
            type="number"
            min={MIN_MINUTES}
            max={MAX_MINUTES}
            step={1}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="w-20 rounded border border-slate-300 px-2 py-1 text-end tabular-nums"
          />
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={stepFree} onChange={(e) => setStepFree(e.target.checked)} />
          {t("walk.stepFree")}
        </label>
        <button
          type="button"
          className="btn min-h-10"
          disabled={!hasStops || coverage.kind === "busy"}
          onClick={() => void compute()}
        >
          {t(coverage.kind === "done" ? "walk.computeAgain" : "walk.compute")}
        </button>
        {!hasStops && <p className="text-xs text-slate-500">{t("walk.drawFirst")}</p>}
        {coverage.kind === "busy" && (
          <p role="status" className="text-xs text-slate-600">
            {coverage.step}
          </p>
        )}
        {coverage.kind === "error" && (
          <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{coverage.text}</p>
        )}
        {coverage.kind === "done" && r && (
          <>
            <p className="rounded bg-blue-50 px-2 py-1.5 text-sm text-blue-950" role="status">
              {byPeople
                ? t("walk.headlinePeople", {
                    share: pct(r.share),
                    total: formatInt(Math.round(r.total)),
                    minutes: coverage.minutes,
                  })
                : t("walk.headlineStreets", { share: pct(r.share), minutes: coverage.minutes })}
            </p>
            <p className="text-xs text-slate-600">{t("walk.crowFlies", { share: pct(r.buffer_share) })}</p>
            <table className="w-full text-xs" aria-label={t("walk.bands")}>
              <thead>
                <tr className="text-start text-slate-500">
                  <th className="text-start font-normal">{t("walk.bands")}</th>
                  <th className="text-end font-normal">{t(byPeople ? "walk.residents" : "walk.streets")}</th>
                </tr>
              </thead>
              <tbody>
                {r.minutes_bands.map((b) => (
                  <tr key={b.from_min} className="border-t border-slate-100">
                    <td className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-sm"
                        style={{
                          background: BAND_COLORS[Math.min(BAND_COLORS.length - 1, b.from_min / 5)],
                        }}
                      />
                      {b.to_min === null
                        ? t("walk.bandOver", { from: b.from_min })
                        : t("walk.band", { from: b.from_min, to: b.to_min })}
                    </td>
                    <td className="text-end tabular-nums">
                      {r.total > 0 ? `${pct(b.demand / r.total)} %` : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h4 className="mt-1 text-xs font-semibold text-slate-700">{t("walk.gaps")}</h4>
            {gaps.length === 0 ? (
              <p className="text-xs text-slate-600">{t("walk.noGaps")}</p>
            ) : (
              <>
                <p className="text-xs text-slate-600">
                  {t(byPeople ? "walk.gapsIntro" : "walk.gapsIntroStreets")}
                </p>
                <ol className="flex flex-col gap-1">
                  {gaps.map((g, i) => {
                    const u = r.uncovered[i]!;
                    return (
                      <li key={g.rank}>
                        <button
                          type="button"
                          onClick={() => flyTo(g.lonlat)}
                          className="flex w-full items-center gap-2 rounded border border-slate-200 px-2 py-1.5 text-start text-xs hover:border-blue-700"
                        >
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-600 text-[11px] font-semibold text-white">
                            {g.rank}
                          </span>
                          <span className="flex-1">
                            {byPeople
                              ? t("walk.gapPeople", { people: formatInt(Math.round(u.weight)) })
                              : t("walk.gapStreets", { metres: formatInt(Math.round(u.weight)) })}
                            {" · "}
                            {g.minutes === null
                              ? t("walk.gapUnreachable")
                              : t("walk.gapWalk", { minutes: Math.round(g.minutes) })}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </>
            )}
            {coverage.notes.map((n) => (
              <p key={n} className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
                {n}
              </p>
            ))}
            <p className="text-xs text-slate-500">
              {t("walk.note")}
              {coverage.people
                ? ` ${t("walk.popCredit", { year: coverage.people.year, countries: coverage.people.countries.join(", ") })}`
                : ""}
            </p>
          </>
        )}
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={onMap} onChange={(e) => setOnMap(e.target.checked)} />
          {t("walk.showOnMap")}
        </label>
        {coverage.kind === "done" && onMap && (
          <div
            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600"
            aria-label={t("walk.legend")}
          >
            <span>{t("walk.legend")}:</span>
            {BAND_COLORS.slice(0, Math.ceil(coverage.minutes / 5)).map((c, i) => (
              <span key={c} className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-4 rounded-sm" style={{ background: c }} />
                {i * 5}–{Math.min((i + 1) * 5, coverage.minutes)}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-label={t("spacing.title")}>
        <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
          {t("spacing.title")}
        </h3>
        <p className="text-xs text-slate-600">{t("spacing.intro")}</p>
        {spacing === null && <p className="text-xs text-slate-600">{t("spacing.loading")}</p>}
        {spacing?.length === 0 && <p className="text-xs text-slate-500">{t("spacing.none")}</p>}
        {spacing?.map((s) => (
          <SpacingCard
            key={`${s.line.id}-${s.direction}`}
            item={s}
            directions={s.line.directions.length}
            names={names}
            onPick={flyTo}
            onFoot={coverage.kind === "done"}
          />
        ))}
        {!!spacing?.length && coverage.kind !== "done" && (
          <p className="text-xs text-slate-500">{t("spacing.onFootHint")}</p>
        )}
      </section>
    </div>
  );
}

function SpacingCard({
  item,
  directions,
  names,
  onPick,
  onFoot,
}: {
  item: LineSpacing;
  directions: number;
  names: Map<string, { name: string; lonlat: LonLat }>;
  onPick: (at: LonLat) => void;
  onFoot: boolean;
}) {
  const { t } = useI18n();
  const { line, result } = item;
  const g = spacingGuidance(line.mode);
  const m = (v: number) => formatInt(Math.round(v));
  const modeKey = `mode.${line.mode}`;
  const flagged = result.segments.filter((s) => s.flag);
  return (
    <div className="rounded border border-slate-200 px-2.5 py-2 text-xs">
      <p className="flex items-center gap-1.5 font-semibold text-slate-800">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: line.color }} />
        {line.name}
        <span className="font-normal text-slate-500">
          {hasMessage(modeKey) ? t(modeKey as MessageKey) : line.mode}
          {directions > 1 ? ` · ${t("spacing.direction", { n: item.direction + 1 })}` : ""}
        </span>
      </p>
      <p className="mt-1 text-slate-700">
        {t("spacing.summary", {
          median: m(result.along.median),
          min: m(result.along.min),
          max: m(result.along.max),
        })}
      </p>
      {g && <p className="text-slate-500">{t("spacing.guidance", { low: m(g[0]), high: m(g[2]) })}</p>}
      {g && (
        <p className={flagged.length ? "text-amber-800" : "text-emerald-700"}>
          {flagged.length
            ? t("spacing.flags", { short: result.short, long: result.long })
            : t("spacing.allOk")}
        </p>
      )}
      {flagged.length > 0 && (
        <ul className="mt-1 flex flex-col gap-1">
          {flagged.map((s) => {
            const a = names.get(s.from);
            const b = names.get(s.to);
            return (
              <li key={`${s.from}-${s.to}`}>
                <button
                  type="button"
                  disabled={!a}
                  onClick={() => a && onPick(a.lonlat)}
                  className="flex w-full flex-wrap items-center gap-x-2 rounded px-1 py-0.5 text-start hover:bg-slate-50"
                >
                  <span
                    className={`rounded px-1 text-[11px] font-medium ${s.flag === "short" ? "bg-violet-100 text-violet-900" : "bg-red-100 text-red-900"}`}
                  >
                    {t(s.flag === "short" ? "spacing.short" : "spacing.long")}
                  </span>
                  <span className="flex-1">
                    {t("spacing.pair", { from: a?.name ?? s.from, to: b?.name ?? s.to })}
                  </span>
                  <span className="tabular-nums">
                    {t("spacing.along", { metres: m(s.along_m) })}
                    {onFoot && s.walk_m !== null ? ` · ${t("spacing.onFoot", { metres: m(s.walk_m) })}` : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {result.geometry === "straight" && <p className="mt-1 text-slate-500">{t("spacing.straight")}</p>}
    </div>
  );
}
