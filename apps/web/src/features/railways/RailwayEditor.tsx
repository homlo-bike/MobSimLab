import { Marker, type Map as MapLibreMap } from "maplibre-gl";
import { useVehiclesOff } from "../../workspace/projectVehicles";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { tNow, useI18n } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/messages";
import { fetchStreetTile } from "../street-lines/engine";
import type { DelayShares, TileFetcher } from "../street-lines/types";
import type { StreetSetup } from "../street-setup/types";
import {
  autoLeads,
  deleteElement,
  emptyNetwork,
  newTrack,
  stationPlaces,
  resetSignals,
  type LocalConnection,
} from "./doc";
import { labelElement } from "./editorDom";
import { drawServiceLines, removeServiceLines, serviceLinePaths, serviceLineStops } from "./linePaths";
import {
  type Cursor,
  type Dragging,
  draftLevel,
  type EditorState,
  sameAnchor,
  type Selection,
  sigs,
} from "./editorState";
import { fetchRailTile, loadRailEngine } from "./engine";
import { describeClash, renamePlace, STATION_GROUPING_M } from "../naming/names";
import { placesOtherThan, publishPlaces } from "../naming/registry";
import {
  CONNECTION_LAYER,
  drawRail,
  drawTrackEnds,
  ensureRailLayers,
  removeRailLayers,
  showConnections,
} from "./mapLayers";
import { freeTrackEnds, joinAtFreeEnds, type TrackEnd } from "./trackEnds";
import { COLORS } from "./modes";
import {
  RailPanel,
  type NewStationOpts,
  type NewSwitchOpts,
  type NewTrackOpts,
  type RailTool,
} from "./RailPanel";
import { RailToolPalette } from "./RailToolPalette";
import { addLine, linesTrainLength, removeLine } from "./serviceLines";
import { dayEngineLines, type DayPublications } from "../timetables/railPublish";
import { DAY_TYPES } from "../../workspace/calendar";
import type { ServiceCalendar } from "../../workspace/calendar";
import type { Publication } from "./ServiceLinesPanel";
import type {
  Anchor,
  ConnectionView,
  FeatureCollection,
  LonLat,
  Network,
  RailEngine,
  RailEngineLoader,
  RailMode,
  RailView,
  ServicePublication,
  SwitchChoice,
  Track,
} from "./types";
import type { Timetable } from "../journey-planner/types";
import { useEditHandles } from "./useEditHandles";
import { useEditorKeys } from "./useEditorKeys";
import { useMapEditing } from "./useMapEditing";
import { useRailTiles } from "./useRailTiles";
import { fetchTerrainHeights, useTerrainHeights } from "./useTerrainHeights";

const HINTS: Record<RailTool, MessageKey> = {
  select: "rail.hint.select",
  station: "rail.hint.station",
  track: "rail.hint.track",
  turnout: "rail.hint.turnout",
  crossover: "rail.hint.crossover",
  signal: "rail.hint.signal",
  pan: "rail.hint.pan",
  line: "rail.hint.line",
};

const NO_SETUPS: readonly StreetSetup[] = [];

/** Purpose: what a publication depends on: the drawing without its view-only parts. */
const publishKey = (d: Network) => JSON.stringify(d);

type Published = {
  result: ServicePublication | null;
  /** The track topology of the build the lines were published on: places their trains on the drawn track. */
  topology?: unknown;
  /** The publication of every day type with lines (weekday is `result`). */
  byDay?: DayPublications;
  error: string | null;
  key: string;
};

