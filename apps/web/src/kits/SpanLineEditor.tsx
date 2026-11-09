import { Marker, type Map as MapLibreMap, type MapMouseEvent } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { tNow, useI18n } from "../i18n/i18n";
import type { PluginLineInput } from "../features/journey-planner/network";
import { centralValues, contextLabel, findMode, type PluginTool } from "../plugins/registry";
import { loadKits, spanSystem } from "./engine";
import { fmtDur, fmtInt, fmtLen } from "./format";
import { Issues, Stat } from "./Issues";
import {
  drawKit,
  ensureKitLayers,
  loadLocal,
  removeKitLayers,
  saveLocal,
  setKitColor,
  stationElement,
} from "./mapLayers";
import { fetchProfiles, sectionGround, type TerrainProfiles } from "../terrain/terrain";
import { ProfileView } from "./ProfileView";
import type {
  GroundSample,
  Kits,
  KitsLoader,
  LonLat,
  SpanStation,
  SpanView,
  StationKind,
  TowerInput,
} from "./types";

const PREFIX = "spans";

/** What the planner drew, kept on this device per project. */
export interface SpanDoc {
  name: string;
  mode: string;
  system: string;
  stations: DocStation[];
  /** Per section: `null` for automatic towers, else the planner's towers. */
  towers: (TowerInput[] | null)[];
  /** Planner's line speed and cabin interval, over the parameter values. */
  lineSpeed: number | null;
  interval: number | null;
  /** Ground from the terrain model and OpenStreetMap buildings (default); false for typed heights only. */
  terrain?: boolean;
}

/** A station of the drawing: `elevation_typed` marks a height the planner typed over the terrain's. */
type DocStation = SpanStation & { elevation_typed?: boolean };

/** Terrain spacing along a section: ropeway spans are short, so closer than the 50 m default. */
const TERRAIN_SPACING_M = 25;

/** Loads terrain profiles for the sections; the API by default, a stub in tests. */
export type TerrainLoader = (lines: LonLat[][]) => Promise<TerrainProfiles>;

const defaultTerrain: TerrainLoader = (lines) =>
  fetchProfiles(lines, { spacingM: TERRAIN_SPACING_M, buildings: true });

/**
 * Purpose: the kit's stations and ground from the drawing and the terrain: a station without a typed
 * height stands on the terrain; each section's ground follows the terrain and the buildings under it.
 * Inputs: the stations, the terrain profiles of the sections (or null), the section lengths the kit
 * measures. Output: stations with heights, and ground samples per section (null without terrain).
 */
export function withTerrain(
  stations: DocStation[],
  terrain: TerrainProfiles | null,
  lengths: number[],
): { stations: SpanStation[]; ground: (GroundSample[] | null)[] } {
  if (!terrain || terrain.lines.length !== Math.max(0, stations.length - 1)) {
    return { stations, ground: [] };
  }
  const at = (i: number) => {
    const line = i < terrain.lines.length ? terrain.lines[i] : terrain.lines[i - 1];
    const s = i < terrain.lines.length ? line?.samples[0] : line?.samples[line.samples.length - 1];
    return s?.elevationM ?? 0;
  };
  return {
    stations: stations.map((s, i) =>
      s.elevation_typed ? s : { ...s, elevation_m: Math.round(at(i) * 10) / 10 },
    ),
    ground: terrain.lines.map((l, i) => sectionGround(l, lengths[i] ?? l.lengthM)),
  };
}

type Tool = "add" | "select";

interface Props {
  map: MapLibreMap | null;
  panel?: HTMLElement | null;
  /** The plugin tool (straight spans kit) with the modes it draws. */
  tool: PluginTool;
  /** Storage key of the drawing (per project). */
  storageKey: string;
  loadKits?: KitsLoader;
  /** Told about the line after every change, so the journey planner can ride it. */
  onLineChange?: (line: PluginLineInput | null) => void;
  loadTerrain?: TerrainLoader;
}

