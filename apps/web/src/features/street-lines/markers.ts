import type { PointView } from "./types";

/**
 * Purpose: DOM element for a route point: a numbered square in the line colour for stops,
 * a small hollow circle for via points; the station name beside the first stop of a group.
 */
export function pointElement(
  p: PointView,
  color: string,
  selected: boolean,
  label: string | null,
): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("role", "button");
  el.setAttribute("aria-label", `Point ${p.seq + 1}: ${p.name}`);
  el.title = `${p.seq + 1}. ${p.name}${p.message ? ` — ${p.message}` : ""}`;
  const via = p.kind === "via";
  const error = p.status === "error";
  const size = via ? 14 : 22;
  Object.assign(el.style, {
    position: "relative",
    width: `${size}px`,
    height: `${size}px`,
    boxSizing: "border-box",
    borderRadius: via ? "50%" : "5px",
    background: via ? "#ffffff" : error ? "#dc2626" : color,
    border: via ? `3px solid ${error ? "#dc2626" : color}` : "2px solid #ffffff",
    boxShadow: selected ? "0 0 0 3px #f59e0b, 0 1px 3px rgba(0,0,0,.4)" : "0 1px 3px rgba(0,0,0,.4)",
    color: "#ffffff",
    font: "700 11px/18px system-ui, sans-serif",
    textAlign: "center",
    cursor: "pointer",
    userSelect: "none",
  });
  if (!via) el.textContent = String(p.seq + 1);
  if (label) {
    const span = document.createElement("span");
    span.textContent = label;
    Object.assign(span.style, {
      position: "absolute",
      left: `${size + 4}px`,
      top: "50%",
      transform: "translateY(-50%)",
      whiteSpace: "nowrap",
      color: "#1f2937",
      font: "600 12px system-ui, sans-serif",
      textShadow: "0 0 3px #fff, 0 0 3px #fff, 0 0 3px #fff",
      pointerEvents: "none",
    });
    el.appendChild(span);
  }
  return el;
}

/** Purpose: DOM element for the depot gate. */
export function depotElement(): HTMLElement {
  const el = document.createElement("div");
  el.textContent = "D";
  el.title = "Depot gate";
  Object.assign(el.style, {
    width: "24px",
    height: "24px",
    lineHeight: "20px",
    textAlign: "center",
    background: "#374151",
    color: "#fff",
    border: "2px solid #fff",
    borderRadius: "4px",
    font: "700 12px system-ui, sans-serif",
    boxShadow: "0 1px 3px rgba(0,0,0,.4)",
    cursor: "pointer",
  });
  return el;
}

/** Purpose: DOM element for the preview vehicle (a bus seen from above, pointing up). */
export function vehicleElement(color: string): HTMLElement {
  const el = document.createElement("div");
  Object.assign(el.style, {
    width: "10px",
    height: "24px",
    background: color,
    border: "2px solid #fff",
    borderRadius: "3px 3px 2px 2px",
    boxShadow: "0 1px 4px rgba(0,0,0,.5)",
    pointerEvents: "none",
  });
  return el;
}
