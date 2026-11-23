import { Marker, type Map as MapLibreMap, type MapMouseEvent } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { activeLanguage, tNow, useI18n } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/messages";
import { hashText } from "../../projects/inputKey";
import { SavedResultNotice } from "../../projects/SavedResultNotice";
import { fetchMainTiles, fetchStreetTile, loadWasmEngine } from "./engine";
import { LinePanel, type PanelActions } from "./LinePanel";
import {
  drawLine,
  drawOtherLines,
  drawRoads,
  ensureLayers,
  HIT_LAYER,
  OTHERS_HIT_LAYER,
  removeLayers,
  setLineColor,
} from "./mapLayers";
import { depotElement, pointElement } from "./markers";
import { fullTiming, MODES, type Timing } from "./modes";
import { profileWith, vehicleById } from "./service";
import {
  closedBySetups,
  keepRoutedLegs,
  lineBounds,
  lineTiles,
  routeKey,
  type RouteSurroundings,
  routesMore,
  type SavedStreetLine,
  streetLineColor,
  unroutedParts,
} from "./saved";
import { MIN_LOAD_ZOOM, tilesFor } from "./tiles";

/** Corridor tiles ("Main roads and railways only") loaded per round, after the tiles on screen. */
const MAIN_BATCH = 24;
import type { StreetLineInput } from "../journey-planner/network";
import { depotFit, depotGates, lineVehicle } from "../depots/model";
import type { SavedDepot } from "../depots/types";
import type { StreetSetup } from "../street-setup/types";
import { basemapLabels, featuresFromLabels, preferTransitKind } from "../naming/labels";
import {
  describeChoice,
  describeClash,
  nameForNewPlace,
  type NamedPlace,
  renamePlace,
} from "../naming/names";
import { placesOtherThan, publishPlaces } from "../naming/registry";
import { ToolPalette, type Tool } from "./ToolPalette";
import type {
  CorridorTiles,
  DelayShares,
  DepotTripView,
  EngineLoader,
  LineView,
  LonLat,
  PointKind,
  RoutingRules,
  StreetEngine,
  TileFetcher,
  VehicleProfile,
} from "./types";
import { nearestTerminal } from "./summary";
import { engineErrorText } from "../../i18n/engine";

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
  level_crossings: [],
  crossing_wait_s: 0,
};

/**
 * Purpose: a saved route with its points numbered 1, 2, 3… in order, as an engine that is given the points in
 * order numbers them, so the planner's first change applies to the same points once the engine holds the line.
 */
function numbered(view: LineView): LineView {
  const ids = new Map(view.points.map((p, i) => [p.id, i + 1]));
  const id = (n: number) => ids.get(n) ?? n;
  return {
    ...view,
    points: view.points.map((p, i) => ({ ...p, id: i + 1 })),
    legs: view.legs.map((l) => ({ ...l, from: id(l.from), to: id(l.to) })),
    directions: view.directions.map((d) => ({ ...d, stops: d.stops.map(id) })),
    station_groups: view.station_groups.map((g) => ({ ...g, stops: g.stops.map(id) })),
    depot_trips: view.depot_trips.map((t) => ({ ...t, stop: id(t.stop) })),
  };
}

const NO_SURROUNDINGS: RouteSurroundings = { setups: "", delays: "", gates: "", crossings: "" };

const HINTS: Record<Tool, MessageKey> = {
  select: "street.hint.select",
  add: "street.hint.add",
  pan: "rail.hint.pan",
  depot: "street.hint.depot",
};

/** Purpose: the stops of a line as named places for stop naming and station groups. */
function stopPlaces(view: LineView): NamedPlace[] {
  return view.points
    .filter((p) => p.kind !== "via")
    .map((p) => ({ id: `street:${p.id}`, name: p.name, lonlat: p.lonlat }));
}

const NO_SETUPS: readonly StreetSetup[] = [];
const NO_LINES: readonly SavedStreetLine[] = [];
const NO_DEPOTS: readonly SavedDepot[] = [];

