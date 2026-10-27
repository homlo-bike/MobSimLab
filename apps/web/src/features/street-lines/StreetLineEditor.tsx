import { Marker, type Map as MapLibreMap, type MapMouseEvent } from "maplibre-gl";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadWasmEngine } from "./engine";
import { formatLength, formatTime, lineToGeoJson, STATUS_COLOR } from "./geojson";
import { drawLine, drawRoads, ensureLayers, HIT_LAYER, removeLayers } from "./mapLayers";
import type {
  EngineLoader,
  LineView,
  LonLat,
  Mode,
  NetworkStats,
  PointKind,
  PointView,
  RoutingRules,
  StreetEngine,
  VehicleProfile,
} from "./types";

const MODES: { id: Mode; label: string }[] = [
  { id: "bus", label: "Bus" },
  { id: "brt", label: "BRT" },
  { id: "trolleybus", label: "Trolleybus" },
  { id: "intercity_bus", label: "Intercity bus" },
];

const KINDS: { id: PointKind; label: string; title: string }[] = [
  { id: "via", label: "Via", title: "Via point: shapes the path, no passengers" },
  { id: "stop", label: "Stop", title: "Stop on the sidewalk, served from the door side" },
  { id: "end_stop", label: "End", title: "End stop: layover; splits the line into directions" },
];

type Tool = "add" | "depot" | null;

/** Purpose: DOM element for a route point marker (number in a circle, square for end stops). */
function pointElement(p: PointView, selected: boolean): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = String(p.seq + 1);
  el.title = `${p.seq + 1}. ${p.name}${p.message ? ` — ${p.message}` : ""}`;
  el.setAttribute("aria-label", `Route point ${p.seq + 1}: ${p.name}`);
  const size = p.kind === "via" ? 18 : 24;
  const bg = p.status === "error" ? STATUS_COLOR.error : p.kind === "via" ? "#ffffff" : "#1e3a8a";
  Object.assign(el.style, {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: p.kind === "end_stop" ? "4px" : "50%",
    background: bg,
    color: p.kind === "via" && p.status !== "error" ? "#1e3a8a" : "#ffffff",
    border: `2px solid ${selected ? "#f59e0b" : "#1e3a8a"}`,
    font: "600 11px system-ui, sans-serif",
    cursor: "grab",
    padding: "0",
    boxShadow: "0 1px 3px rgba(0,0,0,.4)",
  });
  return el;
}

function depotElement(): HTMLElement {
  const el = document.createElement("div");
  el.textContent = "D";
  el.title = "Depot gate (drag to move)";
  Object.assign(el.style, {
    width: "26px",
    height: "26px",
    lineHeight: "22px",
    textAlign: "center",
    background: "#334155",
    color: "#fff",
    border: "2px solid #fff",
    borderRadius: "4px",
    font: "700 12px system-ui, sans-serif",
    cursor: "grab",
    boxShadow: "0 1px 3px rgba(0,0,0,.4)",
  });
  return el;
}

interface Props {
  /** The map to draw on; `null` until the map has loaded. */
  map: MapLibreMap | null;
  /** Engine loader; tests inject a fake. */
  loadEngine?: EngineLoader;
}

/**
 * Purpose: street line tool for bus, BRT, trolleybus and intercity bus (ADR-0029).
 * The planner clicks points in order; the route follows legal streets and closes back to the first point.
 * Points can be dragged, inserted (click on the line), deleted, promoted to stops or end stops; a depot
 * adds routed pull-out and pull-in trips.
 * Side effects: adds layers, markers and click handlers to the map while mounted.
 */
