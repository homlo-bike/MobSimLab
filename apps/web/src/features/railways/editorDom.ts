import type { Map as MapLibreMap } from "maplibre-gl";
import { tNow } from "../../i18n/i18n";
import { HIT_LAYERS } from "./mapLayers";
import { COLORS } from "./modes";
import type { Network, RailView } from "./types";

/**
 * Purpose: the station under a map click: a drawn station feature, else the station whose centre is
 * nearest within 30 px. Output: the station id, or `null`.
 */
export function stationAt(
  map: MapLibreMap,
  pt: { x: number; y: number },
  doc: Network,
  view: RailView | null,
) {
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

/** Purpose: DOM element for an edit handle. */
export function handleElement(kind: string, selected: boolean): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("role", "button");
  el.setAttribute(
    "aria-label",
    kind === "rotate"
      ? tNow("rail.handle.rotate")
      : tNow("rail.handle.track", { kind: kind.replace("_", " ") }),
  );
  const lead = kind === "lead_start" || kind === "lead_end";
  if (kind === "rotate") {
    // The rotation grip: a 28 px target round a 14 px dot, so a near miss still grabs it instead of
    // panning the map; the dot grows under the pointer.
    Object.assign(el.style, {
      width: "28px",
      height: "28px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "grab",
      touchAction: "none",
    });
    const dot = document.createElement("div");
    Object.assign(dot.style, {
      width: "14px",
      height: "14px",
      boxSizing: "border-box",
      borderRadius: "50%",
      background: COLORS.accent,
      border: "2px solid #ffffff",
      boxShadow: selected ? `0 0 0 3px #f59e0b` : "0 1px 3px rgba(0,0,0,.45)",
      transition: "transform 80ms",
      pointerEvents: "none",
    });
    el.appendChild(dot);
    el.addEventListener("pointerenter", () => (dot.style.transform = "scale(1.35)"));
    el.addEventListener("pointerleave", () => (dot.style.transform = ""));
    el.title = tNow("rail.handle.rotateHint");
    return el;
  }
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
      ? tNow("rail.handle.rotateHint")
      : lead
        ? tNow("rail.handle.leadHint")
        : tNow("rail.handle.moveHint");
  return el;
}

/** Purpose: DOM element for a station name. */
export function labelElement(name: string): HTMLElement {
  const el = document.createElement("div");
  el.textContent = name;
  Object.assign(el.style, {
    pointerEvents: "none",
    whiteSpace: "nowrap",
    color: "var(--map-label, #1f2937)",
    font: "600 12px system-ui, sans-serif",
    // On a dark basemap the name is light on a dark halo (MapView, index.css `.map-dark`).
    textShadow: "0 0 3px var(--map-halo, #fff), 0 0 3px var(--map-halo, #fff), 0 0 3px var(--map-halo, #fff)",
  });
  return el;
}