/** Purpose: an empty drawing for the tool's first mode. */
function emptyDoc(tool: PluginTool): SpanDoc {
  const mode = findMode(tool.modes[0] ?? "")?.mode;
  return {
    name: tNow("cable.defaultName"),
    mode: mode?.id ?? "",
    system: mode?.defaultContext ?? "",
    stations: [],
    towers: [],
    lineSpeed: null,
    interval: null,
  };
}

/** Purpose: the drawing with station `i` removed; the towers of the two sections around it go automatic. */
export function removeStation(doc: SpanDoc, i: number): SpanDoc {
  const stations = doc.stations.filter((_, k) => k !== i);
  const towers = doc.towers.slice();
  towers.splice(Math.max(0, i - 1), 2, null);
  return { ...doc, stations, towers: towers.slice(0, Math.max(0, stations.length - 1)) };
}

/** Purpose: the drawing with station `i` moved; the towers of its sections go automatic. */
export function moveStation(doc: SpanDoc, i: number, lonlat: LonLat): SpanDoc {
  const stations = doc.stations.map((s, k) => (k === i ? { ...s, lonlat } : s));
  const towers = doc.towers.map((t, k) => (k === i - 1 || k === i ? null : t));
  return { ...doc, stations, towers };
}

/**
 * Purpose: the straight spans kit's editor (ADR-0036 §6, ADR-0037 §2): click stations in order; sections
 * are straight; towers are placed automatically within the span limit and keep the recommended clearance,
 * or the planner sets them per section. The panel shows the system, the stations, the towers, the
 * longitudinal profile, the live checks, and running time, capacity and cabins.
 * Side effects: adds layers, markers and a click handler to the map while mounted; stores the drawing in
 * this device's storage under `storageKey`.
 */