export function StreetLineEditor({ map, loadEngine = loadWasmEngine }: Props) {
  const engine = useRef<StreetEngine | null>(null);
  const [view, setView] = useState<LineView | null>(null);
  const [stats, setStats] = useState<NetworkStats | null>(null);
  const [bounds, setBounds] = useState<[number, number, number, number] | null>(null);
  const [profile, setProfile] = useState<VehicleProfile | null>(null);
  const [rules, setRules] = useState<RoutingRules | null>(null);
  const [tool, setTool] = useState<Tool>("add");
  const [newKind, setNewKind] = useState<PointKind>("via");
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showRoads, setShowRoads] = useState(true);

  // Latest values for map event handlers registered once.
  const latest = useRef({ tool, newKind, view });
  latest.current = { tool, newKind, view };

  const run = useCallback((f: (e: StreetEngine) => LineView) => {
    const e = engine.current;
    if (!e) return;
    try {
      setView(f(e));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const loadFile = async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const eng = await loadEngine(await file.text());
      engine.current?.dispose();
      engine.current = eng;
      const p = profile ?? eng.defaultProfile("bus");
      const r = rules ?? eng.defaultRules();
      setProfile(p);
      setRules(r);
      setStats(eng.stats());
      setBounds(eng.bounds());
      setView(eng.setSettings(p, r));
      setSelected(null);
      const [w, s, e, n] = eng.bounds();
      map?.fitBounds(
        [
          [w, s],
          [e, n],
        ],
        { padding: 40, duration: 0 },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const changeProfile = (p: VehicleProfile, r: RoutingRules | null = rules) => {
    setProfile(p);
    if (r) run((e) => e.setSettings(p, r));
  };

  // Layers live as long as the editor and the map.
  useEffect(() => {
    if (!map || !rules) return;
    ensureLayers(map, rules.traffic_side);
    return () => removeLayers(map);
  }, [map, rules]);

  useEffect(() => {
    if (map && view && map.getSource("sl-legs")) drawLine(map, view, bounds);
  }, [map, view, bounds, rules]);

  // Usable roads change with the vehicle (motorways, wire, height limits...).
  useEffect(() => {
    if (map && map.getSource("sl-roads"))
      drawRoads(map, showRoads && engine.current ? engine.current.usableRoads() : null);
  }, [map, profile, rules, showRoads, stats]);

  // Map clicks: add or insert a point, or place the depot.
  useEffect(() => {
    if (!map) return;
    const onClick = (ev: MapMouseEvent) => {
      const { tool: t, newKind: k, view: v } = latest.current;
      if (!engine.current || !v || !t) return;
      const at: LonLat = [ev.lngLat.lng, ev.lngLat.lat];
      if (t === "depot") {
        run((e) => e.setDepot(at));
        setTool("add");
        return;
      }
      const { x, y } = ev.point;
      const hits = map.getLayer(HIT_LAYER)
        ? map.queryRenderedFeatures(
            [
              [x - 6, y - 6],
              [x + 6, y + 6],
            ],
            { layers: [HIT_LAYER] },
          )
        : [];
      const hit = hits[0]?.properties?.index;
      const seq = hit === undefined ? v.points.length : Number(hit) + 1;
      run((e) => e.insertPoint(seq, at, k));
    };
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
  }, [map, run]);

  useEffect(() => {
    if (map) map.getCanvas().style.cursor = tool && engine.current ? "crosshair" : "";
  }, [map, tool, view]);

  // Markers for points and the depot, rebuilt on every view change.
  useEffect(() => {
    if (!map || !view) return;
    const markers: Marker[] = view.points.map((p) => {
      const el = pointElement(p, p.id === selected);
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        setSelected(p.id);
      });
      const m = new Marker({ element: el, draggable: true }).setLngLat(p.lonlat).addTo(map);
      m.on("dragend", () => {
        const { lng, lat } = m.getLngLat();
        run((e) => e.movePoint(p.id, [lng, lat]));
        setSelected(p.id);
      });
      return m;
    });
    if (view.depot) {
      const m = new Marker({ element: depotElement(), draggable: true }).setLngLat(view.depot).addTo(map);
      m.on("dragend", () => {
        const { lng, lat } = m.getLngLat();
        run((e) => e.setDepot([lng, lat]));
      });
      markers.push(m);
    }
    return () => markers.forEach((m) => m.remove());
  }, [map, view, selected, run]);

  // Delete key removes the selected point.
  useEffect(() => {
    if (selected === null) return;
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (ev.key === "Delete" || ev.key === "Backspace") {
        run((e) => e.deletePoint(selected));
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, run]);

  useEffect(() => () => engine.current?.dispose(), []);

  const exportGeoJson = () => {
    if (!view) return;
    const blob = new Blob([JSON.stringify(lineToGeoJson(view), null, 2)], { type: "application/geo+json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "street-line.geojson";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const nameOf = (id: number | undefined) => view?.points.find((p) => p.id === id)?.name ?? `#${id}`;
  const btn = "rounded border border-slate-300 px-2 py-1 hover:bg-slate-100 disabled:opacity-40";
  const on = "border-blue-700 bg-blue-700 text-white hover:bg-blue-800";

  return (
    <aside
      aria-label="Street line editor"
      className="absolute top-2 left-2 z-10 flex max-h-[calc(100%-1rem)] w-80 flex-col gap-3 overflow-y-auto rounded-md bg-white p-3 text-sm shadow-lg"
    >
      <h2 className="text-base font-semibold">Street line</h2>

      <section className="flex flex-col gap-1">
        <label className="font-medium" htmlFor="sl-osm">
          Road network (OSM XML)
        </label>
        <input
          id="sl-osm"
          type="file"
          accept=".osm,.xml,application/xml,text/xml"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void loadFile(f);
          }}
        />
        {loading && <p className="text-slate-600">Building the road network…</p>}
        {stats ? (
          <p className="text-slate-600">
            {stats.arcs.toLocaleString()} road links, {stats.turn_bans} turn bans for buses.
          </p>
        ) : (
          <p className="text-slate-600">
            Load an area exported from openstreetmap.org or fetched with{" "}
            <code>tools/osm/overpass_fetch.py</code>. The project&apos;s imported OSM network replaces this
            step in Phase 2.
          </p>
        )}
      </section>

      {profile && rules && (
        <section className="flex flex-col gap-2">
          <div className="flex gap-2">
            <label className="flex flex-1 flex-col">
              <span className="font-medium">Mode</span>
              <select
                value={profile.mode}
                onChange={(e) => changeProfile(engine.current!.defaultProfile(e.target.value as Mode))}
                className="rounded border border-slate-300 p-1"
              >
                {MODES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col">
              <span className="font-medium">Traffic</span>
              <select
                value={rules.traffic_side}
                onChange={(e) => {
                  const r = { ...rules, traffic_side: e.target.value as RoutingRules["traffic_side"] };
                  setRules(r);
                  changeProfile(profile, r);
                }}
                className="rounded border border-slate-300 p-1"
              >
                <option value="right">Right-hand</option>
                <option value="left">Left-hand</option>
              </select>
            </label>
          </div>
          <p className="text-xs text-slate-600">
            Vehicle: {profile.length_m} m long, {profile.height_m} m high, {profile.weight_t} t.
          </p>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showRoads} onChange={(e) => setShowRoads(e.target.checked)} />
            Show roads this vehicle may use
            {profile.mode === "trolleybus" && <span className="text-xs text-green-700">(green: wire)</span>}
          </label>
          {profile.mode === "trolleybus" && (
            <label className="flex items-center gap-2">
              Battery range (m)
              <input
                type="number"
                min={0}
                step={100}
                value={profile.battery_range_m}
                onChange={(e) => changeProfile({ ...profile, battery_range_m: Number(e.target.value) || 0 })}
                className="w-24 rounded border border-slate-300 p-1"
              />
            </label>
          )}
          {profile.mode === "brt" && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={profile.doors_both_sides}
                onChange={(e) => changeProfile({ ...profile, doors_both_sides: e.target.checked })}
              />
              Doors on both sides
            </label>
          )}
        </section>
      )}

      {view && (
        <>
          <section className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-1" role="toolbar" aria-label="Tools">
              <button
                type="button"
                className={`${btn} ${tool === "add" ? on : ""}`}
                onClick={() => setTool(tool === "add" ? null : "add")}
              >
                Add points
              </button>
              <button
                type="button"
                className={`${btn} ${tool === "depot" ? on : ""}`}
                onClick={() => setTool(tool === "depot" ? null : "depot")}
              >
                Place depot
              </button>
              <button
                type="button"
                className={btn}
                onClick={() => run((e) => e.optimise())}
                disabled={view.points.length < 2}
              >
                Optimise
              </button>
              <button type="button" className={btn} onClick={exportGeoJson} disabled={view.points.length < 2}>
                Export
              </button>
            </div>
            <div className="flex items-center gap-2 text-xs">
              New points:
              {KINDS.slice(0, 2).map((k) => (
                <label key={k.id} className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="sl-new-kind"
                    checked={newKind === k.id}
                    onChange={() => setNewKind(k.id)}
                  />
                  {k.label}
                </label>
              ))}
            </div>
            <p className="text-xs text-slate-600">
              Click the map to add points in order; the line returns from the last point to the first. Click
              on the line to insert a point, drag points to move them, Delete removes the selected point.
              Stops snap to the sidewalk you click on and are served from the door side.
            </p>
          </section>

          {view.points.length >= 2 && (
            <p className="font-medium">
              Circuit {formatLength(view.length_m)}, {formatTime(view.time_s)} running time
            </p>
          )}

          {(error || view.issues.length > 0) && (
            <ul className="flex flex-col gap-1 text-xs" aria-label="Problems">
              {error && <li className="text-red-700">{error}</li>}
              {view.issues.map((i) => (
                <li key={i} className="text-amber-700">
                  {i}
                </li>
              ))}
            </ul>
          )}

          {view.points.length > 0 && (
            <section>
              <h3 className="font-medium">Points</h3>
              <ol className="flex flex-col gap-1">
                {view.points.map((p) => {
                  const leg = view.legs[p.seq];
                  return (
                    <li
                      key={p.id}
                      className={`rounded border p-1 ${p.id === selected ? "border-amber-500 bg-amber-50" : "border-slate-200"}`}
                      onClick={() => setSelected(p.id)}
                    >
                      <div className="flex items-center gap-1">
                        <span className="w-5 text-right font-semibold">{p.seq + 1}</span>
                        {p.kind === "via" ? (
                          <span className="flex-1 truncate text-slate-500">{p.name}</span>
                        ) : (
                          <input
                            aria-label={`Name of point ${p.seq + 1}`}
                            className="min-w-0 flex-1 rounded border border-transparent px-1 hover:border-slate-300"
                            defaultValue={p.name}
                            key={p.name}
                            onBlur={(e) =>
                              e.target.value !== p.name && run((en) => en.setName(p.id, e.target.value))
                            }
                          />
                        )}
                        <span className="flex" role="group" aria-label={`Kind of point ${p.seq + 1}`}>
                          {KINDS.map((k) => (
                            <button
                              key={k.id}
                              type="button"
                              title={k.title}
                              aria-pressed={p.kind === k.id}
                              className={`border border-slate-300 px-1 text-xs ${p.kind === k.id ? on : ""}`}
                              onClick={() => run((e) => e.setKind(p.id, k.id))}
                            >
                              {k.label}
                            </button>
                          ))}
                        </span>
                        <button
                          type="button"
                          aria-label={`Delete point ${p.seq + 1}`}
                          className="px-1 text-slate-500 hover:text-red-700"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            run((e) => e.deletePoint(p.id));
                          }}
                        >
                          ×
                        </button>
                      </div>
                      {p.message && <p className="text-xs text-red-700">{p.message}</p>}
                      {leg && (
                        <p className="pl-6 text-xs" style={{ color: STATUS_COLOR[leg.status] }}>
                          → {formatLength(leg.length_m)}, {formatTime(leg.time_s)}
                          {leg.message ? ` — ${leg.message}` : ""}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          {view.directions.length > 0 && (
            <section>
              <h3 className="font-medium">Directions</h3>
              <ul className="text-xs">
                {view.directions.map((d) => (
                  <li key={d.direction}>
                    {d.direction}: {nameOf(d.stops[0])} → {nameOf(d.stops[d.stops.length - 1])},{" "}
                    {d.stops.length} stops, {formatLength(d.length_m)}, {formatTime(d.time_s)}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {view.station_groups.some((g) => g.stops.length > 1) && (
            <section>
              <h3 className="font-medium">Station groups</h3>
              <ul className="text-xs">
                {view.station_groups
                  .filter((g) => g.stops.length > 1)
                  .map((g) => (
                    <li key={g.stops.join("-")}>
                      {g.name}: {g.stops.length} stops
                    </li>
                  ))}
              </ul>
            </section>
          )}

          {view.depot && (
            <section>
              <h3 className="flex items-center justify-between font-medium">
                Depot trips
                <button
                  type="button"
                  className="text-xs text-slate-500 hover:text-red-700"
                  onClick={() => run((e) => e.clearDepot())}
                >
                  Remove depot
                </button>
              </h3>
              <ul className="text-xs">
                {view.depot_trips.map((t) => (
                  <li
                    key={`${t.kind}-${t.stop}`}
                    style={{ color: t.status === "ok" ? undefined : STATUS_COLOR.error }}
                  >
                    {t.kind === "pull_out"
                      ? `Pull-out to ${nameOf(t.stop)}`
                      : `Pull-in from ${nameOf(t.stop)}`}
                    : {t.status === "ok" ? `${formatLength(t.length_m)}, ${formatTime(t.time_s)}` : t.message}
                  </li>
                ))}
                {view.depot_trips.length === 0 && <li>Add stops to route pull-out and pull-in trips.</li>}
              </ul>
            </section>
          )}
        </>
      )}
    </aside>
  );
}