interface Props {
  /** The map; `null` until it has loaded. */
  map: MapLibreMap | null;
  /** Where the side panel renders; inline when `null`. */
  panel?: HTMLElement | null;
  /** Engine loader; tests inject a fake. */
  loadEngine?: RailEngineLoader;
  /** Street tile loader (OSM XML) for level crossings; tests inject a fake. */
  fetchTile?: TileFetcher;
  /**
   * Told the track topology (contracts/rail-topology.schema.json) whenever the level crossings change,
   * so the street line tool can add the expected wait at them to bus running times.
   */
  onTopologyChange?: (topology: unknown) => void;
  /** Railway tile loader (OSM XML) for existing railways; tests inject a fake. */
  fetchRails?: TileFetcher;
  /** Ground heights at points (m, null without data) for the tracks' vertical profiles; tests inject a fake. */
  fetchHeights?: (points: LonLat[]) => Promise<(number | null)[]>;
  /** Load and draw existing railways from OpenStreetMap (app setting, off by default). */
  existingRailways?: boolean;
  /** The planner's street setups from the GIS tab (tram own lane or mixed traffic…), over OSM. */
  streetSetups?: readonly StreetSetup[];
  /** The project's delays in traffic for trams in streets (Project preferences); the library's when absent. */
  delays?: DelayShares | null;
  /** The project's design rules per mode (Project preferences), as `<mode>.<field>`; the library's when absent. */
  designValues?: Readonly<Record<string, number>> | null;
  /** The project's text design values per mode (electrification, colour, level crossings, signalling). */
  designTexts?: Readonly<Record<string, string>> | null;
  /** The project's preference values by id (running values of the service lines: dwell, layover…). */
  prefValues?: Readonly<Record<string, number>> | null;
  /** The project calendar (peak windows of each day type); the default calendar when absent. */
  calendar?: ServiceCalendar;
  /** The project's choice from the switches and crossings catalogue (Project preferences); all when absent. */
  switchChoice?: SwitchChoice | null;
  /** Stations closer than this share a name, m (`analysis.station_grouping_m`); the library's when absent. */
  stationGroupingM?: number;
  /** The drawing saved with the project, or null to start a new one at the map centre. */
  initial?: Network | null;
  /** Told about the drawing after every change, so the project can save it. */
  onDocChange?: (doc: Network) => void;
  /** Called with the published service lines' timetable (`null` when withdrawn), for the journey planner. */
  onPublish?: (timetable: Timetable | null) => void;
}

export type { Selection } from "./editorState";

/** The default calendar (its day types' usual peaks). */
const NO_CALENDAR: ServiceCalendar = {};

/**
 * Purpose: railway design tool (ADR-0030, ADR-0033), laid out like the railways tab of the line
 * and track drawing mockup. The planner places stations, draws tracks between their connection
 * points, and places catalogue switches; the engine fits curves, levels and ramps, draws
 * everything to scale and checks the design live.
 * Side effects: adds layers, markers and handlers to the map while mounted.
 */
