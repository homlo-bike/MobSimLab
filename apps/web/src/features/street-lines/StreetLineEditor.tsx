import { Marker, type Map as MapLibreMap, type MapMouseEvent } from "maplibre-gl";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchStreetTile, loadWasmEngine } from "./engine";
import { LinePanel, type PanelActions } from "./LinePanel";
import { drawLine, drawRoads, ensureLayers, HIT_LAYER, removeLayers, setLineColor } from "./mapLayers";
import { depotElement, pointElement, vehicleElement } from "./markers";
import { DEFAULT_TIMING, MODES, type Timing } from "./modes";
import { along, circuitPath } from "./summary";
import { MIN_LOAD_ZOOM, tilesFor } from "./tiles";
import { ToolPalette, type Tool } from "./ToolPalette";
import type {
  EngineLoader,
  LineView,
  LonLat,
  RoutingRules,
  StreetEngine,
  TileFetcher,
  VehicleProfile,
} from "./types";

const EMPTY_VIEW: LineView = {
  points: [],
  legs: [],
  directions: [],
  station_groups: [],
  depot: null,
  depot_trips: [],
  issues: [],
  length_m: 0,
  time_s: 0,
};

const HINTS: Record<Tool, string> = {
  select: "Drag a point to move it; the route recalculates. Click a point to edit it in the panel.",
  add: "Click on a street to add the next point. Click on the line to insert a point between two others.",
  pan: "Drag to move the map.",
  depot: "Click on the street at the depot gate.",
};

/** The preview runs this many times faster than the timetable. */
const PREVIEW_SPEEDUP = 30;

interface Props {
  /** The map to draw on; `null` until the map has loaded. */
  map: MapLibreMap | null;
  /** Where the side panel renders; inline when `null`. */
  panel?: HTMLElement | null;
  /** Engine loader; tests inject a fake. */
  loadEngine?: EngineLoader;
  /** Street tile source; tests inject a fake. */
  fetchTile?: TileFetcher;
}

/**
 * Purpose: street line tool for bus, BRT, trolleybus and intercity bus (ADR-0029), laid out like the
 * line and track drawing mockup. Streets for the area on screen load automatically. The planner adds
 * points in order; the route follows legal streets and closes back to the first point. Points can be
 * dragged, inserted (click on the line), deleted, and promoted to stops or end stops; a depot adds
 * routed pull-out and pull-in runs; the preview run drives a vehicle round the circuit.
 * Side effects: adds layers, markers and handlers to the map while mounted; fetches street tiles.
 */
