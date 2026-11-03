import { Marker, type Map as MapLibreMap, type MapMouseEvent } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import { ProfileView } from "./ProfileView";
import type { Kits, KitsLoader, LonLat, SpanStation, SpanView, StationKind, TowerInput } from "./types";

const PREFIX = "spans";

/** What the planner drew, kept on this device per project. */
export interface SpanDoc {
  name: string;
  mode: string;
  system: string;
  stations: SpanStation[];
  /** Per section: `null` for automatic towers, else the planner's towers. */
  towers: (TowerInput[] | null)[];
  /** Planner's line speed and cabin interval, over the parameter values. */
  lineSpeed: number | null;
  interval: number | null;
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
}

/** Purpose: an empty drawing for the tool's first mode. */
function emptyDoc(tool: PluginTool): SpanDoc {
  const mode = findMode(tool.modes[0] ?? "")?.mode;
  return {
    name: "Cable car 1",
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
}: Props) {
  const [kits, setKits] = useState<Kits | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<SpanDoc>(() => loadLocal(storageKey, emptyDoc(tool)));
  const [mode, setMode] = useState<Tool>("add");
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    load().then(
      (k) => alive && setKits(k),
      (e) => setError(`The cable car kit did not start: ${e instanceof Error ? e.message : String(e)}`),
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

  const view: SpanView | null = useMemo(() => {
    if (!kits) return null;
    try {
      return kits.buildSpanLine({ stations: doc.stations, system, towers: doc.towers });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [kits, doc.stations, doc.towers, system]);

  // Journey planner.
  const changed = useRef(onLineChange);
  changed.current = onLineChange;
  useEffect(() => {
    if (!view || view.stops.length < 2) return changed.current?.(null);
    const stops = view.stops.map((s) => ({
      name: doc.stations[s.station]?.name || `Station ${s.station + 1}`,
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
      const el = stationElement(i + 1, s.name || `Station ${i + 1}`, color, selected === i);
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
            name: `Station ${d.stations.length + 1}`,
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

  const update = (i: number, patch: Partial<SpanStation>) =>
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
      ? doc.stations[i.station]?.name || `station ${i.station + 1}`
      : i.section !== undefined
        ? `section ${i.section + 1}`
        : null;

  const modes = tool.modes.map((id) => findMode(id)?.mode).filter((x) => x !== undefined);
  const reversible = system.operation === "reversible";
  const body = (
    <div className="flex flex-col gap-3 px-4 pt-1 pb-5 text-sm md:px-5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Line name"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5"
          value={doc.name}
          onChange={(e) => setDoc({ ...doc, name: e.target.value })}
        />
        <div className="seg" role="tablist" aria-label="Tool">
          <button type="button" role="tab" aria-selected={mode === "add"} onClick={() => setMode("add")}>
            Add stations
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "select"}
            onClick={() => setMode("select")}
          >
            Select
          </button>
        </div>
      </div>
      <p className="text-xs text-slate-500">
        {mode === "add"
          ? "Click the map to add the next station. Drag a station to move it."
          : "Click a station to edit it. Drag a station to move it."}
      </p>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-600">Mode and system</span>
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
          <span className="text-xs font-medium text-slate-600">Line speed (m/s)</span>
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
            <span className="text-xs font-medium text-slate-600">Cabin interval (s)</span>
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
      {!kits && !error && <p className="text-slate-500">Starting the cable car kit…</p>}
      {view && doc.stations.length >= 2 && (
        <div className="grid grid-cols-2 gap-2" aria-label="Summary">
          <Stat label="Length" value={fmtLen(view.length_m)} />
          <Stat label="Trip time" value={fmtDur(view.trip_time_s)} />
          <Stat label={reversible ? "Departure every" : "Cabin every"} value={fmtDur(view.headway_s)} />
          <Stat label="Capacity per direction" value={`${fmtInt(view.capacity_pphpd)} p/h`} />
          <Stat label="Cabins" value={String(view.cabins)} />
          <Stat label="Towers" value={String(view.tower_count)} />
        </div>
      )}
      {view && <ProfileView view={view} color={color} />}
      {view && <Issues issues={view.issues} where={where} />}
      <section aria-label="Stations" className="flex flex-col gap-2">
        <h3 className="font-semibold">Stations</h3>
        {doc.stations.length === 0 && <p className="text-slate-500">No stations yet.</p>}
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
                  aria-label={`Station ${i + 1} name`}
                  className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1"
                  value={s.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                  onFocus={() => setSelected(i)}
                />
                <button
                  type="button"
                  className="btn min-h-8 px-2 text-xs"
                  aria-label={`Delete station ${i + 1}`}
                  onClick={() => {
                    setDoc(removeStation(doc, i));
                    setSelected(null);
                  }}
                >
                  Delete
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                {end ? (
                  <span className="tag bg-slate-100 text-slate-700">Terminal</span>
                ) : (
                  <select
                    aria-label={`Station ${i + 1} kind`}
                    className="rounded border border-slate-300 px-1.5 py-1"
                    value={s.kind === "angle" ? "angle" : "intermediate"}
                    onChange={(e) => update(i, { kind: e.target.value as StationKind })}
                  >
                    <option value="intermediate">Intermediate (boarding)</option>
                    <option value="angle">Angle station</option>
                  </select>
                )}
                {!end && s.kind === "angle" && (
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={s.boarding}
                      onChange={(e) => update(i, { boarding: e.target.checked })}
                    />
                    Boarding
                  </label>
                )}
                <label className="flex items-center gap-1">
                  Ground height
                  <input
                    type="number"
                    aria-label={`Station ${i + 1} ground height`}
                    className="w-20 rounded border border-slate-300 px-1.5 py-1"
                    value={s.elevation_m}
                    onChange={(e) => update(i, { elevation_m: Number(e.target.value) || 0 })}
                  />
                  m
                </label>
                {view?.stations[i] && !end && (
                  <span className="text-slate-500">Turns {Math.round(view.stations[i].deflection_deg)}°</span>
                )}
              </div>
              {sec && i < doc.stations.length - 1 && (
                <div className="mt-2 border-t border-slate-100 pt-1.5 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      To {i + 2}: {fmtLen(sec.length_m)}, {sec.towers.length} tower
                      {sec.towers.length === 1 ? "" : "s"} {sec.manual ? "(yours)" : "(automatic)"}, clearance{" "}
                      {Math.round(sec.min_clearance_m)} m
                    </span>
                    {sec.manual ? (
                      <button
                        type="button"
                        className="text-blue-700 underline"
                        onClick={() => setTowers(i, null)}
                      >
                        Back to automatic
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
                        Edit towers
                      </button>
                    )}
                  </div>
                  {sec.manual && (
                    <div className="mt-1 flex flex-col gap-1">
                      {(doc.towers[i] ?? []).map((t, k) => (
                        <div key={k} className="flex items-center gap-1.5">
                          Tower at
                          <input
                            type="number"
                            aria-label={`Section ${i + 1} tower ${k + 1} position`}
                            className="w-20 rounded border border-slate-300 px-1.5 py-0.5"
                            value={Math.round(t.at_m)}
                            onChange={(e) =>
                              setTowers(
                                i,
                                (doc.towers[i] ?? []).map((x, j) =>
                                  j === k ? { ...x, at_m: Number(e.target.value) } : x,
                                ),
                              )
                            }
                          />
                          m, height
                          <input
                            type="number"
                            aria-label={`Section ${i + 1} tower ${k + 1} height`}
                            className="w-16 rounded border border-slate-300 px-1.5 py-0.5"
                            value={Math.round(t.height_m ?? system.tower_height_m)}
                            onChange={(e) =>
                              setTowers(
                                i,
                                (doc.towers[i] ?? []).map((x, j) =>
                                  j === k ? { ...x, height_m: Number(e.target.value) } : x,
                                ),
                              )
                            }
                          />
                          m
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
                            Remove
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
                        Add tower
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
        Values come from the {found?.plugin.name ?? "cable car"} plugin&apos;s assumptions (
        {contextLabel(doc.mode, doc.system)}). The drawing is kept on this device.
      </p>
    </div>
  );
  return panel ? createPortal(body, panel) : body;
}