export function RailwayEditor({
  map,
  panel = null,
  loadEngine = loadRailEngine,
  fetchTile = fetchStreetTile,
  onTopologyChange,
  fetchRails = fetchRailTile,
  fetchHeights = fetchTerrainHeights,
  existingRailways = false,
  streetSetups = NO_SETUPS,
  delays = null,
  designValues = null,
  designTexts = null,
  prefValues = null,
  calendar = NO_CALENDAR,
  switchChoice = null,
  stationGroupingM = STATION_GROUPING_M,
  initial = null,
  onDocChange,
  onPublish,
}: Props) {
  const { t } = useI18n();
  const engine = useRef<RailEngine | null>(null);
  // Catalogue trains the project does not use (Project preferences → Vehicles).
  const vehiclesOff = useVehiclesOff();
  const [ready, setReady] = useState(false);
  const [doc, setDoc] = useState<Network | null>(initial);
  const [draft, setDraft] = useState<Track | null>(null);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [tool, setTool] = useState<RailTool>("station");
  const [sel, setSel] = useState<Selection | null>(null);
  const [trackOpts, setTrackOpts] = useState<NewTrackOpts>({
    tracks: 2,
    level: "street",
    power: "auto",
    use: "running",
  });
  const [stationOpts, setStationOpts] = useState<NewStationOpts>({ level: "street", sides: 0, islands: 1 });
  const [switchOpts, setSwitchOpts] = useState<NewSwitchOpts>({
    junction: true,
    scissors: false,
    element: null,
  });
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [published, setPublished] = useState<Published | null>(null);
  const [picking, setPicking] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadEngine()
      .then((e) => {
        if (!alive) return e.dispose();
        engine.current = e;
        setReady(true);
      })
      .catch((err) =>
        setError(tNow("rail.engineFailed", { error: err instanceof Error ? err.message : String(err) })),
      );
    return () => {
      alive = false;
      engine.current?.dispose();
      engine.current = null;
    };
  }, [loadEngine]);

  const { streets, setStreets, streetNote } = useRailTiles({
    map,
    ready,
    engine,
    fetchTile,
    fetchRails,
    existingRailways,
    streetSetups,
    delays,
    designValues,
    designTexts,
    switchChoice,
  });

  // A new drawing starts at the map centre.
  useEffect(() => {
    if (!map || doc) return;
    const c = map.getCenter();
    setDoc(emptyNetwork("metro", [c.lng, c.lat]));
  }, [map, doc]);
  // Save every change; an empty drawing only once something was drawn or saved before.
  const docChanged = useRef(onDocChange);
  docChanged.current = onDocChange;
  const drawn = useRef(initial !== null);
  useEffect(() => {
    if (!doc) return;
    drawn.current ||= doc.stations.length + doc.tracks.length + doc.switches.length > 0;
    if (drawn.current) docChanged.current?.(doc);
  }, [doc]);

  // Read through a ref so the callbacks built on it keep their identity while the drawing changes:
  // the edit handles are rebuilt when they change, which would end a drag after its first step.
  const docRef = useRef(doc);
  docRef.current = doc;
  const local = useCallback((ll: LonLat): [number, number] => {
    const d = docRef.current;
    return engine.current && d ? engine.current.toLocal(d.origin, ll) : [0, 0];
  }, []);

  // The draft with its end at the cursor (or the connection under it).
  const shown = useMemo(() => {
    if (!doc) return null;
    // Platforms are checked against the longest train of the service lines (the mode's default without lines).
    const withTrains = { ...doc, train_length_m: linesTrainLength(doc) };
    if (!draft) return { doc: withTrains, draftId: null };
    const end: Anchor | null = cursor?.conn
      ? cursor.conn.anchor
      : cursor
        ? { type: "free", x: cursor.at[0], y: cursor.at[1], level: draftLevel(draft) }
        : null;
    return { doc: { ...withTrains, tracks: [...doc.tracks, { ...draft, end }] }, draftId: draft.id };
  }, [doc, draft, cursor]);

  const view: RailView | null = useMemo(() => {
    if (!ready || !shown || !engine.current) return null;
    try {
      const v = engine.current.build(shown.doc, shown.draftId);
      setError(null);
      return v;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
    // `streets` changes when new streets arrive; the engine holds them.
  }, [ready, shown, streets]);
  const lastView = useRef<RailView | null>(null);
  if (view) lastView.current = view;

  const { terrainError, retryTerrain } = useTerrainHeights({ engine, view, draft, fetchHeights, setStreets });

  // A saved drawing opens with the map on it.
  const framed = useRef(initial === null);
  useEffect(() => {
    if (framed.current || !map || !view) return;
    framed.current = true;
    if (view.bbox)
      map.fitBounds(
        [
          [view.bbox[0], view.bbox[1]],
          [view.bbox[2], view.bbox[3]],
        ],
        { padding: 60, duration: 0, maxZoom: 17 },
      );
  }, [map, view]);

  // Share the topology with the street line tool when the level crossings change (not while drawing).
  const topologyChanged = useRef(onTopologyChange);
  topologyChanged.current = onTopologyChange;
  const crossingsKey = view && shown?.draftId === null ? JSON.stringify(view.level_crossings) : null;
  useEffect(() => {
    if (crossingsKey === null || !engine.current) return;
    topologyChanged.current?.(engine.current.topology());
  }, [crossingsKey]);

  const connLocal = useCallback(
    (a: Anchor): LocalConnection | null => {
      const c = lastView.current?.connections.find((x) => sameAnchor(x.anchor, a));
      if (!c) return null;
      const b = (c.bearing_deg * Math.PI) / 180;
      return { p: local(c.lonlat), dir: [Math.sin(b), Math.cos(b)] };
    },
    [local],
  );
  const minLead = view ? Math.max(8, view.params.recommended_radius_m * 0.08) : 20;

  // Layers.
  const lat = doc?.origin[1] ?? 50;
  useEffect(() => {
    if (!map) return;
    ensureRailLayers(map, lat);
    return () => removeRailLayers(map);
  }, [map, lat]);
  const selection: FeatureCollection = useMemo(() => {
    const features = [
      ...(view?.layers.tracks.features ?? []),
      ...(view?.layers.signals.features ?? []).filter((f) => f.geometry.type === "LineString"),
    ].filter((f) => sel && f.properties.ref === sel.id);
    return { type: "FeatureCollection", features };
  }, [view, sel]);
  useEffect(() => {
    if (map && view && map.getSource("rd-tracks")) drawRail(map, view, selection);
  }, [map, view, selection]);
  useEffect(() => {
    if (map) showConnections(map, tool === "track" || dragging.current?.kind === "end");
  }, [map, tool, view]);
  // The service lines on the map, like street lines: the tracks each line's trains use (from the last
  // publication, faded once the drawing changed) and its stops numbered in calling order.
  const linePaths = useMemo(
    () =>
      doc && view && published?.result
        ? serviceLinePaths(doc, view, published.result.section_trains ?? [], published.topology ?? null)
        : null,
    [doc, view, published],
  );
  const lineStops = useMemo(
    () => (doc && view ? serviceLineStops(doc, view) : { type: "FeatureCollection" as const, features: [] }),
    [doc, view],
  );
  const linesStale = !!doc && !!published && published.key !== publishKey(doc);
  useEffect(() => {
    if (map && map.getSource("rd-tracks")) drawServiceLines(map, linePaths, lineStops, linesStale);
  }, [map, linePaths, lineStops, linesStale]);
  useEffect(() => {
    if (!map) return;
    return () => {
      if (map.getStyle?.()) removeServiceLines(map);
    };
  }, [map]);
  useEffect(() => {
    if (!map) return;
    map.doubleClickZoom.disable();
    return () => map.doubleClickZoom.enable();
  }, [map]);
  useEffect(() => {
    if (map) map.getCanvas().style.cursor = tool === "pan" ? "grab" : tool === "select" ? "" : "crosshair";
  }, [map, tool]);

  // Other tools see these stations, so a bus stop placed next to one takes its name.
  useEffect(() => {
    if (doc && view) publishPlaces("rail", stationPlaces(doc, view));
  }, [doc, view]);

  const say = (m: string) => {
    setFlash(m);
    window.setTimeout(() => setFlash((f) => (f === m ? null : f)), 4000);
  };

  const pxToM = useCallback(
    (px: number) => {
      if (!map) return px;
      const z = map.getZoom();
      return (px * 78271.517 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
    },
    [map, lat],
  );

  const connectionAt = useCallback(
    (pt: { x: number; y: number }, wantTracks: number | null): ConnectionView | null => {
      if (!map || !map.getLayer(CONNECTION_LAYER)) return null;
      const box: [[number, number], [number, number]] = [
        [pt.x - 9, pt.y - 9],
        [pt.x + 9, pt.y + 9],
      ];
      const hits = map.queryRenderedFeatures(box, { layers: [CONNECTION_LAYER] });
      const conns = lastView.current?.connections ?? [];
      const found = hits
        .map((h) => conns[Number(h.properties?.index)])
        .filter((c): c is ConnectionView => !!c && (wantTracks === null || c.tracks === wantTracks));
      return found.find((c) => !c.used) ?? found[0] ?? null;
    },
    [map],
  );

  // Free ends of the drawn tracks: snap points for new tracks, like the stations' connection points.
  const trackEnds = useMemo(
    () => (doc && view ? freeTrackEnds(doc, view, draft?.id ?? null) : []),
    [doc, view, draft?.id],
  );
  const trackEndsRef = useRef<TrackEnd[]>(trackEnds);
  trackEndsRef.current = trackEnds;
  useEffect(() => {
    if (map && map.getSource("rd-track-ends")) drawTrackEnds(map, trackEnds);
  }, [map, trackEnds]);
  const trackEndAt = useCallback(
    (pt: { x: number; y: number }, wantTracks: number | null): TrackEnd | null => {
      if (!map) return null;
      let best: { e: TrackEnd; d: number } | null = null;
      for (const e of trackEndsRef.current) {
        if (wantTracks !== null && e.tracks !== wantTracks) continue;
        const p = map.project(e.lonlat);
        const d = Math.hypot(p.x - pt.x, p.y - pt.y);
        if (d <= 10 && (!best || d < best.d)) best = { e, d };
      }
      return best?.e ?? null;
    },
    [map],
  );

  const latest = useRef<EditorState>({
    tool,
    doc,
    draft,
    sel,
    trackOpts,
    stationOpts,
    switchOpts,
    view,
    cursor,
    picking,
    stationGroupingM,
  });
  latest.current = {
    tool,
    doc,
    draft,
    sel,
    trackOpts,
    stationOpts,
    switchOpts,
    view,
    cursor,
    picking,
    stationGroupingM,
  };
  const dragging = useRef<Dragging>(null);

  const startDraft = useCallback((start: Anchor, d: Network, level: Track["level"], tracks: 1 | 2) => {
    const o = latest.current.trackOpts;
    setDraft(newTrack(d, start, { ...o, level, tracks }));
    setCursor(null);
    setSel(null);
  }, []);

  const finishDraft = useCallback(
    (end: Anchor | null) => {
      const { draft: dr, doc: d } = latest.current;
      if (!dr || !d) return;
      let t: Track = { ...dr, end };
      if (!end) {
        const last = t.points[t.points.length - 1];
        if (!last) {
          setDraft(null);
          return;
        }
        t = {
          ...t,
          points: t.points.slice(0, -1),
          end: { type: "free", x: last.x, y: last.y, level: last.level ?? t.level },
        };
      }
      const startC = connLocal(t.start);
      const endC = t.end && t.end.type !== "free" ? connLocal(t.end) : null;
      t = autoLeads(t, startC, endC, null, minLead);
      // Snapped to the free end of a drawn track: the two become one connected track.
      setDoc(joinAtFreeEnds({ ...d, tracks: [...d.tracks, t] }, t.id)[0]);
      setDraft(null);
      setCursor(null);
      // Stay in the track tool, ready for the next track.
      setSel(null);
    },
    [connLocal, minLead],
  );

  useMapEditing({
    map,
    engine,
    latest,
    dragging,
    say,
    setDoc,
    setSel,
    setTool,
    setNote,
    setDraft,
    setCursor,
    connectionAt,
    trackEndAt,
    connLocal,
    finishDraft,
    startDraft,
    minLead,
    pxToM,
  });

  useEditHandles({
    map,
    engine,
    view,
    sel,
    latest,
    dragging,
    setDoc,
    setSel,
    connLocal,
    connectionAt,
    trackEndAt,
    minLead,
  });

  // Station names: one marker per station, moved rather than made again while a station is dragged.
  const nameMarkers = useRef(new Map<string, Marker>());
  const stationKey = view?.stations.map((s) => `${s.id}:${s.name}@${s.lonlat.join()}`).join("|");
  useEffect(() => {
    if (!map || !view) return;
    const ms = nameMarkers.current;
    const keep = new Set<string>();
    for (const st of view.stations) {
      const key = `${st.id}:${st.name}`;
      keep.add(key);
      const m = ms.get(key);
      if (m) m.setLngLat(st.lonlat);
      else
        ms.set(
          key,
          new Marker({ element: labelElement(st.name), anchor: "bottom", offset: [0, -14] })
            .setLngLat(st.lonlat)
            .addTo(map),
        );
    }
    for (const [key, m] of ms)
      if (!keep.has(key)) {
        m.remove();
        ms.delete(key);
      }
    // `view` is read for the stations behind `stationKey`.
  }, [map, stationKey]);
  useEffect(() => {
    const ms = nameMarkers.current;
    return () => {
      ms.forEach((m) => m.remove());
      ms.clear();
    };
  }, [map]);

  const anchorAt = (a: Anchor): [number, number] | null => connLocal(a)?.p ?? null;

  const changeTool = (t: RailTool) => {
    if (t !== "track") {
      setDraft(null);
      setCursor(null);
    }
    if (t === "line" && !(picking && doc?.lines?.some((l) => l.id === picking))) return newLine();
    if (t !== "line") dropEmptyLine();
    setTool(t);
  };
  /** Purpose: start a new line with its stops still to pick, and the line tool to pick them. */
  const newLine = () => {
    const d0 = latest.current.doc;
    if (!d0) return;
    const [d, id] = addLine(d0, (view?.params.platform_length_m ?? 120) - 5, { empty: true, vehiclesOff });
    setDoc(d);
    setDraft(null);
    setCursor(null);
    setPicking(id);
    setSel(null);
    setNote(tNow("rail.pick.start"));
    setTool("line");
  };
  /** Purpose: stop picking; a line left without stops is removed again. */
  const dropEmptyLine = () => {
    const { doc: d, picking: id } = latest.current;
    const line = id ? d?.lines?.find((l) => l.id === id) : null;
    if (d && line && line.stations.length === 0) setDoc(removeLine(d, line.id));
    setPicking(null);
  };
  const toolChange = useRef(changeTool);
  toolChange.current = changeTool;
  /** Purpose: stop picking stops; the line stays open in the panel. */
  const finishLine = () => {
    dropEmptyLine();
    setNote(null);
    setTool("select");
  };
  /** Purpose: pick more stops for an existing line (they are added after its last stop). */
  const pickFor = (id: string | null) => {
    if (!id) return finishLine();
    setDraft(null);
    setCursor(null);
    setPicking(id);
    setTool("line");
  };

  useEditorKeys({
    latest,
    setDoc,
    setSel,
    setDraft,
    setCursor,
    setTrackOpts,
    finishDraft,
    finishLine,
    anchorAt,
    toolChange,
  });

  // Publishing: plan the service lines on the drawn track (timetable planner) for the journey planner. It runs
  // in steps (build the track, then each day type with lines), letting the page draw the progress bar between
  // them, and ends with what came out or why it failed.
  const [publishing, setPublishing] = useState<{ step: string; index: number; steps: number } | null>(null);
  const publish = async () => {
    const e = engine.current;
    if (!e || !doc || publishing) return;
    const days = DAY_TYPES.filter((d) => dayEngineLines(doc, d, calendar, prefValues).length > 0);
    const steps = 1 + Math.max(1, days.length);
    const paint = () => new Promise<void>((r) => setTimeout(r, 0));
    let next: Published;
    try {
      setPublishing({ step: tNow("capacity.building"), index: 1, steps });
      await paint();
      // The engine plans on its last build: build the drawing without a draft first.
      e.build(doc, null);
      // Every day type with its own times and the calendar's peaks; the journey planner takes the weekday.
      const byDay: DayPublications = {};
      for (const [i, day] of (days.length ? days : (["weekday"] as const)).entries()) {
        setPublishing({
          step: `${tNow("rail.line.publish")} · ${tNow(`cal.day.${day}` as MessageKey)}`,
          index: i + 2,
          steps,
        });
        await paint();
        byDay[day] = e.publishLines(dayEngineLines(doc, day, calendar, prefValues), day);
      }
      const result =
        byDay.weekday ?? e.publishLines(dayEngineLines(doc, "weekday", calendar, prefValues), "weekday");
      byDay.weekday = result;
      next = { result, byDay, error: null, key: publishKey(doc), topology: e.topology() };
      onPublish?.(result.timetable);
    } catch (err) {
      next = { result: null, error: err instanceof Error ? err.message : String(err), key: publishKey(doc) };
      onPublish?.(null);
    } finally {
      setPublishing(null);
    }
    setPublished(next);
  };
  const publication: Publication | null = published
    ? {
        result: published.result,
        ...(published.byDay ? { byDay: published.byDay } : {}),
        error: published.error,
        stale: !!doc && published.key !== publishKey(doc),
        running: publishing,
      }
    : publishing
      ? { result: null, error: null, stale: false, running: publishing }
      : null;

  const panelActions = {
    setTool: changeTool,
    setDoc,
    select: setSel,
    setTrackOpts: (o: NewTrackOpts) => {
      setTrackOpts(o);
      if (draft)
        setDraft({
          ...draft,
          tracks: draft.start.type === "switch" ? draft.tracks : o.tracks,
          level: o.level,
          power: o.power,
          use: o.use,
        });
    },
    setStationOpts,
    setSwitchOpts,
    finishDraft: () => finishDraft(null),
    cancelDraft: () => {
      setDraft(null);
      setCursor(null);
    },
    remove: (id: number) => {
      if (!doc) return;
      setDoc(deleteElement(doc, id, anchorAt, sigs(view)));
      setSel(null);
    },
    // The panel's mode is the mode for new stations and tracks. What is already drawn keeps its
    // railway system: elements that followed the old network mode get it as their own.
    setMode: (mode: RailMode) => {
      if (!doc) return;
      const tm = new Map(view?.tracks.map((t) => [t.id, t.mode]));
      const sm = new Map(view?.stations.map((st) => [st.id, st.mode]));
      const pin = (own: RailMode | null | undefined, built: RailMode | undefined) => {
        const m = own ?? built ?? doc.mode;
        return m === mode ? null : m;
      };
      setDoc({
        ...doc,
        mode,
        params: null,
        train_length_m: null,
        stations: doc.stations.map((st) => ({ ...st, mode: pin(st.mode, sm.get(st.id)) })),
        tracks: doc.tracks.map((t) => ({ ...t, mode: pin(t.mode, tm.get(t.id)) })),
      });
    },
    clear: () => {
      if (!map) return;
      const c = map.getCenter();
      setDoc(emptyNetwork(doc?.mode ?? "metro", [c.lng, c.lat]));
      setSel(null);
      setDraft(null);
      setTool("station");
    },
    renameStation: (id: number, name: string) => {
      if (!doc || !name.trim()) return;
      const r = renamePlace(
        `rail:${id}`,
        name,
        [...placesOtherThan("rail"), ...stationPlaces(doc, view)],
        stationGroupingM,
      );
      const members = new Set(r.members.filter((m) => m.startsWith("rail:")).map((m) => Number(m.slice(5))));
      members.add(id);
      setDoc({ ...doc, stations: doc.stations.map((s) => (members.has(s.id) ? { ...s, name: r.name } : s)) });
      setNote(describeClash(r, stationGroupingM));
    },
    showIssue: (at: LonLat | null, ref: number | null) => {
      if (ref) setSel({ id: ref });
      if (at && map) map.easeTo({ center: at, zoom: Math.max(map.getZoom(), 16) });
    },
    resetSignals: () => {
      if (!doc) return;
      setDoc(resetSignals(doc));
      setSel(null);
      setNote(tNow("rail.signalsReset"));
    },
    fit: () => {
      const b = view?.bbox;
      if (b && map)
        map.fitBounds(
          [
            [b[0], b[1]],
            [b[2], b[3]],
          ],
          { padding: 60 },
        );
    },
  };

  const sidePanel = doc && view && (
    <RailPanel
      doc={doc}
      view={view}
      tool={tool}
      sel={sel}
      draft={draft}
      trackOpts={trackOpts}
      stationOpts={stationOpts}
      switchOpts={switchOpts}
      error={error}
      streetNote={streetNote}
      terrainError={terrainError}
      onRetryTerrain={retryTerrain}
      existingRailways={existingRailways}
      actions={panelActions}
      service={{
        publication,
        publish: () => void publish(),
        picking,
        setPicking: pickFor,
        designValues,
        calendar,
      }}
    />
  );

  return (
    <>
      <RailToolPalette tool={tool} onTool={changeTool} />
      <div className="pointer-events-none absolute bottom-8 left-1/2 z-10 flex max-w-[90%] -translate-x-1/2 flex-col items-center gap-1 text-sm">
        {(flash || (!ready && !error)) && (
          <p
            className="rounded-full px-3 py-1 text-white"
            style={{ background: flash ? COLORS.error : "#0f172ad9" }}
            role={flash ? "alert" : undefined}
          >
            {flash ?? t("rail.starting")}
          </p>
        )}
        {note && (
          <p className="rounded-full bg-blue-700 px-3 py-1 text-white" role="status">
            {note}
          </p>
        )}
        <p className="rounded-full bg-white/95 px-3 py-1 text-slate-700 shadow" role="note">
          {t(HINTS[tool])}
        </p>
      </div>
      {panel ? sidePanel && createPortal(sidePanel, panel) : sidePanel}
      {error && !view && (
        <p className="absolute top-3 right-14 z-10 rounded bg-red-50 px-2 py-1 text-sm text-red-700">
          {error}
        </p>
      )}
    </>
  );
}
