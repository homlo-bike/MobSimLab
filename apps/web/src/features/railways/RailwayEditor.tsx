import { Marker, type Map as MapLibreMap } from "maplibre-gl";
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
import { describeClash, renamePlace } from "../naming/names";
import { placesOtherThan, publishPlaces } from "../naming/registry";
import { CONNECTION_LAYER, drawRail, ensureRailLayers, removeRailLayers, showConnections } from "./mapLayers";
import { COLORS } from "./modes";
import {
  RailPanel,
  type NewStationOpts,
  type NewSwitchOpts,
  type NewTrackOpts,
  type RailTool,
} from "./RailPanel";
import { RailToolPalette } from "./RailToolPalette";
import { loadWasmNoise } from "../noise/engine";
import { NoiseSection } from "../noise/NoiseSection";
import { noiseCalculationIn } from "../noise/plugin";
import { noiseCheckText, RAIL_FLOWS, railSources } from "../noise/sources";
import type { Flows, Indicator, NoiseEngineLoader } from "../noise/types";
import { useNoise } from "../noise/useNoise";
import { addLine, engineLines, linesTrainLength, removeLine } from "./serviceLines";
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

type Published = { result: ServicePublication | null; error: string | null; key: string };

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
  /** The drawing saved with the project, or null to start a new one at the map centre. */
  initial?: Network | null;
  /** Told about the drawing after every change, so the project can save it. */
  onDocChange?: (doc: Network) => void;
  /** Noise engine loader (noise plugin); tests inject a fake. */
  loadNoise?: NoiseEngineLoader;
  /** Offer the noise band; defaults to whether the noise plugin is installed. */
  noiseAvailable?: boolean;
  /** Called with the published service lines' timetable (`null` when withdrawn), for the journey planner. */
  onPublish?: (timetable: Timetable | null) => void;
}

export type { Selection } from "./editorState";

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
  initial = null,
  onDocChange,
  loadNoise = loadWasmNoise,
  noiseAvailable = noiseCalculationIn("railway-tool"),
  onPublish,
}: Props) {
  const { t } = useI18n();
  const engine = useRef<RailEngine | null>(null);
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
  const [noiseOn, setNoiseOn] = useState(false);
  const [indicator, setIndicator] = useState<Indicator>("lden");
  const [trainFlows, setTrainFlows] = useState<Flows | null>(null);
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

  const local = useCallback(
    (ll: LonLat): [number, number] =>
      engine.current && doc ? engine.current.toLocal(doc.origin, ll) : [0, 0],
    [doc],
  );

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

  const terrainNote = useTerrainHeights({ engine, view, draft, fetchHeights, setStreets });

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
  });
  latest.current = { tool, doc, draft, sel, trackOpts, stationOpts, switchOpts, view, cursor, picking };
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
      setDoc({ ...d, tracks: [...d.tracks, t] });
      setDraft(null);
      setCursor(null);
      setSel({ id: t.id });
      setTool("select");
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
    minLead,
  });

  // Station names.
  useEffect(() => {
    if (!map || !view) return;
    const ms = view.stations.map((st) =>
      new Marker({ element: labelElement(st.name), anchor: "bottom", offset: [0, -14] })
        .setLngLat(st.lonlat)
        .addTo(map),
    );
    return () => ms.forEach((m) => m.remove());
  }, [map, view?.stations.map((s) => `${s.name}@${s.lonlat.join()}`).join("|")]);

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
    const [d, id] = addLine(d0, (view?.params.platform_length_m ?? 120) - 5, { empty: true });
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

  // Publishing: plan the service lines on the drawn track (timetable planner) for the journey planner.
  const publish = () => {
    const e = engine.current;
    if (!e || !doc) return;
    let next: Published;
    try {
      // The engine plans on its last build: build the drawing without a draft first.
      e.build(doc, null);
      const result = e.publishLines(engineLines(doc), "weekday");
      next = { result, error: null, key: publishKey(doc) };
      onPublish?.(result.timetable);
    } catch (err) {
      next = { result: null, error: err instanceof Error ? err.message : String(err), key: publishKey(doc) };
      onPublish?.(null);
    }
    setPublished(next);
  };
  const publication: Publication | null = published
    ? { result: published.result, error: published.error, stale: !!doc && published.key !== publishKey(doc) }
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
      const r = renamePlace(`rail:${id}`, name, [...placesOtherThan("rail"), ...stationPlaces(doc, view)]);
      const members = new Set(r.members.filter((m) => m.startsWith("rail:")).map((m) => Number(m.slice(5))));
      members.add(id);
      setDoc({ ...doc, stations: doc.stations.map((s) => (members.has(s.id) ? { ...s, name: r.name } : s)) });
      setNote(describeClash(r));
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

  const flows = trainFlows ?? RAIL_FLOWS[doc?.mode ?? "tram"] ?? RAIL_FLOWS.tram!;
  const noiseInput =
    noiseOn && doc && view && view.tracks.length ? { lines: railSources(doc, view, flows) } : null;
  const noise = useNoise(map, noiseAvailable && noiseOn, noiseInput, indicator, loadNoise, "rd-corridors");

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
      streetNote={[streetNote, terrainNote].filter(Boolean).join(" ") || null}
      existingRailways={existingRailways}
      actions={panelActions}
      noise={
        noiseAvailable && (
          <NoiseSection
            on={noiseOn}
            setOn={setNoiseOn}
            indicator={indicator}
            setIndicator={setIndicator}
            flows={flows}
            setFlows={setTrainFlows}
            flowsLabel={t("rail.noiseFlows")}
            view={noise.view}
            error={noise.error}
          />
        )
      }
      extraIssues={noise.view?.checks.map((c) => ({
        severity: c.severity,
        text: noiseCheckText(c),
        at: c.at,
        ref_id: null,
      }))}
      service={{ publication, publish, picking, setPicking: pickFor, newLine }}
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
