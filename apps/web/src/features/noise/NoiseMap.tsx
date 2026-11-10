import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { formatInt, tNow, useI18n } from "../../i18n/i18n";
import { loadRailEngine } from "../railways/engine";
import type { Network, RailEngineLoader } from "../railways/types";
import type { StreetLinesDoc } from "../street-lines/saved";
import {
  type BuildingTileFetcher,
  buildingTiles,
  drawBuildings,
  fetchBuildingTile,
  loadBuildings,
  MAX_BUILDING_TILES,
  removeBuildings,
} from "./buildings";
import { loadWasmNoise } from "./engine";
import { drawNoise, LEGEND, removeNoise } from "./mapLayer";
import { RAIL_FLOWS, railSources, streetLineSources } from "./sources";
import { buildingsBbox, fetchPopulation, type PopulationFetcher, type PopulationSource } from "./population";
import { fetchHeights, type HeightsFetcher, loadTerrain, terrainPlan } from "./terrain";
import type {
  Flows,
  Indicator,
  NoiseBuilding,
  NoiseEngine,
  NoiseEngineLoader,
  NoiseLine,
  NoisePopulation,
  NoiseTerrain,
  NoiseView,
} from "./types";

/** How far the noise map reaches from the lines, m. */
export const MAP_REACH_M = 300;
/** Evening and night buses per hour on a street line (the street line tool's defaults). */
export const STREET_OFF_PEAK: Omit<Flows, "day"> = { evening: 3, night: 1 };
/** Colours start at the Directive's lowest reporting band. */
const FROM_DB: Record<Indicator, number> = { lden: 55, lnight: 50 };

interface Props {
  map: MapLibreMap | null;
  streetLines: StreetLinesDoc | null;
  railway: Network | null;
  /** Project preferences: `noise.*` values replace the plugin's assumptions. */
  preferences?: Record<string, number>;
  /** Tests inject these. */
  loadNoise?: NoiseEngineLoader;
  loadRail?: RailEngineLoader;
  fetchTile?: BuildingTileFetcher;
  fetchTerrain?: HeightsFetcher;
  fetchPeople?: PopulationFetcher;
}

/**
 * Purpose: the project's noise lines as sources: every saved street line (buses per hour from the
 * headway in the day, the tool's evening and night defaults) and every railway track (the sample
 * trains per hour of the design's mode).
 * Side effects: builds the railway design with the rail engine when there is one.
 */
export async function projectSources(
  streetLines: StreetLinesDoc | null,
  railway: Network | null,
  loadRail: RailEngineLoader,
): Promise<NoiseLine[]> {
  const lines: NoiseLine[] = [];
  for (const [i, l] of (streetLines?.lines ?? []).entries()) {
    if (l.view.points.length < 2) continue;
    const day = l.timing.headwayMin > 0 ? 60 / l.timing.headwayMin : 0;
    for (const s of streetLineSources(l.view, l.profile, { day, ...STREET_OFF_PEAK }, false))
      lines.push({ ...s, id: `street-${i}-${s.id}`, label: l.name || `Street line ${i + 1}` });
  }
  if (railway && railway.tracks.length) {
    const engine = await loadRail();
    try {
      const view = engine.build(railway, null);
      const flows = RAIL_FLOWS[railway.mode] ?? RAIL_FLOWS.tram!;
      lines.push(...railSources(railway, view, flows));
    } finally {
      engine.dispose();
    }
  }
  return lines;
}

type Status =
  | { kind: "idle" }
  | { kind: "busy"; step: string }
  | {
      kind: "done";
      view: NoiseView;
      buildings: NoiseBuilding[] | null;
      notes: string[];
      people: PopulationSource | null;
    }
  | { kind: "error"; text: string };

/**
 * Purpose: the Noise map in the GIS tab (ADR-0038 step N2): L_den or L_night from every saved
 * street line and railway, screened by the OSM buildings round them (over the roofs and round the
 * ends), with first-order facade reflections and the terrain, the buildings coloured by the level
 * beside their most exposed side, and the buildings and their residents (WorldPop, else the
 * building size) counted by the Directive's reporting bands.
 * Side effects: loads buildings, terrain heights and the population grid from the API and the noise and rail engines on
 * demand; draws the noise picture and the buildings on the map while shown.
 */