export function StreetLineEditor({
  map,
  panel = null,
  loadEngine = loadWasmEngine,
  fetchTile = fetchStreetTile,
}: Props) {
  const engine = useRef<StreetEngine | null>(null);
  const [view, setView] = useState<LineView>(EMPTY_VIEW);
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<VehicleProfile | null>(null);
  const [rules, setRules] = useState<RoutingRules | null>(null);
  const [timing, setTiming] = useState<Timing>(DEFAULT_TIMING);
  const [lineName, setLineName] = useState("Line 1");
  const [tool, setTool] = useState<Tool>("add");
  const [selected, setSelected] = useState<number | null>(null);
  const [depotStops, setDepotStops] = useState<{ out?: number; in?: number }>({});
  const [showDepot, setShowDepot] = useState(true);
  const [showRoads, setShowRoads] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [status, setStatus] = useState<string | null>("Starting the routing engine…");
  const [error, setError] = useState<string | null>(null);

  // Latest values for map and keyboard handlers registered once.
  const latest = useRef({ tool, view, selected });
  latest.current = { tool, view, selected };

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

  useEffect(() => {
    let alive = true;
    loadEngine()
      .then((e) => {
        if (!alive) return e.dispose();
        engine.current = e;
        setProfile(e.defaultProfile("bus"));
        setRules(e.defaultRules());
        setStatus(null);
      })
      .catch((err) =>
        setError(`The routing engine did not start: ${err instanceof Error ? err.message : String(err)}`),
      );
    return () => {
      alive = false;
      engine.current?.dispose();
      engine.current = null;
    };
  }, [loadEngine]);

  // Streets: load the tiles on screen whenever the map stops moving, then rebuild once per batch.
  const tiles = useRef(new Set<string>());
  const [zoomedOut, setZoomedOut] = useState(false);
  useEffect(() => {
    if (!map || !profile) return;
    let busy = false;
    let again = false;
    let stopped = false;
    const load = async () => {
      const e = engine.current;
      if (!e || stopped) return;
      if (busy) {
        again = true;
        return;
      }
      const tooFar = map.getZoom() < MIN_LOAD_ZOOM;
      setZoomedOut(tooFar);
      if (tooFar) return;
      const b = map.getBounds();
      const want = tilesFor([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
        .map(([x, y]) => `${x}/${y}`)
        .filter((k) => !tiles.current.has(k));
      if (!want.length) return;
      busy = true;
      want.forEach((k) => tiles.current.add(k));
      setStatus("Loading streets…");
      const got = await Promise.allSettled(
        want.map((k) => {
          const [x, y] = k.split("/").map(Number);
          return fetchTile(x!, y!);
        }),
      );
      busy = false;
      if (stopped || engine.current !== e) {
        want.forEach((k) => tiles.current.delete(k));
        return;
      }
      let added = 0;
      let failed = 0;
      got.forEach((r, i) => {
        try {
          if (r.status === "rejected") throw r.reason;
          e.addOsm(r.value);
          added++;
        } catch {
          tiles.current.delete(want[i]!);
          failed++;
        }
      });
      if (added) run((eng) => eng.rebuild());
      setReady(e.ready());
      setStatus(failed ? "Some streets did not load. Move the map to try again." : null);
      if (again) {
        again = false;
        void load();
      }
    };
    const onMove = () => void load();
    map.on("moveend", onMove);
    void load();
    return () => {
      stopped = true;
      map.off("moveend", onMove);
    };
  }, [map, profile !== null, fetchTile, run]);

  const color = profile ? MODES[profile.mode].color : MODES.bus.color;
  const terminals = [...new Set(view.depot_trips.map((t) => t.stop))];
  const pick = (s: number | undefined) => (s !== undefined && terminals.includes(s) ? s : terminals[0]);
  const shownDepot = { out: pick(depotStops.out), in: pick(depotStops.in) };

  // Layers live as long as the editor, the map and the driving side.
  useEffect(() => {
    if (!map || !rules) return;
    ensureLayers(map, MODES.bus.color, rules.traffic_side);
    return () => removeLayers(map);
  }, [map, rules?.traffic_side]);

  useEffect(() => {
    if (map && map.getSource("sl-legs")) setLineColor(map, color);
  }, [map, color, rules?.traffic_side]);

  useEffect(() => {
    if (map && map.getSource("sl-legs")) drawLine(map, view, showDepot ? shownDepot : null);
  }, [map, view, showDepot, shownDepot.out, shownDepot.in, rules?.traffic_side]);

  useEffect(() => {
    if (map && map.getSource("sl-roads"))
      drawRoads(map, showRoads && engine.current ? engine.current.usableRoads() : null);
  }, [map, profile, ready, showRoads, rules?.traffic_side]);

  // Map clicks: add or insert a point, place the depot, or clear the selection.
  useEffect(() => {
    if (!map) return;
    const onClick = (ev: MapMouseEvent) => {
      const { tool: t, view: v } = latest.current;
      if (!engine.current) return;
      const at: LonLat = [ev.lngLat.lng, ev.lngLat.lat];
      if (t === "depot") {
        run((e) => e.setDepot(at));
        setTool("select");
      } else if (t === "add") {
        const { x, y } = ev.point;
        const box: [[number, number], [number, number]] = [
          [x - 6, y - 6],
          [x + 6, y + 6],
        ];
        const hits = map.getLayer(HIT_LAYER) ? map.queryRenderedFeatures(box, { layers: [HIT_LAYER] }) : [];
        const hit = hits[0]?.properties?.index;
        const seq = hit === undefined ? v.points.length : Number(hit) + 1;
        run((e) => e.insertPoint(seq, at, "via"));
      } else if (t === "select") {
        setSelected(null);
      }
    };
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
  }, [map, run]);

  useEffect(() => {
    if (map)
      map.getCanvas().style.cursor =
        tool === "add" || tool === "depot" ? "crosshair" : tool === "pan" ? "grab" : "";
  }, [map, tool]);

  // Markers for points and the depot, rebuilt on every change.
  useEffect(() => {
    if (!map) return;
    const firstOfGroup = new Map<number, string>();
    for (const g of view.station_groups) if (g.stops[0] !== undefined) firstOfGroup.set(g.stops[0], g.name);
    const grouped = new Set(view.station_groups.flatMap((g) => g.stops));
    const draggable = tool === "select" || tool === "add";
    const markers: Marker[] = view.points.map((p) => {
      const label = p.kind === "via" ? null : grouped.has(p.id) ? (firstOfGroup.get(p.id) ?? null) : p.name;
      const el = pointElement(p, color, p.id === selected, label);
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        setSelected(p.id);
      });
      const m = new Marker({ element: el, draggable }).setLngLat(p.lonlat).addTo(map);
      m.on("dragend", () => {
        const { lng, lat } = m.getLngLat();
        run((e) => e.movePoint(p.id, [lng, lat]));
        setSelected(p.id);
      });
      return m;
    });
    if (view.depot) {
      const m = new Marker({ element: depotElement(), draggable }).setLngLat(view.depot).addTo(map);
      m.on("dragend", () => {
        const { lng, lat } = m.getLngLat();
        run((e) => e.setDepot([lng, lat]));
      });
      markers.push(m);
    }
    return () => markers.forEach((m) => m.remove());
  }, [map, view, selected, color, tool, run]);

  // Preview run: one vehicle drives the circuit, stopping at every stop.
  useEffect(() => {
    if (!map || !previewing) return;
    const c = circuitPath(view);
    if (!c || view.time_s <= 0) {
      setPreviewing(false);
      return;
    }
    const speed = (c.length / view.time_s) * PREVIEW_SPEEDUP;
    const dwellMs = (timing.dwellS * 1000) / PREVIEW_SPEEDUP;
    const vehicle = new Marker({ element: vehicleElement(color), rotationAlignment: "map" })
      .setLngLat(c.coords[0]!)
      .addTo(map);
    let s = 0;
    let lap = 0;
    let next = 1;
    let pausedUntil = 0;
    let last = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const dt = (now - last) / 1000;
      last = now;
      if (now >= pausedUntil) {
        s += speed * dt;
        const stopAt =
          lap * c.length + (next < c.stops.length ? c.stops[next]! : c.length + (c.stops[0] ?? 0));
        if (c.stops.length && s >= stopAt) {
          s = stopAt;
          pausedUntil = now + dwellMs;
          next++;
          if (next > c.stops.length) {
            next = 1;
            lap++;
          }
        }
      }
      const pos = along(c, s);
      vehicle.setLngLat(pos.at).setRotation(pos.bearing);
      frame = requestAnimationFrame(step);
    });
    return () => {
      cancelAnimationFrame(frame);
      vehicle.remove();
    };
  }, [map, previewing, view, color, timing.dwellS]);

  // Keyboard: V, P and H pick tools; Delete removes the selected point; Escape stops what is going on.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const sel = latest.current.selected;
      const key = ev.key.toLowerCase();
      if (key === "v") setTool("select");
      else if (key === "p") setTool("add");
      else if (key === "h") setTool("pan");
      else if ((ev.key === "Delete" || ev.key === "Backspace") && sel !== null) {
        run((e) => e.deletePoint(sel));
        setSelected(null);
      } else if (ev.key === "Escape") {
        setSelected(null);
        setPreviewing(false);
        setTool((t) => (t === "depot" ? "select" : t));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run]);

  const settings = (p: VehicleProfile, r: RoutingRules) => {
    setProfile(p);
    setRules(r);
    run((e) => e.setSettings(p, r));
  };

  const actions: PanelActions = {
    setName: setLineName,
    setMode: (m) => engine.current && rules && settings(engine.current.defaultProfile(m), rules),
    setProfile: (p) => rules && settings(p, rules),
    setRules: (r) => profile && settings(profile, r),
    setTiming,
    select: setSelected,
    setKind: (id, k) => run((e) => e.setKind(id, k)),
    setPointName: (id, n) => run((e) => e.setName(id, n)),
    deletePoint: (id) => {
      run((e) => e.deletePoint(id));
      setSelected(null);
    },
    optimise: () => run((e) => e.optimise()),
    clear: () => {
      run((e) => e.clear());
      setSelected(null);
      setPreviewing(false);
    },
    placeDepot: () => setTool("depot"),
    removeDepot: () => run((e) => e.clearDepot()),
    setDepotStops,
    setShowDepot,
    setShowRoads,
  };

  const canPreview = circuitPath(view) !== null;
  const notice =
    zoomedOut && !ready
      ? "Zoom in to street level to load streets."
      : zoomedOut
        ? "Zoom in to load streets for this area."
        : status;

  const sidePanel = profile && rules && (
    <LinePanel
      lineName={lineName}
      view={view}
      profile={profile}
      rules={rules}
      timing={timing}
      selected={selected}
      depotStops={shownDepot}
      showDepot={showDepot}
      showRoads={showRoads}
      status={null}
      error={error}
      actions={actions}
    />
  );

  return (
    <>
      <ToolPalette
        tool={tool}
        onTool={setTool}
        previewing={previewing}
        canPreview={canPreview}
        onPreview={() => setPreviewing(!previewing)}
      />
      <div className="pointer-events-none absolute bottom-8 left-1/2 z-10 flex max-w-[90%] -translate-x-1/2 flex-col items-center gap-1 text-sm">
        {notice && <p className="rounded-full bg-slate-900/85 px-3 py-1 text-white">{notice}</p>}
        <p className="rounded-full bg-white/95 px-3 py-1 text-slate-700 shadow" role="note">
          {HINTS[tool]}
        </p>
      </div>
      {panel ? sidePanel && createPortal(sidePanel, panel) : sidePanel}
      {!profile && error && (
        <p className="absolute top-3 right-14 z-10 rounded bg-red-50 px-2 py-1 text-sm text-red-700">
          {error}
        </p>
      )}
    </>
  );
}
