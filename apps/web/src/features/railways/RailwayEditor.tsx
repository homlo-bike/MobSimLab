import { Marker, type Map as MapLibreMap, type MapMouseEvent } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchStreetTile } from "../street-lines/engine";
import { MIN_LOAD_ZOOM, tilesFor } from "../street-lines/tiles";
import type { DelayShares, TileFetcher } from "../street-lines/types";
import type { StreetSetup } from "../street-setup/types";
import {
  addSignal,
  addStation,
  addSwitch,
  autoLeads,
  deleteElement,
  emptyNetwork,
  fallbackStationName,
  kindOf,
  newTrack,
  stationPlaces,
  update,
  updateSignal,
  resetSignals,
  type LocalConnection,
} from "./doc";
import { fetchRailTile, loadRailEngine } from "./engine";
import { basemapLabels, featuresFromLabels, preferTransitKind } from "../naming/labels";
import { describeChoice, describeClash, nameForNewPlace, renamePlace } from "../naming/names";
import { placesOtherThan, publishPlaces } from "../naming/registry";
import {
  CONNECTION_LAYER,
  drawRail,
  ensureRailLayers,
  HIT_LAYERS,
  removeRailLayers,
  showConnections,
} from "./mapLayers";
import { COLORS, shiftLevel } from "./modes";
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
import { addLine, engineLines, linesTrainLength, removeLine, updateLine } from "./serviceLines";
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
  SignalView,
  Track,
} from "./types";
import type { Timetable } from "../journey-planner/types";

/** Purpose: the drawn signals of a view (generated and the planner's), or none before a build. */
const sigs = (v: RailView | null | undefined): SignalView[] => v?.signals ?? [];