export function NoiseMap({
  map,
  streetLines,
  railway,
  preferences,
  loadNoise = loadWasmNoise,
  loadRail = loadRailEngine,
  fetchTile = fetchBuildingTile,
  fetchTerrain = fetchHeights,
  fetchPeople = fetchPopulation,
}: Props) {
  const { t } = useI18n();
  const [indicator, setIndicator] = useState<Indicator>("lden");
  const [withBuildings, setWithBuildings] = useState(true);
  const [withTerrain, setWithTerrain] = useState(true);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const engine = useRef<NoiseEngine | null>(null);
  const hasLines =
    (streetLines?.lines ?? []).some((l) => l.view.points.length >= 2) || !!railway?.tracks.length;

  useEffect(
    () => () => {
      engine.current?.dispose();
      engine.current = null;
      if (map) {
        removeNoise(map);
        removeBuildings(map);
      }
    },
    [map],
  );

  // Draw the result for the indicator shown.
  useEffect(() => {
    if (!map) return;
    if (status.kind !== "done" || !engine.current || !status.view.image) {
      if (status.kind !== "busy") {
        removeNoise(map);
        removeBuildings(map);
      }
      return;
    }
    const img = status.view.image;
    drawNoise(map, {
      pixels: engine.current.image(indicator, FROM_DB[indicator], 255),
      width: img.width,
      height: img.height,
      coordinates: img.coordinates,
    });
    drawBuildings(map, status.buildings, status.view.building_levels, indicator, FROM_DB[indicator]);
  }, [map, status, indicator]);

  async function compute() {
    try {
      setStatus({ kind: "busy", step: tNow("noise.collecting") });
      const lines = await projectSources(streetLines, railway, loadRail);
      if (!lines.length) {
        setStatus({ kind: "error", text: tNow("noise.drawFirst") });
        return;
      }
      let buildings: NoiseBuilding[] | null = null;
      const notes: string[] = [];
      const points = lines.flatMap((l) => l.points);
      if (withBuildings) {
        const tiles = buildingTiles(points, MAP_REACH_M);
        if (tiles.length > MAX_BUILDING_TILES) {
          notes.push(tNow("noise.tooLarge", { tiles: tiles.length, max: MAX_BUILDING_TILES }));
        } else {
          setStatus({ kind: "busy", step: tNow("noise.loadingBuildings") });
          buildings = await loadBuildings(tiles, fetchTile);
        }
      }
      let terrain: NoiseTerrain | null = null;
      if (withTerrain) {
        const plan = terrainPlan(points, MAP_REACH_M);
        if (!plan) {
          notes.push(tNow("noise.terrainTooLarge"));
        } else {
          setStatus({ kind: "busy", step: tNow("noise.loadingTerrain") });
          try {
            terrain = await loadTerrain(plan, fetchTerrain);
          } catch (err) {
            notes.push(
              tNow("noise.terrainDown", { error: err instanceof Error ? err.message : String(err) }),
            );
          }
        }
      }
      let population: NoisePopulation | null = null;
      let people: PopulationSource | null = null;
      const bbox = buildings?.length ? buildingsBbox(buildings) : null;
      if (bbox) {
        setStatus({ kind: "busy", step: tNow("noise.loadingPopulation") });
        try {
          const a = await fetchPeople(bbox);
          if (a.status === "ready") [population, people] = [a.grid, a.source];
          else if (a.status === "loading")
            notes.push(tNow("noise.popDownloading", { countries: a.countries.join(", ") }));
          else notes.push(tNow("noise.popUnavailable", { reason: a.reason }));
        } catch (err) {
          notes.push(
            tNow("noise.popUnavailable", { reason: err instanceof Error ? err.message : String(err) }),
          );
        }
      }
      setStatus({ kind: "busy", step: tNow("noise.computing") });
      // Let the panel show the step before the engine holds the page.
      await new Promise((r) => setTimeout(r, 30));
      engine.current ??= await loadNoise();
      const view = engine.current.estimate({
        lines,
        grid: true,
        grid_reach_m: MAP_REACH_M,
        buildings: buildings ?? [],
        terrain,
        population,
        overrides: Object.fromEntries(
          Object.entries(preferences ?? {}).filter(([k, v]) => k.startsWith("noise.") && Number.isFinite(v)),
        ),
      });
      setStatus({ kind: "done", view, buildings, notes, people });
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    }
  }

  const exposure = status.kind === "done" ? status.view.buildings : null;
  const rows = exposure ? exposure[indicator] : null;
  return (
    <section className="flex flex-col gap-2" aria-label={t("noise.map")}>
      <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">{t("noise.map")}</h3>
      <p className="text-xs text-slate-600">{t("noise.mapIntro")}</p>
      <div
        role="radiogroup"
        aria-label={t("noise.mapIndicator")}
        className="flex rounded border border-slate-300 bg-slate-50 p-0.5"
      >
        {(
          [
            ["lden", t("noise.lden")],
            ["lnight", "L_night"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={indicator === id}
            onClick={() => setIndicator(id)}
            className={`flex-1 rounded px-1 py-1 text-xs ${indicator === id ? "bg-white font-semibold shadow" : "text-slate-600"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={withBuildings} onChange={(e) => setWithBuildings(e.target.checked)} />
        {t("noise.screen")}
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={withTerrain} onChange={(e) => setWithTerrain(e.target.checked)} />
        {t("noise.terrain")}
      </label>
      <button
        type="button"
        className="btn min-h-10"
        disabled={!hasLines || status.kind === "busy"}
        onClick={() => void compute()}
      >
        {t(status.kind === "done" ? "noise.computeAgain" : "noise.compute")}
      </button>
      {!hasLines && <p className="text-xs text-slate-500">{t("noise.drawFirst")}</p>}
      {status.kind === "busy" && (
        <p role="status" className="text-xs text-slate-600">
          {status.step}
        </p>
      )}
      {status.kind === "error" && (
        <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{status.text}</p>
      )}
      {status.kind === "done" && (
        <>
          <div
            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600"
            aria-label={t("noise.mapLegend")}
          >
            {LEGEND.filter((l) => l.from_db >= FROM_DB[indicator]).map((l) => (
              <span key={l.from_db} className="flex items-center gap-1">
                <span
                  className="inline-block h-3 w-3 rounded-sm border border-slate-300"
                  style={{ background: l.color }}
                />
                {l.from_db}
              </span>
            ))}
            <span>dB</span>
          </div>
          {exposure && rows && (
            <table className="w-full text-xs" aria-label={t("noise.table")}>
              <caption className="pb-1 text-start text-slate-600">
                {t("noise.tableCaption", { reached: exposure.reached, count: exposure.count })}
              </caption>
              <thead>
                <tr className="text-start text-slate-500">
                  <th className="font-normal">{indicator === "lden" ? "L_den" : "L_night"}</th>
                  <th className="text-end font-normal">{t("noise.buildings")}</th>
                  {exposure.people && <th className="text-end font-normal">{t("noise.residents")}</th>}
                </tr>
              </thead>
              <tbody>
                {rows.from_db.map((from, i) => (
                  <tr key={from} className="border-t border-slate-100">
                    <td>
                      {i === rows.from_db.length - 1
                        ? t("noise.dbOrMore", { db: from })
                        : t("noise.dbRange", { from, to: from + 4 })}
                    </td>
                    <td className="text-end tabular-nums">{rows.buildings[i]}</td>
                    {exposure.people && (
                      <td className="text-end tabular-nums">{peopleText(rows.people[i] ?? 0)}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {exposure?.people && (
            <p className="text-xs text-slate-600">
              {exposure.people.source === "grid" && status.people
                ? t("noise.popGrid", {
                    year: status.people.year,
                    countries: status.people.countries.join(", "),
                    reached: peopleText(exposure.people.reached),
                    total: peopleText(exposure.people.total),
                  })
                : t("noise.popSize", {
                    reached: peopleText(exposure.people.reached),
                    total: peopleText(exposure.people.total),
                  })}
              {exposure.people.source === "grid" && exposure.people.unplaced >= 1
                ? ` ${t("noise.popUnplaced", { n: peopleText(exposure.people.unplaced) })}`
                : ""}{" "}
              {t("noise.popNoHomes")}
            </p>
          )}
          {status.notes.map((n) => (
            <p key={n} className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
              {n}
            </p>
          ))}
          <p className="text-xs text-slate-500">
            {t("noise.mapNote")} {t(status.view.terrain ? "noise.onTerrain" : "noise.flat")}
            {status.people ? ` ${t("noise.popCredit")}` : ""}
          </p>
        </>
      )}
    </section>
  );
}

/** Purpose: a people count as the Directive reports it, rounded to the nearest hundred above 100. */
function peopleText(n: number): string {
  return formatInt(n >= 100 ? Math.round(n / 100) * 100 : n);
}