export function SpanLineEditor({
  map,
  panel = null,
  tool,
  storageKey,
  loadKits: load = loadKits,
  onLineChange,
  loadTerrain = defaultTerrain,
}: Props) {
  const { t, tn } = useI18n();
  const [kits, setKits] = useState<Kits | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<SpanDoc>(() => loadLocal(storageKey, emptyDoc(tool)));
  const [mode, setMode] = useState<Tool>("add");
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    load().then(
      (k) => alive && setKits(k),
      (e) => setError(tNow("cable.engineFailed", { error: e instanceof Error ? e.message : String(e) })),
    );
    return () => {
      alive = false;
    };
  }, [load]);

  useEffect(() => saveLocal(storageKey, doc), [storageKey, doc]);

  const found = findMode(doc.mode) ?? findMode(tool.modes[0] ?? "");
  const m = found?.mode;
  const color = m?.colour ?? "#7c3aed";
  const values = useMemo(() => centralValues(doc.mode, doc.system), [doc.mode, doc.system]);
  const system = useMemo(
    () =>
      spanSystem(doc.system, m?.operation === "shuttle" ? "reversible" : "continuous", values, {
        ...(doc.lineSpeed ? { line_speed_ms: doc.lineSpeed } : {}),
        ...(doc.interval ? { cabin_interval_s: doc.interval } : {}),
      }),
    [doc.system, doc.lineSpeed, doc.interval, m?.operation, values],
  );

  // Terrain and buildings under each section, fetched when the stations move.
  const useTerrain = doc.terrain !== false;
  const coordsKey = JSON.stringify(doc.stations.map((s) => s.lonlat));
  const [terrain, setTerrain] = useState<{ key: string; data: TerrainProfiles } | null>(null);
  const [terrainState, setTerrainState] = useState<"idle" | "loading" | "error">("idle");
  const [terrainError, setTerrainError] = useState<string | null>(null);
  useEffect(() => {
    const coords = JSON.parse(coordsKey) as LonLat[];
    if (!useTerrain || coords.length < 2) return setTerrainState("idle");
    let alive = true;
    setTerrainState("loading");
    const timer = setTimeout(() => {
      loadTerrain(coords.slice(1).map((c, i) => [coords[i]!, c])).then(
        (data) => {
          if (!alive) return;
          setTerrain({ key: coordsKey, data });
          setTerrainState("idle");
          setTerrainError(null);
        },
        (e) => {
          if (!alive) return;
          setTerrainState("error");
          setTerrainError(e instanceof Error ? e.message : String(e));
        },
      );
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [coordsKey, useTerrain, loadTerrain]);
  const current = useTerrain && terrain?.key === coordsKey ? terrain.data : null;

  const view: SpanView | null = useMemo(() => {
    if (!kits) return null;
    try {
      const flat = { stations: doc.stations, system, towers: doc.towers };
      if (!current) return kits.buildSpanLine(flat);
      // Section lengths as the kit measures them, so terrain chainages line up with its own.
      const lengths = kits.buildSpanLine(flat).sections.map((x) => x.length_m);
      const { stations, ground } = withTerrain(doc.stations, current, lengths);
      return kits.buildSpanLine({ stations, system, towers: doc.towers, ground });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [kits, doc.stations, doc.towers, system, current]);
  const heights = useMemo(
    () => withTerrain(doc.stations, current, []).stations.map((s) => s.elevation_m),
    [doc.stations, current],
  );
  const estimated = (current?.lines ?? []).reduce(
    (n, l) => n + (l.buildings ?? []).filter((b) => b.estimated).length,
    0,
  );

  // Journey planner.
  const changed = useRef(onLineChange);
  changed.current = onLineChange;
  useEffect(() => {
    if (!view || view.stops.length < 2) return changed.current?.(null);
    const stops = view.stops.map((s) => ({
      name: doc.stations[s.station]?.name || tNow("cable.station", { n: s.station + 1 }),
      lonlat: doc.stations[s.station]!.lonlat,
    }));
    const fwd = view.stops.map((s, k) => ({ stop: k, run_s: s.run_s, dwell_s: s.dwell_s }));
    const n = fwd.length;
    const bwd = fwd.map((_, k) => ({
      stop: n - 1 - k,
      run_s: k === 0 ? 0 : fwd[n - k]!.run_s,
      dwell_s: fwd[n - 1 - k]!.dwell_s,
    }));
    changed.current?.({
      id: tool.id,
      name: doc.name,
      mode: doc.mode,
      color,
      stops,
      directions: [fwd, bwd],
      headwayS: Math.max(60, view.headway_s),
    });
  }, [view, doc.name, doc.mode, doc.stations, color, tool.id]);

  // Map layers.
  useEffect(() => {
    if (!map) return;
    ensureKitLayers(map, PREFIX, color);
    return () => removeKitLayers(map, PREFIX);
  }, [map]);
  useEffect(() => {
    if (map) setKitColor(map, PREFIX, color);
  }, [map, color]);
  useEffect(() => {
    if (!map) return;
    const bad = new Set((view?.issues ?? []).filter((i) => i.level === "error").map((i) => i.section));
    drawKit(map, PREFIX, {
      lines: doc.stations.slice(1).map((s, i) => ({
        coords: [doc.stations[i]!.lonlat, s.lonlat],
        error: bad.has(i),
      })),
      points: (view?.sections ?? []).flatMap((s) => s.towers.map((t) => ({ lonlat: t.lonlat }))),
    });
  }, [map, doc.stations, view]);

  // Station markers.
  useEffect(() => {
    if (!map) return;
    const markers = doc.stations.map((s, i) => {
      const el = stationElement(i + 1, s.name || tNow("cable.station", { n: i + 1 }), color, selected === i);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        setSelected(i);
      });
      const mk = new Marker({ element: el, draggable: true }).setLngLat(s.lonlat).addTo(map);
      mk.on("dragend", () => {
        const p = mk.getLngLat();
        setDoc((d) => moveStation(d, i, [p.lng, p.lat]));
      });
      return mk;
    });
    return () => markers.forEach((mk) => mk.remove());
  }, [map, doc.stations, color, selected]);

  // Clicks add stations.
  const latest = useRef({ mode });
  latest.current = { mode };
  useEffect(() => {
    if (!map) return;
    const onClick = (e: MapMouseEvent) => {
      if (latest.current.mode !== "add") return;
      const lonlat: LonLat = [e.lngLat.lng, e.lngLat.lat];
      setDoc((d) => ({
        ...d,
        stations: [
          ...d.stations,
          {
            name: tNow("cable.station", { n: d.stations.length + 1 }),
            lonlat,
            kind: "intermediate",
            boarding: false,
            elevation_m: 0,
          },
        ],
        towers: d.stations.length ? [...d.towers, null] : d.towers,
      }));
    };
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
  }, [map]);

  const update = (i: number, patch: Partial<DocStation>) =>
    setDoc((d) => ({ ...d, stations: d.stations.map((s, k) => (k === i ? { ...s, ...patch } : s)) }));
  const setTowers = (i: number, t: TowerInput[] | null) =>
    setDoc((d) => {
      const towers = d.towers.slice();
      while (towers.length < d.stations.length - 1) towers.push(null);
      towers[i] = t;
      return { ...d, towers };
    });

  const where = (i: { station?: number; section?: number }) =>
    i.station !== undefined
      ? doc.stations[i.station]?.name || t("cable.stationLower", { n: i.station + 1 })
      : i.section !== undefined
        ? t("cable.section", { n: i.section + 1 })
        : null;

  const modes = tool.modes.map((id) => findMode(id)?.mode).filter((x) => x !== undefined);
  const reversible = system.operation === "reversible";
  const body = (
    <div className="flex flex-col gap-3 px-4 pt-1 pb-5 text-sm md:px-5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label={t("kit.lineName")}
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5"
          value={doc.name}
          onChange={(e) => setDoc({ ...doc, name: e.target.value })}
        />
        <div className="seg" role="tablist" aria-label={t("kit.tool")}>
          <button type="button" role="tab" aria-selected={mode === "add"} onClick={() => setMode("add")}>
            {t("cable.addStations")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "select"}
            onClick={() => setMode("select")}
          >
            {t("kit.select")}
          </button>
        </div>
      </div>
      <p className="text-xs text-slate-500">
        {mode === "add" ? t("cable.hint.add") : t("cable.hint.select")}
      </p>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-600">{t("cable.modeSystem")}</span>
        <select
          className="rounded-lg border border-slate-300 px-2 py-1.5"
          value={`${doc.mode}|${doc.system}`}
          onChange={(e) => {
            const [mode, system] = e.target.value.split("|");
            setDoc({ ...doc, mode: mode!, system: system!, lineSpeed: null, interval: null });
          }}
        >
          {modes.flatMap((md) =>
            (md.contexts ?? []).map((c) => (
              <option key={`${md.id}|${c}`} value={`${md.id}|${c}`}>
                {md.label}: {contextLabel(md.id, c)}
              </option>
            )),
          )}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">{t("cable.lineSpeed")}</span>
          <input
            type="number"
            min={1}
            max={15}
            step={0.5}
            className="rounded-lg border border-slate-300 px-2 py-1.5"
            value={system.line_speed_ms}
            onChange={(e) => setDoc({ ...doc, lineSpeed: Number(e.target.value) || null })}
          />
        </label>
        {!reversible && (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">{t("cable.cabinInterval")}</span>
            <input
              type="number"
              min={5}
              max={300}
              className="rounded-lg border border-slate-300 px-2 py-1.5"
              value={system.cabin_interval_s}
              onChange={(e) => setDoc({ ...doc, interval: Number(e.target.value) || null })}
            />
          </label>
        )}
      </div>
      {error && (
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-2.5 py-1.5 text-red-900">
          {error}
        </p>
      )}
      {!kits && !error && <p className="text-slate-500">{t("cable.starting")}</p>}
      {view && doc.stations.length >= 2 && (
        <div className="grid grid-cols-2 gap-2" aria-label={t("kit.summary")}>
          <Stat label={t("kit.length")} value={fmtLen(view.length_m)} />
          <Stat label={t("kit.tripTime")} value={fmtDur(view.trip_time_s)} />
          <Stat
            label={t(reversible ? "cable.departureEvery" : "cable.cabinEvery")}
            value={fmtDur(view.headway_s)}
          />
          <Stat label={t("kit.capacity")} value={t("kit.pph", { n: fmtInt(view.capacity_pphpd) })} />
          <Stat label={t("cable.cabins")} value={String(view.cabins)} />
          <Stat label={t("cable.towers")} value={String(view.tower_count)} />
        </div>
      )}
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={useTerrain}
          onChange={(e) => setDoc({ ...doc, terrain: e.target.checked })}
        />
        {t("cable.terrain")}
        {useTerrain && terrainState === "loading" && (
          <span className="text-slate-500">{t("cable.loadingHeights")}</span>
        )}
      </label>
      {useTerrain && terrainState === "error" && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
          {t("cable.terrainFailed", { error: terrainError ?? "" })}
        </p>
      )}
      {view && <ProfileView view={view} color={color} />}
      {current && (
        <p className="text-[11px] text-slate-500">
          {t("cable.ground", {
            name: current.source.name,
            res: current.source.resolutionM,
            acc: current.source.verticalAccuracyM,
          })}
          {current.buildingSource &&
            " " +
              (estimated > 0
                ? tn("cable.buildingsEstimated", estimated, { licence: current.buildingSource.licence })
                : t("cable.buildings", { licence: current.buildingSource.licence }))}
        </p>
      )}
      {view && <Issues issues={view.issues} where={where} />}
      <section aria-label={t("cable.stations")} className="flex flex-col gap-2">
        <h3 className="font-semibold">{t("cable.stations")}</h3>
        {doc.stations.length === 0 && <p className="text-slate-500">{t("cable.noStations")}</p>}
        {doc.stations.map((s, i) => {
          const end = i === 0 || i === doc.stations.length - 1;
          const sec = view?.sections[i];
          return (
            <div
              key={i}
              className={`rounded-lg border p-2 ${selected === i ? "border-amber-400 ring-2 ring-amber-100" : "border-slate-200"}`}
            >
              <div className="flex items-center gap-2">
                <span className="w-5 text-center font-semibold" style={{ color }}>
                  {i + 1}
                </span>
                <input
                  aria-label={t("cable.stationName", { n: i + 1 })}
                  className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1"
                  value={s.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                  onFocus={() => setSelected(i)}
                />
                <button
                  type="button"
                  className="btn min-h-8 px-2 text-xs"
                  aria-label={t("cable.deleteStation", { n: i + 1 })}
                  onClick={() => {
                    setDoc(removeStation(doc, i));
                    setSelected(null);
                  }}
                >
                  {t("kit.delete")}
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                {end ? (
                  <span className="tag bg-slate-100 text-slate-700">{t("cable.terminal")}</span>
                ) : (
                  <select
                    aria-label={t("cable.stationKind", { n: i + 1 })}
                    className="rounded border border-slate-300 px-1.5 py-1"
                    value={s.kind === "angle" ? "angle" : "intermediate"}
                    onChange={(e) => update(i, { kind: e.target.value as StationKind })}
                  >
                    <option value="intermediate">{t("cable.intermediate")}</option>
                    <option value="angle">{t("cable.angle")}</option>
                  </select>
                )}
                {!end && s.kind === "angle" && (
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={s.boarding}
                      onChange={(e) => update(i, { boarding: e.target.checked })}
                    />
                    {t("cable.boarding")}
                  </label>
                )}
                <label className="flex items-center gap-1">
                  {t("cable.groundHeight")}
                  <input
                    type="number"
                    aria-label={t("cable.groundHeightOf", { n: i + 1 })}
                    className="w-20 rounded border border-slate-300 px-1.5 py-1"
                    value={heights[i] ?? s.elevation_m}
                    onChange={(e) =>
                      update(i, { elevation_m: Number(e.target.value) || 0, elevation_typed: true })
                    }
                  />
                  {t("kit.m")}
                </label>
                {current && !s.elevation_typed && (
                  <span className="text-slate-500">{t("cable.fromTerrain")}</span>
                )}
                {useTerrain && s.elevation_typed && (
                  <button
                    type="button"
                    className="text-blue-700 underline"
                    onClick={() => update(i, { elevation_typed: false })}
                  >
                    {t("cable.useTerrain")}
                  </button>
                )}
                {view?.stations[i] && !end && (
                  <span className="text-slate-500">
                    {t("cable.turns", { deg: Math.round(view.stations[i].deflection_deg) })}
                  </span>
                )}
              </div>
              {sec && i < doc.stations.length - 1 && (
                <div className="mt-2 border-t border-slate-100 pt-1.5 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {tn(sec.manual ? "cable.sectionYours" : "cable.sectionAuto", sec.towers.length, {
                        to: i + 2,
                        len: fmtLen(sec.length_m),
                        clearance: Math.round(sec.min_clearance_m),
                      })}
                    </span>
                    {sec.manual ? (
                      <button
                        type="button"
                        className="text-blue-700 underline"
                        onClick={() => setTowers(i, null)}
                      >
                        {t("cable.backToAuto")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="text-blue-700 underline"
                        onClick={() =>
                          setTowers(
                            i,
                            sec.towers.map((t) => ({ at_m: t.at_m, height_m: t.height_m })),
                          )
                        }
                      >
                        {t("cable.editTowers")}
                      </button>
                    )}
                  </div>
                  {sec.manual && (
                    <div className="mt-1 flex flex-col gap-1">
                      {(doc.towers[i] ?? []).map((tw, k) => (
                        <div key={k} className="flex items-center gap-1.5">
                          {t("cable.towerAt")}
                          <input
                            type="number"
                            aria-label={t("cable.towerPosition", { section: i + 1, tower: k + 1 })}
                            className="w-20 rounded border border-slate-300 px-1.5 py-0.5"
                            value={Math.round(tw.at_m)}
                            onChange={(e) =>
                              setTowers(
                                i,
                                (doc.towers[i] ?? []).map((x, j) =>
                                  j === k ? { ...x, at_m: Number(e.target.value) } : x,
                                ),
                              )
                            }
                          />
                          {t("cable.mHeight")}
                          <input
                            type="number"
                            aria-label={t("cable.towerHeight", { section: i + 1, tower: k + 1 })}
                            className="w-16 rounded border border-slate-300 px-1.5 py-0.5"
                            value={Math.round(tw.height_m ?? system.tower_height_m)}
                            onChange={(e) =>
                              setTowers(
                                i,
                                (doc.towers[i] ?? []).map((x, j) =>
                                  j === k ? { ...x, height_m: Number(e.target.value) } : x,
                                ),
                              )
                            }
                          />
                          {t("kit.m")}
                          <button
                            type="button"
                            className="text-red-700 underline"
                            onClick={() =>
                              setTowers(
                                i,
                                (doc.towers[i] ?? []).filter((_, j) => j !== k),
                              )
                            }
                          >
                            {t("kit.remove")}
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="self-start text-blue-700 underline"
                        onClick={() =>
                          setTowers(i, [
                            ...(doc.towers[i] ?? []),
                            { at_m: sec.length_m / 2, height_m: system.tower_height_m },
                          ])
                        }
                      >
                        {t("cable.addTower")}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </section>
      <p className="text-[11px] text-slate-500">
        {t("kit.valuesFrom", {
          plugin: found?.plugin.name ?? t("cable.plugin"),
          context: contextLabel(doc.mode, doc.system),
        })}{" "}
        {t("kit.keptHere")}
      </p>
    </div>
  );
  return panel ? createPortal(body, panel) : body;
}