const HINTS: Record<RailTool, string> = {
  select:
    "Click a station, track, switch or signal to edit it. Drag stations and track points; drag a switch or signal along its track.",
  station: "Click on the map to place a station. Then drag it into place and rotate it.",
  track:
    "Click a connection point or the map to start, click to add points, click a connection point or double-click to finish. + / − change the level.",
  turnout: "Click on a track to place a turnout (double junction on double track), then draw the branch.",
  crossover: "Click on a double track to place a crossover.",
  signal: "Click on a track to place a signal. F turns the selected signal round.",
  pan: "Drag to move the map.",
  line: "Click the stations of the line in the order trains call at them. Enter or Esc finishes the line.",
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
  /** Load and draw existing railways from OpenStreetMap (app setting, off by default). */
  existingRailways?: boolean;
  /** The planner's street setups from the GIS tab (tram own lane or mixed traffic…), over OSM. */
  streetSetups?: readonly StreetSetup[];
  /** The project's delays in traffic for trams in streets (Project preferences); the library's when absent. */
  delays?: DelayShares | null;
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

export interface Selection {
  id: number;
  pi?: number;
}

const sameAnchor = (a: Anchor, b: Anchor) => JSON.stringify(a) === JSON.stringify(b);

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
  existingRailways = false,
  streetSetups = NO_SETUPS,
  delays = null,
  initial = null,
  onDocChange,
  loadNoise = loadWasmNoise,
  noiseAvailable = noiseCalculationIn("railway-tool"),
  onPublish,
}: Props) {
  const engine = useRef<RailEngine | null>(null);
  const [ready, setReady] = useState(false);
  const [doc, setDoc] = useState<Network | null>(initial);
  const [draft, setDraft] = useState<Track | null>(null);
  const [cursor, setCursor] = useState<{ at: [number, number]; conn: ConnectionView | null } | null>(null);
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
        setError(`The railway engine did not start: ${err instanceof Error ? err.message : String(err)}`),
      );
    return () => {
      alive = false;
      engine.current?.dispose();
      engine.current = null;
    };
  }, [loadEngine]);

  // Streets for level crossings and existing railways for joins: the tiles on screen, loaded when
  // the map stops moving, the same tiles the street line tool routes on. Each batch of new tiles
  // triggers one rebuild.
  const [streets, setStreets] = useState(0);
  const [streetNote, setStreetNote] = useState<string | null>(null);
  const tiles = useRef(new Set<string>());
  // Street setups from the GIS tab override OSM for street running; a change rebuilds.
  const setupsJson = JSON.stringify(streetSetups);
  useEffect(() => {
    const e = engine.current;
    if (!ready || !e) return;
    e.setStreetSetups(JSON.parse(setupsJson) as StreetSetup[]);
    setStreets((n) => n + 1);
  }, [ready, setupsJson]);
  // The project's delays in traffic: a tram's running time in streets; a change rebuilds.
  const delaysJson = delays ? JSON.stringify(delays) : "";
  useEffect(() => {
    const e = engine.current;
    if (!ready || !e?.setValues || !delaysJson) return;
    const d = JSON.parse(delaysJson) as DelayShares;
    e.setValues({
      street_mixed_traffic_delay_share: d.mixed_traffic,
      street_bus_lane_delay_share: d.bus_lane,
    });
    setStreets((n) => n + 1);
  }, [ready, delaysJson]);
  useEffect(() => {
    if (!map || !ready) return;
    // Turning existing railways off forgets them; turning them on reloads the tiles on screen.
    if (!existingRailways) {
      engine.current?.clearRails();
      setStreets((n) => n + 1);
    }
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
      if (map.getZoom() < MIN_LOAD_ZOOM) {
        setStreetNote(
          existingRailways
            ? `Zoom in to load streets and existing railways (from zoom ${MIN_LOAD_ZOOM}).`
            : `Zoom in to load streets and find level crossings (from zoom ${MIN_LOAD_ZOOM}).`,
        );
        return;
      }
      const b = map.getBounds();
      const want = tilesFor([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
        .map(([x, y]) => `${x}/${y}`)
        .filter((k) => !tiles.current.has(k));
      if (!want.length) return;
      busy = true;
      want.forEach((k) => tiles.current.add(k));
      const fetchAll = (f: TileFetcher) =>
        Promise.allSettled(
          want.map((k) => {
            const [x, y] = k.split("/").map(Number);
            return f(x!, y!);
          }),
        );
      const [got, rails] = await Promise.all([
        fetchAll(fetchTile),
        existingRailways ? fetchAll(fetchRails) : Promise.resolve([]),
      ]);
      busy = false;
      if (stopped || engine.current !== e) {
        want.forEach((k) => tiles.current.delete(k));
        return;
      }
      let added = 0;
      let reason: string | null = null;
      let railReason: string | null = null;
      got.forEach((r, i) => {
        try {
          if (r.status === "rejected") throw r.reason;
          e.addStreetTile(r.value);
          added++;
        } catch (err) {
          tiles.current.delete(want[i]!);
          reason ??= err instanceof Error ? err.message : "Some streets did not load.";
        }
      });
      rails.forEach((r, i) => {
        try {
          if (r.status === "rejected") throw r.reason;
          e.addRailTile(r.value);
          added++;
        } catch (err) {
          tiles.current.delete(want[i]!);
          railReason ??= err instanceof Error ? err.message : "Some existing railways did not load.";
        }
      });
      if (added) setStreets((n) => n + 1);
      const notes = [
        reason && `${reason} Level crossings are only found where streets have loaded.`,
        railReason && `${railReason} New track only joins existing railways where they have loaded.`,
      ].filter(Boolean);
      setStreetNote(notes.length ? `${notes.join(" ")} Move the map to try again.` : null);
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
      tiles.current.clear();
    };
  }, [map, ready, fetchTile, fetchRails, existingRailways]);

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

  // Latest state for handlers registered once per map.
  const latest = useRef({ tool, doc, draft, sel, trackOpts, stationOpts, switchOpts, view, cursor, picking });
  latest.current = { tool, doc, draft, sel, trackOpts, stationOpts, switchOpts, view, cursor, picking };
  const dragging = useRef<
    | { kind: "station"; id: number; dx: number; dy: number }
    | { kind: "switch"; id: number; track: number; offset: number }
    | { kind: "signal"; id: number }
    | { kind: "end" }
    | null
  >(null);

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

  // Map clicks.
  useEffect(() => {
    if (!map) return;
    const onClick = (ev: MapMouseEvent) => {
      const s = latest.current;
      const e = engine.current;
      if (!e || !s.doc) return;
      const ll: LonLat = [ev.lngLat.lng, ev.lngLat.lat];
      const at = e.toLocal(s.doc.origin, ll);
      const params = s.view?.params;
      // Creating a service line: each click on a station adds the next stop, if trains can get there.
      const pickLine = s.tool === "line" && s.picking ? s.doc.lines?.find((l) => l.id === s.picking) : null;
      if (s.tool === "line") {
        if (!pickLine) return;
        const station = stationAt(map, ev.point, s.doc, s.view);
        if (station === null) return say("Click a station to add it to the line.");
        const name = s.doc.stations.find((x) => x.id === station)?.name ?? "This station";
        const last = pickLine.stations[pickLine.stations.length - 1];
        if (last === station) return say(`${name} is the last stop already. Click the next station.`);
        if (pickLine.stations.includes(station))
          return say(`${name} is a stop of this line already. Remove it from the list to change the order.`);
        if (last !== undefined) {
          let reach: { ok: boolean; reason: string | null };
          try {
            reach = e.reachable(last, station);
          } catch (err) {
            return say(err instanceof Error ? err.message : String(err));
          }
          if (!reach.ok) return say(reach.reason ?? `Trains cannot reach ${name} from the last stop.`);
        }
        setDoc(updateLine(s.doc, pickLine.id, (l) => ({ ...l, stations: [...l.stations, station] })));
        setNote(
          pickLine.stations.length === 0
            ? `${name} is the first stop. Click the next station.`
            : `${name} added. Click the next station, or press Enter to finish.`,
        );
        return;
      }
      if (s.tool === "station") {
        // Next to an existing stop or station it is part of that one; otherwise named from the map.
        const places = [...placesOtherThan("rail"), ...stationPlaces(s.doc, s.view)];
        const choice = nameForNewPlace(ll, {
          places,
          features: preferTransitKind(featuresFromLabels(basemapLabels(map, ll), ll), "rail"),
          fallback: fallbackStationName(
            s.doc,
            places.map((p) => p.name),
          ),
        });
        setNote(describeChoice(choice, "station"));
        const [d, id] = addStation(s.doc, at, {
          ...s.stationOpts,
          platformLength: params?.platform_length_m ?? 120,
          name: choice.name,
        });
        setDoc(d);
        setSel({ id });
        setTool("select");
      } else if (s.tool === "track") {
        // A free point close to an existing railway snaps onto it, so the track joins it.
        const snap = e.existingSnap(ll, pxToM(10));
        const p = snap ? e.toLocal(s.doc.origin, snap.lonlat) : at;
        if (!s.draft) {
          const c = connectionAt(ev.point, s.trackOpts.tracks);
          if (c) startDraft(c.anchor, s.doc, c.level, c.tracks === 2 ? 2 : 1);
          else startDraft({ type: "free", x: p[0], y: p[1] }, s.doc, s.trackOpts.level, s.trackOpts.tracks);
          return;
        }
        const c = connectionAt(ev.point, s.draft.tracks);
        if (c) return finishDraft(c.anchor);
        const dr = s.draft;
        const pts = [...dr.points, { x: p[0], y: p[1], level: draftLevel(dr) }];
        const next = autoLeads({ ...dr, points: pts }, connLocal(dr.start), null, null, minLead);
        setDraft(next);
      } else if (s.tool === "turnout" || s.tool === "crossover") {
        const hit = e.nearestTrack(ll, pxToM(10));
        if (!hit) return say("Click on a track to place a switch.");
        if (!hit.straight) return say("Catalogue switches go on straight track. Click on a straight part.");
        // The panel's element is from the catalogue of the mode for new elements; a track of
        // another railway system gets its own mode's default turnout.
        const trackMode = s.view?.tracks.find((t) => t.id === hit.track)?.mode ?? s.doc.mode;
        const catalogue = s.view?.modes[trackMode];
        const element =
          (trackMode === s.doc.mode ? s.switchOpts.element : null) ??
          catalogue?.params.default_turnout ??
          params?.default_turnout ??
          "";
        if (s.tool === "crossover") {
          if (hit.tracks !== 2) return say("Crossovers join two parallel tracks. Pick a double track.");
          const t = (catalogue?.turnouts ?? s.view?.turnouts)?.find((x) => x.id === element);
          const len = t ? 2 * (t.length_a_m ?? 0) + hit.spacing * (t.crossing_ratio_n ?? 0) : 0;
          const [d, id] = addSwitch(s.doc, {
            kind: s.switchOpts.scissors ? "scissors" : "crossover",
            track: hit.track,
            s: hit.s - len / 2,
            element,
            side: 1,
          });
          setDoc(d);
          setSel({ id });
          return;
        }
        const junction = hit.tracks === 2 && s.switchOpts.junction;
        const [d, id] = addSwitch(s.doc, {
          kind: junction ? "double_junction" : "turnout",
          track: hit.track,
          s: hit.s,
          element,
          side: hit.side >= 0 ? 1 : -1,
        });
        setDoc(d);
        setTool("track");
        startDraft({ type: "switch", switch: id, leg: 0 }, d, s.trackOpts.level, junction ? 2 : 1);
      } else if (s.tool === "signal") {
        const anchor = e.signalAnchor(ll, pxToM(15));
        if (!anchor) return say("Click on a track, station track or switch leg to place a signal.");
        const [d, id] = addSignal(s.doc, anchor, 1, "main");
        setDoc(d);
        setSel({ id });
      } else if (s.tool === "select") {
        const box: [[number, number], [number, number]] = [
          [ev.point.x - 5, ev.point.y - 5],
          [ev.point.x + 5, ev.point.y + 5],
        ];
        const layers = HIT_LAYERS.filter((l) => map.getLayer(l));
        const hits = map.queryRenderedFeatures(box, { layers });
        const ref = hits.map((h) => Number(h.properties?.ref)).find((r) => kindOf(s.doc!, r, sigs(s.view)));
        setSel(ref ? { id: ref } : null);
      }
    };
    const onDbl = (ev: MapMouseEvent) => {
      const s = latest.current;
      if (s.tool !== "track" || !s.draft || !s.doc || !engine.current) return;
      ev.preventDefault();
      // The double-click's two clicks each added a point: drop the second; the first is the end.
      const dr = s.draft;
      const pts = dr.points.slice(0, -1);
      const at = engine.current.toLocal(s.doc.origin, [ev.lngLat.lng, ev.lngLat.lat]);
      latest.current.draft = { ...dr, points: pts };
      finishDraft({ type: "free", x: at[0], y: at[1], level: draftLevel(dr) });
    };
    let frame = 0;
    const onMove = (ev: MapMouseEvent) => {
      const s = latest.current;
      const e = engine.current;
      if (!e || !s.doc) return;
      const ll: LonLat = [ev.lngLat.lng, ev.lngLat.lat];
      const dr = dragging.current;
      if (dr?.kind === "station") {
        const at = e.toLocal(s.doc.origin, ll);
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() =>
          setDoc(
            (d) => d && update(d, "stations", dr.id, (st) => ({ ...st, x: at[0] - dr.dx, y: at[1] - dr.dy })),
          ),
        );
        return;
      }
      if (dr?.kind === "switch") {
        const ch = e.chainage(dr.track, ll);
        if (!Number.isFinite(ch)) return;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() =>
          setDoc(
            (d) => d && update(d, "switches", dr.id, (sw) => ({ ...sw, s: Math.max(0, ch - dr.offset) })),
          ),
        );
        return;
      }
      if (dr?.kind === "signal") {
        const anchor = e.signalAnchor(ll, pxToM(30));
        if (!anchor) return;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() =>
          setDoc(
            (d) => d && updateSignal(d, dr.id, (x) => ({ ...x, at: anchor }), sigs(latest.current.view)),
          ),
        );
        return;
      }
      if (s.tool === "track" && s.draft) {
        const conn = connectionAt(ev.point, s.draft.tracks);
        const snap = e.existingSnap(ll, pxToM(10));
        const at = e.toLocal(s.doc.origin, snap ? snap.lonlat : ll);
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const d = latest.current.draft;
          if (!d) return;
          const endC = conn ? connLocal(conn.anchor) : null;
          setDraft(autoLeads(d, connLocal(d.start), endC, at, minLead));
          setCursor({ at, conn });
        });
      }
    };
    const onDown = (ev: MapMouseEvent) => {
      const s = latest.current;
      if (s.tool !== "select" || !s.doc || !engine.current) return;
      const box: [[number, number], [number, number]] = [
        [ev.point.x - 4, ev.point.y - 4],
        [ev.point.x + 4, ev.point.y + 4],
      ];
      const layers = HIT_LAYERS.filter((l) => map.getLayer(l));
      const hits = map.queryRenderedFeatures(box, { layers });
      const ref = hits.map((h) => Number(h.properties?.ref)).find((r) => kindOf(s.doc!, r, sigs(s.view)));
      if (!ref || s.sel?.id !== ref) return;
      const ll: LonLat = [ev.lngLat.lng, ev.lngLat.lat];
      const kind = kindOf(s.doc, ref, sigs(s.view));
      if (kind === "station") {
        const st = s.doc.stations.find((x) => x.id === ref)!;
        const at = engine.current.toLocal(s.doc.origin, ll);
        dragging.current = { kind: "station", id: ref, dx: at[0] - st.x, dy: at[1] - st.y };
      } else if (kind === "switch") {
        const sw = s.doc.switches.find((x) => x.id === ref)!;
        const ch = engine.current.chainage(sw.track, ll);
        if (!Number.isFinite(ch)) return;
        dragging.current = { kind: "switch", id: ref, track: sw.track, offset: ch - sw.s };
      } else if (kind === "signal") {
        dragging.current = { kind: "signal", id: ref };
      } else return;
      ev.preventDefault();
      map.dragPan.disable();
    };
    const onUp = () => {
      if (dragging.current && dragging.current.kind !== "end") {
        dragging.current = null;
        map.dragPan.enable();
      }
    };
    map.on("click", onClick);
    map.on("dblclick", onDbl);
    map.on("mousemove", onMove);
    map.on("mousedown", onDown);
    map.on("mouseup", onUp);
    return () => {
      map.off("click", onClick);
      map.off("dblclick", onDbl);
      map.off("mousemove", onMove);
      map.off("mousedown", onDown);
      map.off("mouseup", onUp);
      cancelAnimationFrame(frame);
    };
  }, [map, connectionAt, connLocal, finishDraft, minLead, pxToM, startDraft]);

  // Edit handles for the selected track (points, leads, free ends) and station (rotation).
  const handles = useMemo(
    () => (view?.handles ?? []).filter((h) => ("track" in h ? sel?.id === h.track : sel?.id === h.station)),
    [view, sel],
  );
  const handleKey = handles
    .map((h) => ("track" in h ? `${h.track}:${h.kind}:${h.index}` : `r${h.station}`))
    .join("|");
  const markers = useRef(new Map<string, Marker>());
  useEffect(() => {
    if (!map) return;
    const made = new Map<string, Marker>();
    const hs =
      latest.current.view?.handles.filter((h) =>
        "track" in h ? latest.current.sel?.id === h.track : latest.current.sel?.id === h.station,
      ) ?? [];
    let frame = 0;
    for (const h of hs) {
      const key = "track" in h ? `${h.track}:${h.kind}:${h.index}` : `r${h.station}`;
      const el = handleElement(h.kind, "track" in h && h.kind === "pi" && latest.current.sel?.pi === h.index);
      const m = new Marker({ element: el, draggable: true }).setLngLat(h.lonlat).addTo(map);
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if ("track" in h && h.kind === "pi" && h.index !== null) setSel({ id: h.track, pi: h.index });
      });
      const apply = (final: boolean) => {
        const s = latest.current;
        const e = engine.current;
        if (!s.doc || !e) return;
        const { lng, lat: la } = m.getLngLat();
        const at = e.toLocal(s.doc.origin, [lng, la]);
        if ("station" in h) {
          const st = s.doc.stations.find((x) => x.id === h.station);
          if (!st) return;
          const deg = Math.round((Math.atan2(at[1] - st.y, at[0] - st.x) * 180) / Math.PI - 90);
          setDoc(
            (d) =>
              d &&
              update(d, "stations", h.station, (x) => ({ ...x, rotation_deg: ((deg % 360) + 360) % 360 })),
          );
          return;
        }
        const t = s.doc.tracks.find((x) => x.id === h.track);
        if (!t) return;
        let next: Track = t;
        if (h.kind === "pi" && h.index !== null)
          next = { ...t, points: t.points.map((p, i) => (i === h.index ? { ...p, x: at[0], y: at[1] } : p)) };
        else if (h.kind === "lead_start" || h.kind === "lead_end") {
          const c = connLocal(h.kind === "lead_start" ? t.start : (t.end ?? t.start));
          if (c) {
            const v = Math.max(5, (at[0] - c.p[0]) * c.dir[0] + (at[1] - c.p[1]) * c.dir[1]);
            next = h.kind === "lead_start" ? { ...t, lead_start_m: v } : { ...t, lead_end_m: v };
          }
        } else if (h.kind === "end" || h.kind === "start") {
          const pt = map.project([lng, la]);
          const conn = final ? connectionAt(pt, t.tracks) : null;
          const a: Anchor = conn ? conn.anchor : { type: "free", x: at[0], y: at[1], level: draftLevel(t) };
          next = h.kind === "end" ? { ...t, end: a } : { ...t, start: a };
          if (conn) next = autoLeads(next, connLocal(next.start), connLocal(conn.anchor), null, minLead);
        }
        setDoc((d) => d && update(d, "tracks", t.id, () => next));
      };
      m.on("dragstart", () => {
        if (h.kind === "end" || h.kind === "start") {
          dragging.current = { kind: "end" };
          showConnections(map, true);
        }
      });
      m.on("drag", () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => apply(false));
      });
      m.on("dragend", () => {
        cancelAnimationFrame(frame);
        apply(true);
        if (dragging.current?.kind === "end") {
          dragging.current = null;
          showConnections(map, latest.current.tool === "track");
        }
      });
      made.set(key, m);
    }
    markers.current = made;
    return () => {
      cancelAnimationFrame(frame);
      made.forEach((m) => m.remove());
    };
  }, [map, handleKey, sel?.pi, connLocal, connectionAt, minLead]);
  // Keep handles on the fitted geometry while not being dragged.
  useEffect(() => {
    for (const h of handles) {
      const key = "track" in h ? `${h.track}:${h.kind}:${h.index}` : `r${h.station}`;
      const m = markers.current.get(key);
      if (m && !m.isDraggable?.()) continue;
      if (m && !(m as unknown as { _isDragging?: boolean })._isDragging) m.setLngLat(h.lonlat);
    }
  }, [handles]);

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

  // Keyboard.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const s = latest.current;
      const k = ev.key.toLowerCase();
      if (s.draft) {
        if (ev.key === "+" || ev.key === "=" || ev.key === "-" || ev.key === "_") {
          const up = ev.key === "+" || ev.key === "=";
          setDraft({
            ...s.draft,
            level: shiftLevel(draftLevel(s.draft), up ? 1 : -1),
            points: s.draft.points,
          });
          setTrackOpts((o) => ({ ...o, level: shiftLevel(draftLevel(s.draft!), up ? 1 : -1) }));
          ev.preventDefault();
          return;
        }
        if (ev.key === "Backspace" || ev.key === "Delete") {
          setDraft({ ...s.draft, points: s.draft.points.slice(0, -1) });
          ev.preventDefault();
          return;
        }
        if (ev.key === "Enter") return finishDraft(null);
        if (ev.key === "Escape") {
          setDraft(null);
          setCursor(null);
          return;
        }
      }
      if (s.tool === "line" && (ev.key === "Enter" || ev.key === "Escape")) return finishLine();
      if (ev.key === "Escape") return setSel(null);
      if (k === "f" && s.sel && s.doc && kindOf(s.doc, s.sel.id, sigs(s.view)) === "signal") {
        setDoc(
          updateSignal(s.doc, s.sel.id, (x) => ({ ...x, facing: x.facing === 1 ? -1 : 1 }), sigs(s.view)),
        );
        return;
      }
      if ((ev.key === "Delete" || ev.key === "Backspace") && s.sel && s.doc) {
        ev.preventDefault();
        if (s.sel.pi !== undefined) {
          const { id, pi } = s.sel;
          setDoc(update(s.doc, "tracks", id, (t) => ({ ...t, points: t.points.filter((_, i) => i !== pi) })));
          setSel({ id });
        } else {
          setDoc(deleteElement(s.doc, s.sel.id, anchorAt, sigs(s.view)));
          setSel(null);
        }
        return;
      }
      const tools: Record<string, RailTool> = {
        v: "select",
        s: "station",
        t: "track",
        b: "turnout",
        x: "crossover",
        g: "signal",
        h: "pan",
        l: "line",
      };
      if (tools[k]) toolChange.current(tools[k]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finishDraft]);

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
    setNote("Click the first station of the new line.");
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
      setNote("Signals reset to the ones generated from the design.");
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
      streetNote={streetNote}
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
            flowsLabel="Trains per hour on each track (sample service until rail lines are drawn)"
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
            {flash ?? "Starting the railway engine…"}
          </p>
        )}
        {note && (
          <p className="rounded-full bg-blue-700 px-3 py-1 text-white" role="status">
            {note}
          </p>
        )}
        <p className="rounded-full bg-white/95 px-3 py-1 text-slate-700 shadow" role="note">
          {HINTS[tool]}
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

