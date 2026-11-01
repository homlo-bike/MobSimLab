import { Marker, type Map as MapLibreMap, type MapMouseEvent } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  addStation,
  addSwitch,
  autoLeads,
  deleteElement,
  emptyNetwork,
  kindOf,
  newTrack,
  update,
  type LocalConnection,
} from "./doc";
import { loadRailEngine } from "./engine";
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
  Track,
} from "./types";

const HINTS: Record<RailTool, string> = {
  select:
    "Click a station, track or switch to edit it. Drag stations and track points; drag a switch along its track.",
  station: "Click on the map to place a station. Then drag it into place and rotate it.",
  track:
    "Click a connection point or the map to start, click to add points, click a connection point or double-click to finish. + / − change the level.",
  turnout: "Click on a track to place a turnout (double junction on double track), then draw the branch.",
  crossover: "Click on a double track to place a crossover.",
  pan: "Drag to move the map.",
};

/** The drawing survives closing and reopening the tool during the session. */
let kept: Network | null = null;

interface Props {
  /** The map; `null` until it has loaded. */
  map: MapLibreMap | null;
  /** Where the side panel renders; inline when `null`. */
  panel?: HTMLElement | null;
  /** Engine loader; tests inject a fake. */
  loadEngine?: RailEngineLoader;
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
export function RailwayEditor({ map, panel = null, loadEngine = loadRailEngine }: Props) {
  const engine = useRef<RailEngine | null>(null);
  const [ready, setReady] = useState(false);
  const [doc, setDoc] = useState<Network | null>(kept);
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

  // A new drawing starts at the map centre.
  useEffect(() => {
    if (!map || doc) return;
    const c = map.getCenter();
    setDoc(emptyNetwork("metro", [c.lng, c.lat]));
  }, [map, doc]);
  useEffect(() => {
    kept = doc;
  }, [doc]);

  const local = useCallback(
    (ll: LonLat): [number, number] =>
      engine.current && doc ? engine.current.toLocal(doc.origin, ll) : [0, 0],
    [doc],
  );

  // The draft with its end at the cursor (or the connection under it).
  const shown = useMemo(() => {
    if (!doc) return null;
    if (!draft) return { doc, draftId: null };
    const end: Anchor | null = cursor?.conn
      ? cursor.conn.anchor
      : cursor
        ? { type: "free", x: cursor.at[0], y: cursor.at[1], level: draftLevel(draft) }
        : null;
    return { doc: { ...doc, tracks: [...doc.tracks, { ...draft, end }] }, draftId: draft.id };
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
  }, [ready, shown]);
  const lastView = useRef<RailView | null>(null);
  if (view) lastView.current = view;

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
  const gauge = view ? view.params.gauge_mm / 1000 : 1.435;
  useEffect(() => {
    if (!map) return;
    ensureRailLayers(map, lat, gauge);
    return () => removeRailLayers(map);
  }, [map, lat, gauge]);
  const selection: FeatureCollection = useMemo(() => {
    const features = (view?.layers.tracks.features ?? []).filter((f) => sel && f.properties.ref === sel.id);
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
  const latest = useRef({ tool, doc, draft, sel, trackOpts, stationOpts, switchOpts, view, cursor });
  latest.current = { tool, doc, draft, sel, trackOpts, stationOpts, switchOpts, view, cursor };
  const dragging = useRef<
    | { kind: "station"; id: number; dx: number; dy: number }
    | { kind: "switch"; id: number; track: number; offset: number }
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
      if (s.tool === "station") {
        const [d, id] = addStation(s.doc, at, {
          ...s.stationOpts,
          platformLength: params?.platform_length_m ?? 120,
        });
        setDoc(d);
        setSel({ id });
        setTool("select");
      } else if (s.tool === "track") {
        if (!s.draft) {
          const c = connectionAt(ev.point, s.trackOpts.tracks);
          if (c) startDraft(c.anchor, s.doc, c.level, c.tracks === 2 ? 2 : 1);
          else startDraft({ type: "free", x: at[0], y: at[1] }, s.doc, s.trackOpts.level, s.trackOpts.tracks);
          return;
        }
        const c = connectionAt(ev.point, s.draft.tracks);
        if (c) return finishDraft(c.anchor);
        const dr = s.draft;
        const pts = [...dr.points, { x: at[0], y: at[1], level: draftLevel(dr) }];
        const next = autoLeads({ ...dr, points: pts }, connLocal(dr.start), null, null, minLead);
        setDraft(next);
      } else if (s.tool === "turnout" || s.tool === "crossover") {
        const hit = e.nearestTrack(ll, pxToM(10));
        if (!hit) return say("Click on a track to place a switch.");
        if (!hit.straight) return say("Catalogue switches go on straight track. Click on a straight part.");
        const element = s.switchOpts.element ?? params?.default_turnout ?? "";
        if (s.tool === "crossover") {
          if (hit.tracks !== 2) return say("Crossovers join two parallel tracks. Pick a double track.");
          const t = s.view?.turnouts.find((x) => x.id === element);
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
      } else if (s.tool === "select") {
        const box: [[number, number], [number, number]] = [
          [ev.point.x - 5, ev.point.y - 5],
          [ev.point.x + 5, ev.point.y + 5],
        ];
        const layers = HIT_LAYERS.filter((l) => map.getLayer(l));
        const hits = map.queryRenderedFeatures(box, { layers });
        const ref = hits.map((h) => Number(h.properties?.ref)).find((r) => kindOf(s.doc!, r));
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
      if (s.tool === "track" && s.draft) {
        const conn = connectionAt(ev.point, s.draft.tracks);
        const at = e.toLocal(s.doc.origin, ll);
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
      const ref = hits.map((h) => Number(h.properties?.ref)).find((r) => kindOf(s.doc!, r));
      if (!ref || s.sel?.id !== ref) return;
      const ll: LonLat = [ev.lngLat.lng, ev.lngLat.lat];
      const kind = kindOf(s.doc, ref);
      if (kind === "station") {
        const st = s.doc.stations.find((x) => x.id === ref)!;
        const at = engine.current.toLocal(s.doc.origin, ll);
        dragging.current = { kind: "station", id: ref, dx: at[0] - st.x, dy: at[1] - st.y };
      } else if (kind === "switch") {
        const sw = s.doc.switches.find((x) => x.id === ref)!;
        const ch = engine.current.chainage(sw.track, ll);
        if (!Number.isFinite(ch)) return;
        dragging.current = { kind: "switch", id: ref, track: sw.track, offset: ch - sw.s };
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
      if (ev.key === "Escape") return setSel(null);
      if ((ev.key === "Delete" || ev.key === "Backspace") && s.sel && s.doc) {
        ev.preventDefault();
        if (s.sel.pi !== undefined) {
          const { id, pi } = s.sel;
          setDoc(update(s.doc, "tracks", id, (t) => ({ ...t, points: t.points.filter((_, i) => i !== pi) })));
          setSel({ id });
        } else {
          setDoc(deleteElement(s.doc, s.sel.id, anchorAt));
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
        h: "pan",
      };
      if (tools[k]) setTool(tools[k]);
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
    setTool(t);
  };

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
      setDoc(deleteElement(doc, id, anchorAt));
      setSel(null);
    },
    setMode: (mode: RailMode) => {
      if (!doc) return;
      setDoc({ ...doc, mode, params: null });
    },
    example: () => {
      if (!map || !engine.current || !doc) return;
      const c = map.getCenter();
      const d = engine.current.sample(doc.mode, [c.lng, c.lat]);
      setDoc(d);
      setSel(null);
      setDraft(null);
      setTool("select");
      const v = engine.current.build(d, null);
      if (v.bbox)
        map.fitBounds(
          [
            [v.bbox[0], v.bbox[1]],
            [v.bbox[2], v.bbox[3]],
          ],
          { padding: 60, duration: 0 },
        );
    },
    clear: () => {
      if (!map) return;
      const c = map.getCenter();
      setDoc(emptyNetwork(doc?.mode ?? "metro", [c.lng, c.lat]));
      setSel(null);
      setDraft(null);
      setTool("station");
    },
    showIssue: (at: LonLat | null, ref: number | null) => {
      if (ref) setSel({ id: ref });
      if (at && map) map.easeTo({ center: at, zoom: Math.max(map.getZoom(), 16) });
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
      actions={panelActions}
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
          >
            {flash ?? "Starting the railway engine…"}
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
