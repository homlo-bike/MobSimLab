import { Marker, type Map as MapLibreMap } from "maplibre-gl";
import { type Dispatch, type MutableRefObject, type SetStateAction, useEffect, useMemo, useRef } from "react";
import { autoLeads, type LocalConnection, update } from "./doc";
import { handleElement } from "./editorDom";
import { type DraggingRef, draftLevel, type LatestRef, type Selection } from "./editorState";
import { showConnections } from "./mapLayers";
import type { Anchor, ConnectionView, Network, RailEngine, RailView, Track } from "./types";

/**
 * Purpose: edit handles for the selected track (points, leads, free ends) and station (rotation),
 * as draggable map markers. Side effects: adds markers to the map while something is selected.
 */
export function useEditHandles({
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
}: {
  map: MapLibreMap | null;
  engine: MutableRefObject<RailEngine | null>;
  view: RailView | null;
  sel: Selection | null;
  latest: LatestRef;
  dragging: DraggingRef;
  setDoc: Dispatch<SetStateAction<Network | null>>;
  setSel: Dispatch<SetStateAction<Selection | null>>;
  connLocal: (a: Anchor) => LocalConnection | null;
  connectionAt: (pt: { x: number; y: number }, wantTracks: number | null) => ConnectionView | null;
  minLead: number;
}) {
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
}