/**
 * Purpose: the station under a map click: a drawn station feature, else the station whose centre is
 * nearest within 30 px. Output: the station id, or `null`.
 */
function stationAt(map: MapLibreMap, pt: { x: number; y: number }, doc: Network, view: RailView | null) {
  const box: [[number, number], [number, number]] = [
    [pt.x - 6, pt.y - 6],
    [pt.x + 6, pt.y + 6],
  ];
  const layers = HIT_LAYERS.filter((l) => map.getLayer(l));
  const hit = map
    .queryRenderedFeatures(box, { layers })
    .map((h) => Number(h.properties?.ref))
    .find((r) => doc.stations.some((s) => s.id === r));
  if (hit) return hit;
  let best: { id: number; d: number } | null = null;
  for (const sv of view?.stations ?? []) {
    const p = map.project(sv.lonlat);
    const d = Math.hypot(p.x - pt.x, p.y - pt.y);
    if (d <= 30 && (!best || d < best.d)) best = { id: sv.id, d };
  }
  return best?.id ?? null;
}

/** Purpose: the level new points of a track get (its last point's, else the track's). */
function draftLevel(t: Track) {
  return t.points[t.points.length - 1]?.level ?? t.level;
}

/** Purpose: DOM element for an edit handle. */
function handleElement(kind: string, selected: boolean): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("role", "button");
  el.setAttribute("aria-label", kind === "rotate" ? "Rotate station" : `Track ${kind.replace("_", " ")}`);
  const lead = kind === "lead_start" || kind === "lead_end";
  Object.assign(el.style, {
    width: kind === "rotate" ? "16px" : "13px",
    height: kind === "rotate" ? "16px" : "13px",
    boxSizing: "border-box",
    borderRadius: lead ? "3px" : "50%",
    background: kind === "rotate" ? COLORS.accent : "#ffffff",
    border: `2px solid ${COLORS.accent}`,
    boxShadow: selected ? `0 0 0 3px #f59e0b` : "0 1px 3px rgba(0,0,0,.35)",
    cursor: "grab",
  });
  el.title =
    kind === "rotate"
      ? "Drag to rotate the station"
      : lead
        ? "Drag to lengthen or shorten the straight out of the connection"
        : "Drag to move; click to select";
  return el;
}

/** Purpose: DOM element for a station name. */
function labelElement(name: string): HTMLElement {
  const el = document.createElement("div");
  el.textContent = name;
  Object.assign(el.style, {
    pointerEvents: "none",
    whiteSpace: "nowrap",
    color: "#1f2937",
    font: "600 12px system-ui, sans-serif",
    textShadow: "0 0 3px #fff, 0 0 3px #fff, 0 0 3px #fff",
  });
  return el;
}
