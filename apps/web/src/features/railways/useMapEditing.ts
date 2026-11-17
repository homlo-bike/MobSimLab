import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import { type Dispatch, type MutableRefObject, type SetStateAction, useEffect } from "react";
import { tNow } from "../../i18n/i18n";
import { basemapLabels, featuresFromLabels, preferTransitKind } from "../naming/labels";
import { describeChoice, nameForNewPlace } from "../naming/names";
import { placesOtherThan } from "../naming/registry";
import {
  addSignal,
  addStation,
  addSwitch,
  autoLeads,
  fallbackStationName,
  kindOf,
  pickElement,
  type LocalConnection,
  stationPlaces,
  update,
  updateSignal,
} from "./doc";
import { stationAt } from "./editorDom";
import {
  type Cursor,
  type DraggingRef,
  draftLevel,
  type LatestRef,
  type Selection,
  sigs,
} from "./editorState";
import { HIT_LAYERS } from "./mapLayers";
import type { RailTool } from "./railPanelTypes";
import { updateLine } from "./serviceLines";
import type { TrackEnd } from "./trackEnds";
import type { Anchor, ConnectionView, LonLat, Network, RailEngine, Track } from "./types";

/**
 * Purpose: the editor's map clicks, double-clicks and drags: placing stations, drawing tracks,
 * placing switches and signals, picking a service line's stops, selecting and moving elements.
 * Side effects: registers handlers on the map while mounted.
 */
export function useMapEditing({
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
}: {
  map: MapLibreMap | null;
  engine: MutableRefObject<RailEngine | null>;
  latest: LatestRef;
  dragging: DraggingRef;
  say: (m: string) => void;
  setDoc: Dispatch<SetStateAction<Network | null>>;
  setSel: Dispatch<SetStateAction<Selection | null>>;
  setTool: Dispatch<SetStateAction<RailTool>>;
  setNote: Dispatch<SetStateAction<string | null>>;
  setDraft: Dispatch<SetStateAction<Track | null>>;
  setCursor: Dispatch<SetStateAction<Cursor | null>>;
  connectionAt: (pt: { x: number; y: number }, wantTracks: number | null) => ConnectionView | null;
  trackEndAt: (pt: { x: number; y: number }, wantTracks: number | null) => TrackEnd | null;
  connLocal: (a: Anchor) => LocalConnection | null;
  finishDraft: (end: Anchor | null) => void;
  startDraft: (start: Anchor, d: Network, level: Track["level"], tracks: 1 | 2) => void;
  minLead: number;
  pxToM: (px: number) => number;
}) {
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
        if (station === null) return say(tNow("rail.pick.clickStation"));
        const name = s.doc.stations.find((x) => x.id === station)?.name ?? tNow("rail.pick.thisStation");
        const last = pickLine.stations[pickLine.stations.length - 1];
        if (last === station) return say(tNow("rail.pick.lastAlready", { name }));
        if (pickLine.stations.includes(station)) return say(tNow("rail.pick.already", { name }));
        if (last !== undefined) {
          let reach: { ok: boolean; reason: string | null };
          try {
            reach = e.reachable(last, station);
          } catch (err) {
            return say(err instanceof Error ? err.message : String(err));
          }
          if (!reach.ok) return say(reach.reason ?? tNow("rail.pick.unreachable", { name }));
        }
        setDoc(updateLine(s.doc, pickLine.id, (l) => ({ ...l, stations: [...l.stations, station] })));
        setNote(
          pickLine.stations.length === 0
            ? tNow("rail.pick.first", { name })
            : tNow("rail.pick.added", { name }),
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
          radiusM: s.stationGroupingM,
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
          const te = c ? null : trackEndAt(ev.point, null);
          if (c) startDraft(c.anchor, s.doc, c.level, c.tracks === 2 ? 2 : 1);
          else if (te)
            startDraft({ type: "free", x: te.x, y: te.y, level: te.level }, s.doc, te.level, te.tracks);
          else startDraft({ type: "free", x: p[0], y: p[1] }, s.doc, s.trackOpts.level, s.trackOpts.tracks);
          return;
        }
        const c = connectionAt(ev.point, s.draft.tracks);
        if (c) return finishDraft(c.anchor);
        const te = trackEndAt(ev.point, s.draft.tracks);
        if (te) return finishDraft({ type: "free", x: te.x, y: te.y, level: te.level });
        const dr = s.draft;
        const pts = [...dr.points, { x: p[0], y: p[1], level: draftLevel(dr) }];
        const next = autoLeads({ ...dr, points: pts }, connLocal(dr.start), null, null, minLead);
        setDraft(next);
      } else if (s.tool === "turnout" || s.tool === "crossover") {
        const hit = e.nearestTrack(ll, pxToM(10));
        if (!hit) return say(tNow("rail.say.clickTrackSwitch"));
        if (!hit.straight) return say(tNow("rail.say.straightOnly"));
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
          if (hit.tracks !== 2) return say(tNow("rail.say.doubleOnly"));
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
        if (!anchor) return say(tNow("rail.say.clickTrackSignal"));
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
        const ref = pickElement(
          s.doc,
          hits.map((h) => Number(h.properties?.ref)),
          sigs(s.view),
        );
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
      const te = trackEndAt(ev.point, dr.tracks);
      finishDraft(
        te
          ? { type: "free", x: te.x, y: te.y, level: te.level }
          : { type: "free", x: at[0], y: at[1], level: draftLevel(dr) },
      );
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
        const te = conn ? null : trackEndAt(ev.point, s.draft.tracks);
        const snap = te ? null : e.existingSnap(ll, pxToM(10));
        const at: [number, number] = te ? [te.x, te.y] : e.toLocal(s.doc.origin, snap ? snap.lonlat : ll);
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
      const ref = pickElement(
        s.doc,
        hits.map((h) => Number(h.properties?.ref)),
        sigs(s.view),
      );
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
  }, [map, connectionAt, trackEndAt, connLocal, finishDraft, minLead, pxToM, startDraft]);
}