interface Props {
  /** The map to draw on; `null` until the map has loaded. */
  map: MapLibreMap | null;
  /** Where the side panel renders; inline when `null`. */
  panel?: HTMLElement | null;
  /** Engine loader; tests inject a fake. */
  loadEngine?: EngineLoader;
  /** Street tile source; tests inject a fake. */
  fetchTile?: TileFetcher;
  /** The project's "Main roads and railways only" and Full tiles, whose main roads load in the background. */
  fetchMain?: () => Promise<CorridorTiles>;
  /** Told about the line after every change, so the journey planner can ride it. */
  onLineChange?: (line: StreetLineInput) => void;
  /**
   * The track topology last built in the railway tool (contracts/rail-topology.schema.json): the line
   * waits at its level crossings.
   */
  railTopology?: unknown;
  /**
   * The project's street rules (Project preferences): driving side, station grouping and detour warning.
   * They apply to every street line and take the place of the rules a line was saved with.
   */
  projectRules?: ProjectRules;
  /** The planner's street setups from the GIS tab (bus lanes, separation…), over OSM. */
  streetSetups?: readonly StreetSetup[];
  /** The project's delays in traffic (Project preferences); the library's when absent. */
  delays?: DelayShares | null;
  /**
   * The line saved with the project. Its saved route shows as it is and is routed again only when the planner
   * changes the line or recalculates an out-of-date route (a line saved before routes had a fingerprint is
   * routed again once the streets around it have loaded, and saved with one).
   */
  initial?: SavedStreetLine | null;
  /** Told about the line after every change the planner makes, so the project can save it. */
  onSave?: (line: SavedStreetLine) => void;
  /** Name for a new line (the project's other lines have theirs). */
  defaultName?: string;
  /** Colour of a new line (the next one no line uses). */
  defaultColor?: string;
  /** The project's other street lines, drawn faded under this one. */
  otherLines?: readonly SavedStreetLine[];
  /** Called with a saved line's id when the planner clicks it on the map (Select tool), to edit it instead. */
  onPickLine?: (id: string) => void;
  /** The list of the project's lines (switch, add, delete), shown at the top of the panel. */
  lineList?: React.ReactNode;
  /** The project's shared road depots; the line pulls out of and in to one of them through its gates. */
  depots?: readonly SavedDepot[];
  /** Opens the depot tool (Create tab), to draw a depot. */
  onOpenDepots?: () => void;
}

/** The street rules a project sets in its preferences; a missing one keeps the line's own. */
export type ProjectRules = Partial<
  Pick<RoutingRules, "traffic_side" | "grouping_distance_m" | "detour_warn_m">
>;

/**
 * Purpose: street line tool for bus, BRT, trolleybus and intercity bus (ADR-0029), laid out like the
 * line and track drawing mockup. Streets for the area on screen load automatically. The planner adds
 * points in order; the route follows legal streets and closes back to the first point. Points can be
 * dragged, inserted (click on the line), deleted, and promoted to stops or end stops; a depot adds
 * routed pull-out and pull-in runs. The routing rules come from the project preferences.
 * Side effects: adds layers, markers and handlers to the map while mounted; fetches street tiles.
 */
