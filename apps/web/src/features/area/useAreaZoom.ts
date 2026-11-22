import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import type { AreaView } from "./api";
import { AREA_CHANGED, drawAreaLayer } from "./areaLayer";
import type { Bbox } from "./drawnBox";

/** Closest zoom when opening on the drawing, so a single stop or depot still shows its surroundings. */
const DRAWN_MAX_ZOOM = 15;

/**
 * Purpose: put the map on the project's area (the polygons drawn for it) when a
 * project opens on a map, unless something moved the map first: a tool framing its drawing, or the
 * planner. A project without an area (opened from a file without map data, or never given one) opens on the box
 * round its drawing instead. Runs again for a new map (another tab) or another project.
 * Inputs: the map, the project id, how to read its area and how to read the box round its drawing (each `null`
 * when it cannot be read).
 * Output: the area as last read (its countries too), or null before.
 * Side effects: reads the area from the server, and again when it is saved (`notifyAreaChanged`); draws its
 * edges as the Project area layer (areaLayer.ts); moves the map once.
 */
export function useAreaZoom(
  map: MapLibreMap | null,
  projectId: string,
  load: ((projectId: string) => Promise<AreaView>) | null,
  drawn: ((projectId: string) => Promise<Bbox | null>) | null = null,
): AreaView | null {
  const loadNow = useRef(load);
  loadNow.current = load;
  const drawnNow = useRef(drawn);
  drawnNow.current = drawn;
  const [area, setArea] = useState<{ projectId: string; view: AreaView } | null>(null);
  useEffect(() => {
    const read = loadNow.current;
    if (!map || !read) return;
    let moved = false;
    let live = true;
    const onMove = () => {
      moved = true;
    };
    map.once?.("movestart", onMove);
    const draw = (a: AreaView) => {
      const go = () => drawAreaLayer(map, a.polygons ?? []);
      if (typeof map.isStyleLoaded !== "function" || map.isStyleLoaded()) go();
      else map.once?.("load", go);
    };
    const reload = () => {
      read(projectId)
        .then((a) => {
          if (!live) return;
          setArea({ projectId, view: a });
          draw(a);
        })
        .catch(() => {});
    };
    window.addEventListener(AREA_CHANGED, reload);
    const fit = (b: Bbox | null, maxZoom?: number) => {
      if (!live || moved || !b) return;
      map.fitBounds(
        [
          [b[0], b[1]],
          [b[2], b[3]],
        ],
        { padding: 40, duration: 0, ...(maxZoom === undefined ? {} : { maxZoom }) },
      );
    };
    // Without an area (or when it cannot be read: the static viewer has none), the box round the drawing.
    const fallback = () => {
      const box = drawnNow.current;
      if (!live || moved || !box) return;
      box(projectId)
        .then((b) => fit(b, DRAWN_MAX_ZOOM))
        .catch(() => {});
    };
    read(projectId)
      .then((a) => {
        if (live) {
          setArea({ projectId, view: a });
          draw(a);
        }
        if (a.bbox) fit(a.bbox);
        else fallback();
      }, fallback)
      .catch(() => {});
    return () => {
      live = false;
      map.off?.("movestart", onMove);
      window.removeEventListener(AREA_CHANGED, reload);
    };
  }, [map, projectId]);
  return area?.projectId === projectId ? area.view : null;
}
