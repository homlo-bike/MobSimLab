import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import type { AreaView } from "./api";

/**
 * Purpose: put the map on the project's area (the regions picked for it, or around its drawing) when a
 * project opens on a map, unless something moved the map first: a tool framing its drawing, or the
 * planner. Runs again for a new map (another tab) or another project.
 * Inputs: the map, the project id and how to read its area (`null` when it cannot be read).
 * Output: the area as last read (its countries too), or null before.
 * Side effects: reads the area from the server; moves the map once.
 */
export function useAreaZoom(
  map: MapLibreMap | null,
  projectId: string,
  load: ((projectId: string) => Promise<AreaView>) | null,
): AreaView | null {
  const loadNow = useRef(load);
  loadNow.current = load;
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
    read(projectId)
      .then((a) => {
        if (live) setArea({ projectId, view: a });
        const b = a.bbox;
        if (!live || moved || !b) return;
        map.fitBounds(
          [
            [b[0], b[1]],
            [b[2], b[3]],
          ],
          { padding: 40, duration: 0 },
        );
      })
      .catch(() => {});
    return () => {
      live = false;
      map.off?.("movestart", onMove);
    };
  }, [map, projectId]);
  return area?.projectId === projectId ? area.view : null;
}