export function StreetLineEditor({
  map,
  panel = null,
  loadEngine = loadWasmEngine,
  fetchTile = fetchStreetTile,
  fetchMain = fetchMainTiles,
  onLineChange,
  railTopology = null,
  projectRules,
  streetSetups = NO_SETUPS,
  delays = null,
  initial = null,
  onSave,
  defaultName,
  defaultColor,
  otherLines = NO_LINES,
  onPickLine,
  lineList = null,
  depots = NO_DEPOTS,
  onOpenDepots,
}: Props) {
  const { t } = useI18n();
  const engine = useRef<StreetEngine | null>(null);
  // A saved route with a fingerprint opens as saved: the engine is given the line only when the planner changes
  // it or recalculates it (`hydrated`). A new line, or one saved before routes had a fingerprint, is routed by
  // the engine from the start, and so is a saved route with legs or depot runs not found: the streets that load
  // as it opens may complete it, and the fuller route is then saved for Tables, costs and the appraisal.
  const savedRoute0 =
    initial && initial.view.points.length > 0 && initial.routedWith && !unroutedParts(initial.view)
      ? initial
      : null;
  const hydrated = useRef(savedRoute0 === null);
  const [asSaved, setAsSaved] = useState(savedRoute0 !== null);
  // The saved line until it has been routed again; nothing is saved before that.
  const pending = useRef(savedRoute0 ? null : initial);
  // The line the editor opened with, also when its saved route is shown as saved (its vehicle and rules).
  const opened = useRef(initial);
  // Names the planner gave (or the naming rules chose), by point id; other points take the street's name.
  const named = useRef<Map<number, string>>(
    new Map((savedRoute0?.points ?? []).flatMap((p, i) => (p.name ? [[i + 1, p.name] as const] : []))),
  );
  // Facilities of stops by point id, saved with the points.
  const [stopFeatures, setStopFeatures] = useState<Record<number, string[]>>(() =>
    Object.fromEntries(
      (savedRoute0?.points ?? []).flatMap((p, i) => (p.features?.length ? [[i + 1, p.features]] : [])),
    ),
  );
  const [view, setView] = useState<LineView>(() => (savedRoute0 ? numbered(savedRoute0.view) : EMPTY_VIEW));
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<VehicleProfile | null>(null);
  const [rules, setRules] = useState<RoutingRules | null>(null);
  const [timing, setTiming] = useState<Timing>(fullTiming(initial?.timing));
  const [vehicle, setVehicle] = useState<string | null>(vehicleById(initial?.vehicle)?.id ?? null);
  const [lineName, setLineName] = useState(initial?.name ?? defaultName ?? tNow("street.defaultName"));
  // The line's own colour; absent (a line saved before lines had colours, no default given): its mode's.
  const [lineColor, setOwnColor] = useState<string | null>(initial?.color ?? defaultColor ?? null);
  const [tool, setTool] = useState<Tool>("add");
  const [selected, setSelected] = useState<number | null>(null);
  const [depotStops, setDepotStops] = useState<{ out?: number; in?: number }>(() => {
    const d = savedRoute0?.depotStops;
    return {
      ...(d?.out !== undefined && { out: d.out + 1 }),
      ...(d?.in !== undefined && { in: d.in + 1 }),
    };
  });
  const [depotId, setDepotId] = useState<string | null>(initial?.depotId ?? null);
  const [showDepot, setShowDepot] = useState(true);
  const [showRoads, setShowRoads] = useState(false);
  const [status, setStatus] = useState<string | null>(tNow("street.starting"));
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // What the route depends on besides the line: as the props give it now, and as the engine last applied it.
  const sharedDepot = depotId ? (depots.find((d) => d.id === depotId) ?? null) : null;
  const gatesKey = depotId ? (sharedDepot ? JSON.stringify(depotGates(sharedDepot)) : "gone") : "";
  const setupsJson = JSON.stringify(streetSetups);
  const delaysJson = delays ? JSON.stringify(delays) : "";
  const topologyText = railTopology ? JSON.stringify(railTopology) : "";
  const crossingsKey = useMemo(() => (topologyText ? hashText(topologyText) : ""), [topologyText]);
  const projectRulesKey = JSON.stringify(projectRules ?? {});
  const applied = useRef<RouteSurroundings>({ ...NO_SURROUNDINGS });
  const [routedAround, setRoutedAround] = useState<RouteSurroundings>(NO_SURROUNDINGS);
  const gatesNow = useRef(gatesKey);
  gatesNow.current = gatesKey;
  // Whether the saved route shown no longer matches what it depends on.
  const savedStale =
    asSaved && savedRoute0
      ? routeKey(
          {
            ...savedRoute0,
            rules: { ...savedRoute0.rules, ...(JSON.parse(projectRulesKey) as ProjectRules) },
          },
          { setups: setupsJson, delays: delaysJson, gates: gatesKey, crossings: crossingsKey },
        ) !== savedRoute0.routedWith
      : false;

  // The project's rules as the engine loads; later changes are applied by the effect below.
  const projectRulesNow = useRef(projectRules);
  projectRulesNow.current = projectRules;

  // Latest values for map and keyboard handlers registered once.
  const latest = useRef({ tool, view, selected });
  latest.current = { tool, view, selected };
  // The palette's Bus depot opens the shared depot editor when the workspace has one; otherwise it places
  // the line's own depot gate. The panel's "move depot" still places the line's own gate either way.
  const openDepots = useRef(onOpenDepots);
  openDepots.current = onOpenDepots;
  const pickTool = useCallback((t: Tool) => {
    if (t === "depot" && openDepots.current) openDepots.current();
    else setTool(t);
  }, []);

  /**
   * Gives the engine the saved line, in order, with its names and depot: the route is worked out again. Output:
   * whether the engine numbered the points as the saved route shown (1, 2, 3…), so a change can follow.
   */
  const hydrate = useCallback(
    (e: StreetEngine): boolean => {
      hydrated.current = true;
      setAsSaved(false);
      const saved = savedRoute0;
      if (!saved) return true;
      let v = e.view();
      saved.points.forEach((p, i) => {
        v = e.insertPoint(i, p.lonlat, p.kind);
        const id = v.points[i]?.id;
        if (id !== undefined && p.name) v = e.setName(id, p.name);
      });
      if (saved.depot) v = e.setDepot(saved.depot);
      else if (gatesNow.current && gatesNow.current !== "gone") {
        const g = JSON.parse(gatesNow.current) as ReturnType<typeof depotGates>;
        v = e.setDepotGates(g.exits, g.entrances);
        applied.current.gates = gatesNow.current;
      }
      return v.points.every((p, i) => p.id === i + 1);
    },
    // The saved line is the one the editor opened with.
    [],
  );

  /**
   * Applies `f` to the engine and shows the line it gives. `edit`: a change the planner makes (a saved line
   * shown as saved goes to the engine first); otherwise a setting the engine keeps, while a saved route shown
   * stays as it is.
   */
  const run = useCallback(
    (f: (e: StreetEngine) => LineView, edit = true) => {
      const e = engine.current;
      if (!e) return;
      try {
        setNote(null);
        if (!hydrated.current) {
          if (!edit) {
            f(e);
            return;
          }
          if (!hydrate(e)) {
            // The engine numbered the points otherwise: show the line it routed; the change is not applied.
            setView(e.view());
            setRoutedAround({ ...applied.current });
            return;
          }
        }
        setView(f(e));
        // A change shows the line as the engine routes it now, no longer as saved.
        if (edit) setAsSaved(false);
        setRoutedAround({ ...applied.current });
        setError(null);
      } catch (err) {
        setError(engineErrorText(err));
      }
    },
    [hydrate],
  );

  useEffect(() => {
    let alive = true;
    loadEngine()
      .then((e) => {
        if (!alive) return e.dispose();
        // Streets, and the stops named after them, in the page's language where OSM has it (name:en).
        e.setLanguage?.(activeLanguage());
        engine.current = e;
        const saved = pending.current ?? opened.current;
        const p = saved?.profile ?? e.defaultProfile("bus");
        const r = { ...e.defaultRules(), ...saved?.rules, ...projectRulesNow.current };
        e.setSettings(p, r);
        setProfile(p);
        setRules(r);
        setStatus(null);
      })
      .catch((err) => setError(tNow("street.engineFailed", { error: engineErrorText(err) })));
    return () => {
      alive = false;
      engine.current?.dispose();
      engine.current = null;
    };
  }, [loadEngine]);

  // A saved line opens with the map on it, close enough for its streets to load.
  useEffect(() => {
    const saved = pending.current;
    const b = saved && lineBounds(saved);
    if (!map || !b) return;
    map.fitBounds(
      [
        [b[0], b[1]],
        [b[2], b[3]],
      ],
      { padding: 60, duration: 0, maxZoom: 16 },
    );
    if (map.getZoom() < MIN_LOAD_ZOOM)
      map.jumpTo({ center: saved.points[0]?.lonlat ?? saved.depot!, zoom: MIN_LOAD_ZOOM });
  }, [map]);

  // Once streets have loaded, route the saved points again, in order, with their kinds, names and depot.
  useEffect(() => {
    const saved = pending.current;
    if (!ready || !saved || !engine.current) return;
    pending.current = null;
    run((e) => {
      let v = e.view();
      saved.points.forEach((p, i) => {
        v = e.insertPoint(i, p.lonlat, p.kind);
        const id = v.points[i]?.id;
        if (id !== undefined && p.name) {
          named.current.set(id, p.name);
          v = e.setName(id, p.name);
        }
        if (id !== undefined && p.features?.length) {
          const f = p.features;
          setStopFeatures((m) => ({ ...m, [id]: f }));
        }
      });
      if (saved.depot) v = e.setDepot(saved.depot);
      const idAt = (i: number | undefined) => (i === undefined ? undefined : v.points[i]?.id);
      setDepotStops({ out: idAt(saved.depotStops.out), in: idAt(saved.depotStops.in) });
      // A leg whose streets are still missing keeps the route it was saved with, not a dashed straight line.
      return keepRoutedLegs(v, saved.view);
    });
  }, [ready, run]);

  // A saved route out of date because the GIS tab's street layouts now close streets it drives along (the
  // planner chose "Save anyway" there): once its streets have loaded it is routed again, so the closed legs show
  // their warnings and the way they went as red dashes, and the route that goes round them is saved. Any other
  // out-of-date route stays shown as saved, with its notice, until the planner recalculates it.
  const closuresChecked = useRef(false);
  useEffect(() => {
    const e = engine.current;
    if (!ready || !savedStale || hydrated.current || closuresChecked.current || !e) return;
    closuresChecked.current = true;
    try {
      if (!hydrate(e)) {
        setView(e.view());
        setRoutedAround({ ...applied.current });
        return;
      }
      const v = e.view();
      if (closedBySetups(v)) {
        setView(v);
        setRoutedAround({ ...applied.current });
      } else setAsSaved(true);
    } catch (err) {
      setError(engineErrorText(err));
    }
  }, [ready, savedStale, hydrate]);

  // A shared depot: the depot runs start at its exit gates and end at its entrance gates, again whenever
  // the depot's gates change. A depot deleted from the project leaves the line without depot runs.
  useEffect(() => {
    if (!ready || pending.current || !gatesKey) return;
    applied.current.gates = gatesKey;
    if (gatesKey === "gone") run((e) => e.clearDepot(), false);
    else {
      const g = JSON.parse(gatesKey) as ReturnType<typeof depotGates>;
      run((e) => e.setDepotGates(g.exits, g.entrances), false);
    }
  }, [gatesKey, ready, run]);

  // Street setups from the GIS tab: bus lanes and separation change running times and checks.
  useEffect(() => {
    if (!profile) return;
    applied.current.setups = setupsJson;
    run((e) => e.setStreetSetups(JSON.parse(setupsJson) as StreetSetup[]), false);
  }, [setupsJson, profile !== null, run]);

  // The project's delays in traffic: running times on main roads and in painted bus lanes.
  useEffect(() => {
    if (!profile || !delaysJson) return;
    applied.current.delays = delaysJson;
    run(
      (e) => (e.setDelayShares ? e.setDelayShares(JSON.parse(delaysJson) as DelayShares) : e.view()),
      false,
    );
  }, [delaysJson, profile !== null, run]);

  // Streets: load the tiles on screen whenever the map stops moving, then rebuild once per batch.
  const tiles = useRef(new Set<string>());
  // The tiles under a saved line, loaded with the first view whatever the zoom: routing it again needs all of
  // its streets, not only those on screen.
  const lineTileKeys = useRef<string[]>(initial ? lineTiles(initial) : []);
  const [zoomedOut, setZoomedOut] = useState(false);
  useEffect(() => {
    if (!map || !profile) return;
    let busy = false;
    let again = false;
    let stopped = false;
    // Corridor tiles still to load in the background; `light` for the tiles of Full polygons, of which only the
    // main roads are wanted until the map shows them.
    let mainQueue: { key: string; light: boolean }[] | null = null;
    const lightDone = new Set<string>();
    const load = async () => {
      const e = engine.current;
      if (!e || stopped) return;
      if (busy) {
        again = true;
        return;
      }
      const tooFar = map.getZoom() < MIN_LOAD_ZOOM;
      setZoomedOut(tooFar);
      const line = lineTileKeys.current;
      lineTileKeys.current = [];
      const b = map.getBounds();
      const onScreen = tooFar
        ? []
        : tilesFor([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]).map(([x, y]) => `${x}/${y}`);
      // Then, a batch at a time, the light tiles of the corridors drawn at "Main roads and railways only" and the
      // main roads of the towns between them.
      if (mainQueue === null) {
        busy = true;
        const c = await fetchMain();
        mainQueue = [
          ...c.main.map((key) => ({ key, light: false })),
          ...c.full.map((key) => ({ key, light: true })),
        ];
        busy = false;
        if (stopped || engine.current !== e) return;
      }
      const near = [...new Set([...line, ...onScreen])].filter((k) => !tiles.current.has(k));
      const pending = (t: { key: string; light: boolean }) =>
        !tiles.current.has(t.key) && !near.includes(t.key) && !(t.light && lightDone.has(t.key));
      const corridor = mainQueue.filter(pending).slice(0, MAIN_BATCH);
      mainQueue = mainQueue.filter((t) => pending(t) && !corridor.includes(t));
      const want = [...near.map((key) => ({ key, light: false })), ...corridor];
      if (mainQueue.length) again = true;
      if (!want.length) {
        if (again) {
          again = false;
          void load();
        }
        return;
      }
      busy = true;
      const done = (t: { key: string; light: boolean }) => (t.light ? lightDone : tiles.current);
      want.forEach((t) => done(t).add(t.key));
      setStatus(tNow("street.loading"));
      const got = await Promise.allSettled(
        want.map((t) => {
          const [x, y] = t.key.split("/").map(Number);
          return t.light ? fetchTile(x!, y!, true) : fetchTile(x!, y!);
        }),
      );
      busy = false;
      if (stopped || engine.current !== e) {
        want.forEach((t) => done(t).delete(t.key));
        return;
      }
      let added = 0;
      let failed = 0;
      let reason: string | null = null;
      got.forEach((r, i) => {
        try {
          if (r.status === "rejected") throw r.reason;
          e.addOsm(r.value);
          added++;
        } catch (err) {
          done(want[i]!).delete(want[i]!.key);
          failed++;
          reason ??= err instanceof Error ? err.message : null;
        }
      });
      if (added) run((eng) => keepRoutedLegs(eng.rebuild(), initial?.view), false);
      setReady(e.ready());
      setStatus(failed ? `${reason ?? tNow("rail.streetsFailed")} ${tNow("rail.moveMap")}` : null);
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
  }, [map, profile !== null, fetchTile, fetchMain, run]);

  // Level crossings: from the railway tool's drawing, with the service its topology assumes.
  useEffect(() => {
    if (!profile) return;
    applied.current.crossings = crossingsKey;
    run((e) => e.setLevelCrossings(topologyText, ""), false);
  }, [profile !== null, topologyText, crossingsKey, run]);

  // The project's street rules, again whenever they change in the project preferences.
  useEffect(() => {
    if (!profile || !rules) return;
    const r = { ...rules, ...(JSON.parse(projectRulesKey) as ProjectRules) };
    if (JSON.stringify(r) === JSON.stringify(rules)) return;
    setRules(r);
    run((e) => e.setSettings(profile, r), false);
  }, [projectRulesKey, profile !== null, rules !== null, run]);

  const color = lineColor ?? (profile ? MODES[profile.mode].color : MODES.bus.color);
  const lineChanged = useRef(onLineChange);
  lineChanged.current = onLineChange;
  useEffect(() => {
    lineChanged.current?.({
      name: lineName,
      mode: profile?.mode ?? "bus",
      color,
      view,
      dwellS: timing.dwellS,
      headwayMin: timing.headwayMin,
      offPeakHeadwayMin: timing.offPeakHeadwayMin,
      firstMin: timing.firstMin,
      lastMin: timing.lastMin,
    });
  }, [
    view,
    lineName,
    profile?.mode,
    color,
    timing.dwellS,
    timing.headwayMin,
    timing.offPeakHeadwayMin,
    timing.firstMin,
    timing.lastMin,
  ]);
  const terminals = [...new Set(view.depot_trips.map((t) => t.stop))];
  const pick = (s: number | undefined, kind: DepotTripView["kind"]) =>
    s !== undefined && terminals.includes(s) ? s : nearestTerminal(view.depot_trips, kind);
  const shownDepot = { out: pick(depotStops.out, "pull_out"), in: pick(depotStops.in, "pull_in") };

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
    if (map && map.getSource("sl-others"))
      drawOtherLines(
        map,
        otherLines.map((l) => ({
          view: l.view,
          color: streetLineColor(l),
          id: l.id,
        })),
      );
  }, [map, otherLines, rules?.traffic_side]);

  useEffect(() => {
    if (map && map.getSource("sl-roads"))
      drawRoads(map, showRoads && engine.current ? engine.current.usableRoads() : null);
  }, [map, profile, ready, showRoads, rules?.traffic_side]);

  const pickLine = useRef(onPickLine);
  pickLine.current = onPickLine;

  // Map clicks: add or insert a point, place the depot, or clear the selection.
  useEffect(() => {
    if (!map) return;
    const onClick = (ev: MapMouseEvent) => {
      const { tool: t, view: v } = latest.current;
      if (!engine.current) return;
      const at: LonLat = [ev.lngLat.lng, ev.lngLat.lat];
      if (t === "depot") {
        // A depot gate placed on the map is the line's own depot, in place of a shared one.
        setDepotId(null);
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
        // Another line under the click: edit that one.
        const { x, y } = ev.point;
        const box: [[number, number], [number, number]] = [
          [x - 4, y - 4],
          [x + 4, y + 4],
        ];
        const other = map.getLayer(OTHERS_HIT_LAYER)
          ? map.queryRenderedFeatures(box, { layers: [OTHERS_HIT_LAYER] })[0]?.properties?.line
          : null;
        if (typeof other === "string" && pickLine.current) pickLine.current(other);
        else setSelected(null);
      }
    };
    // Select: press on the line and drag to pull a new via point out of it (the map does not pan meanwhile).
    let pull: { seq: number; x: number; y: number } | null = null;
    const onDown = (ev: MapMouseEvent) => {
      if (latest.current.tool !== "select" || !map.getLayer(HIT_LAYER)) return;
      const { x, y } = ev.point;
      const hit = map.queryRenderedFeatures(
        [
          [x - 3, y - 3],
          [x + 3, y + 3],
        ],
        { layers: [HIT_LAYER] },
      )[0]?.properties?.index;
      if (hit === undefined) return;
      pull = { seq: Number(hit) + 1, x, y };
      map.dragPan.disable();
    };
    const onUp = (ev: MapMouseEvent) => {
      if (!pull) return;
      const p = pull;
      pull = null;
      map.dragPan.enable();
      if (Math.hypot(ev.point.x - p.x, ev.point.y - p.y) < 5) return;
      run((e) => e.insertPoint(p.seq, [ev.lngLat.lng, ev.lngLat.lat], "via"));
    };
    // Lines that can be clicked or pulled show a pointer.
    const onHover = (ev: MapMouseEvent) => {
      if (latest.current.tool !== "select" || pull) return;
      const layers = [HIT_LAYER, OTHERS_HIT_LAYER].filter((l) => map.getLayer(l));
      const { x, y } = ev.point;
      const over = layers.length
        ? map.queryRenderedFeatures(
            [
              [x - 3, y - 3],
              [x + 3, y + 3],
            ],
            { layers },
          ).length > 0
        : false;
      map.getCanvas().style.cursor = over ? "pointer" : "";
    };
    map.on("click", onClick);
    map.on("mousedown", onDown);
    map.on("mouseup", onUp);
    map.on("mousemove", onHover);
    return () => {
      map.off("click", onClick);
      map.off("mousedown", onDown);
      map.off("mouseup", onUp);
      map.off("mousemove", onHover);
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
      // A shared depot's gates move in the depot tool only.
      const m = new Marker({ element: depotElement(), draggable: draggable && !depotId })
        .setLngLat(view.depot)
        .addTo(map);
      m.on("dragend", () => {
        const { lng, lat } = m.getLngLat();
        run((e) => e.setDepot([lng, lat]));
      });
      markers.push(m);
    }
    return () => markers.forEach((m) => m.remove());
  }, [map, view, selected, color, tool, run, depotId]);

  // Keyboard: V, P, H and D pick tools; Delete removes the selected point; Escape stops what is going on.
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
      else if (key === "d") pickTool("depot");
      else if ((ev.key === "Delete" || ev.key === "Backspace") && sel !== null) {
        run((e) => e.deletePoint(sel));
        setSelected(null);
      } else if (ev.key === "Escape") {
        // First stop what is going on (adding points, placing the depot, panning), then clear the selection.
        if (latest.current.tool !== "select") setTool("select");
        else setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run, pickTool]);

  // Other tools see this line's stops, so a station drawn next to one takes its name.
  useEffect(() => publishPlaces("street", stopPlaces(view)), [view]);

  const groupingM = rules?.grouping_distance_m;

  /** Purpose: name a point (empty: the street's name again) and remember it for saving. */
  const nameIt = (e: StreetEngine, id: number, name: string) => {
    if (name.trim()) named.current.set(id, name);
    else named.current.delete(id);
    return e.setName(id, name);
  };

  // Save what the planner changed: points, kinds, names, depot, settings and timing. The route goes along
  // for the journey planner, but routing again on its own (new streets loaded) is not a change to save.
  const saveTo = useRef(onSave);
  saveTo.current = onSave;
  const drawn = useRef(initial !== null);
  const latestView = useRef(view);
  latestView.current = view;
  const ids = new Map(view.points.map((p, i) => [p.id, i]));
  const drawnNow: Omit<SavedStreetLine, "view" | "routedWith"> | null =
    profile && rules
      ? {
          name: lineName,
          ...(lineColor ? { color: lineColor } : {}),
          profile,
          vehicle,
          rules,
          timing,
          points: view.points.map((p) => ({
            lonlat: p.lonlat,
            kind: p.kind,
            name: named.current.get(p.id) ?? null,
            ...(p.kind !== "via" && stopFeatures[p.id]?.length ? { features: stopFeatures[p.id] } : {}),
          })),
          depot: depotId ? null : view.depot,
          ...(depotId ? { depotId } : {}),
          depotStops: {
            ...(depotStops.out !== undefined && ids.has(depotStops.out) && { out: ids.get(depotStops.out) }),
            ...(depotStops.in !== undefined && ids.has(depotStops.in) && { in: ids.get(depotStops.in) }),
          },
        }
      : null;
  // The route goes with the fingerprint of what it was worked out from: as saved while the saved route shows.
  const saved: Omit<SavedStreetLine, "view"> | null = drawnNow && {
    ...drawnNow,
    routedWith: asSaved && savedRoute0 ? savedRoute0.routedWith : routeKey(drawnNow, routedAround),
  };
  const savedKey = saved && pending.current === null ? JSON.stringify(saved) : null;
  const lastKey = useRef<string | null>(null);
  // The route as last saved; streets that load later and find more of it save it again.
  const savedRoute = useRef(initial?.view ?? null);
  useEffect(() => {
    if (!savedKey || savedKey === lastKey.current) return;
    const first = lastKey.current === null;
    lastKey.current = savedKey;
    const line = JSON.parse(savedKey) as Omit<SavedStreetLine, "view">;
    drawn.current ||= line.points.length > 0 || line.depot !== null || !!line.depotId;
    // Opening the tool is not a change; the first state after opening is only saved for a new drawing, for a
    // line that was never routed (one made from an imported GTFS route), or for a line saved before routes had
    // a fingerprint (routed again on opening, and saved with one so it opens as saved from then on).
    if (first && initial !== null && initial.view.points.length > 0 && initial.routedWith) return;
    if (drawn.current) {
      savedRoute.current = latestView.current;
      saveTo.current?.({ ...line, view: latestView.current });
    }
  }, [savedKey]);

  // Tables, costs and the appraisal read the saved route, so a route that more streets complete is saved
  // too, not only the planner's changes. A route with parts still missing never replaces a fuller one.
  useEffect(() => {
    const before = savedRoute.current;
    if (!lastKey.current || lastKey.current !== savedKey || !before || !routesMore(view, before)) return;
    savedRoute.current = view;
    saveTo.current?.({ ...(JSON.parse(lastKey.current) as Omit<SavedStreetLine, "view">), view });
  }, [view, savedKey]);

  /** A via point that becomes a stop joins a stop nearby, or is named after what is around it. */
  const setKind = (id: number, kind: PointKind) =>
    run((e) => {
      const was = latest.current.view.points.find((p) => p.id === id)?.kind;
      let v = e.setKind(id, kind);
      const p = v.points.find((q) => q.id === id);
      if (was !== "via" || kind === "via" || !p) return v;
      const places = [...placesOtherThan("street"), ...stopPlaces(v).filter((q) => q.id !== `street:${id}`)];
      const features = preferTransitKind(featuresFromLabels(basemapLabels(map, p.lonlat), p.lonlat), "bus");
      const choice = nameForNewPlace(p.lonlat, {
        places,
        features,
        fallback: p.name,
        radiusM: groupingM,
        language: activeLanguage(),
      });
      if (choice.name !== p.name) v = nameIt(e, id, choice.name);
      setNote(describeChoice(choice, "stop"));
      return v;
    });

  /** Renaming a stop renames its whole station group; a name used farther away gets a number. */
  const setPointName = (id: number, name: string) =>
    run((e) => {
      const v0 = latest.current.view;
      if (!name.trim() || v0.points.find((p) => p.id === id)?.kind === "via") return nameIt(e, id, name);
      const r = renamePlace(
        `street:${id}`,
        name,
        [...placesOtherThan("street"), ...stopPlaces(v0)],
        groupingM,
      );
      let v = v0;
      for (const m of r.members) if (m.startsWith("street:")) v = nameIt(e, Number(m.slice(7)), r.name);
      setNote(describeClash(r, groupingM));
      return v;
    });

  const settings = (p: VehicleProfile, r: RoutingRules) => {
    setProfile(p);
    setRules(r);
    run((e) => e.setSettings(p, r));
  };

  const actions: PanelActions = {
    setName: setLineName,
    setColor: setOwnColor,
    setPointFeatures: (id, f) => setStopFeatures((m) => ({ ...m, [id]: f })),
    setMode: (m) => {
      if (!engine.current || !rules) return;
      setVehicle(null);
      settings(engine.current.defaultProfile(m), rules);
    },
    setVehicle: (id) => {
      const v = vehicleById(id);
      if (!engine.current || !profile || !rules) return;
      setVehicle(v?.id ?? null);
      const base = engine.current.defaultProfile(profile.mode);
      const keep = { battery_range_m: profile.battery_range_m, doors_both_sides: profile.doors_both_sides };
      settings(v ? profileWith({ ...base, ...keep }, v) : { ...base, ...keep }, rules);
    },
    setProfile: (p) => rules && settings(p, rules),
    setTiming,
    select: setSelected,
    setKind,
    switchSide: (id) => run((e) => e.switchSide(id)),
    sideCost: (id) => {
      const c = engine.current?.sideCost(id);
      return c === undefined || Number.isNaN(c) ? null : c;
    },
    setPointName,
    deletePoint: (id) => {
      run((e) => e.deletePoint(id));
      setSelected(null);
    },
    optimise: () => run((e) => e.optimise()),
    clear: () => {
      run((e) => e.clear());
      setSelected(null);
    },
    placeDepot: () => setTool("depot"),
    removeDepot: () => run((e) => e.clearDepot()),
    chooseDepot: (id) => {
      setDepotId(id);
      if (!id) run((e) => e.clearDepot());
    },
    setDepotStops,
    setShowDepot,
    setShowRoads,
  };

  const notice = zoomedOut && !ready ? t("street.zoomStreet") : zoomedOut ? t("street.zoomArea") : status;

  const sidePanel = profile && rules && (
    <LinePanel
      lineName={lineName}
      lineColor={color}
      view={view}
      profile={profile}
      timing={timing}
      vehicle={vehicle}
      lineList={lineList}
      selected={selected}
      depotStops={shownDepot}
      depotId={depotId}
      depots={depots.map((d) => ({ id: d.id, name: d.name, problem: depotFit(d, { profile, vehicle }) }))}
      vehicleLengthM={lineVehicle({ profile, vehicle }).length_m}
      showDepot={showDepot}
      showRoads={showRoads}
      crossingSource={railTopology ? t("street.drawingSource") : null}
      status={null}
      error={error}
      routeNotice={
        savedStale ? <SavedResultNotice state="stale" onRecalculate={() => run((e) => e.view())} /> : null
      }
      actions={actions}
      stopFeatures={stopFeatures}
    />
  );

  return (
    <>
      <ToolPalette tool={tool} onTool={pickTool} />
      {/* On phones the hints sit beside the tool palette, not over its lower tools; centred from md up. */}
      <div className="pointer-events-none absolute right-3 bottom-8 left-[12.25rem] z-10 flex flex-col items-end gap-1 text-sm md:right-auto md:left-1/2 md:max-w-[90%] md:-translate-x-1/2 md:items-center">
        {notice && <p className="rounded-full bg-slate-900/85 px-3 py-1 text-white">{notice}</p>}
        {note && (
          <p className="rounded-full bg-blue-700 px-3 py-1 text-white" role="status">
            {note}
          </p>
        )}
        <p className="rounded-2xl bg-white/95 px-3 py-1 text-slate-700 shadow md:rounded-full" role="note">
          {t(HINTS[tool])}
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
