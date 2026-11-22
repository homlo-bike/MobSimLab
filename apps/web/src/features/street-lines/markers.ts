import { engineTextNow } from "../../i18n/engine";
import { tNow } from "../../i18n/i18n";
import type { PointView } from "./types";

/**
 * Purpose: DOM element for a route point, drawn as in the line and track drawing mockup: a numbered circle in
 * the line colour for stops, a numbered rounded square for end stops (both with a white edge), a small white
 * circle edged in the line colour for via points; a dashed ring when selected, a red ring on an error; the
 * station name beside the first stop of a group.
 */
export function pointElement(
  p: PointView,
  color: string,
  selected: boolean,
  label: string | null,
): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("role", "button");
  el.setAttribute(
    "aria-label",
    `${tNow("street.marker", { n: p.seq + 1, name: p.name })}${p.status === "error" && p.message ? `. ${engineTextNow({ text: p.message, msg: p.message_msg })}` : ""}`,
  );
  el.title = `${p.seq + 1}. ${p.name}${p.message ? ` — ${engineTextNow({ text: p.message, msg: p.message_msg })}` : ""}`;
  const via = p.kind === "via";
  const end = p.kind === "end_stop";
  const error = p.status === "error";
  const size = via ? (selected ? 13 : 10) : end ? 21 : 19;
  const rings = [
    ...(error ? ["0 0 0 4px #ffffff", `0 0 0 6.5px ${ERROR}`] : []),
    "0 1px 2px rgba(0,0,0,.35)",
  ];
  // No `position` here: MapLibre's marker class makes the element absolute and places it with a transform.
  // An inline `position: relative` puts every marker in the page flow, so each one sits lower than the last
  // and none stays where the planner clicked. Absolute still anchors the name label below.
  Object.assign(el.style, {
    width: `${size}px`,
    height: `${size}px`,
    boxSizing: "border-box",
    borderRadius: end ? "3px" : "50%",
    background: via ? "#ffffff" : color,
    border: via ? `2.2px solid ${color}` : "2px solid #ffffff",
    boxShadow: rings.join(", "),
    outline: selected ? `2.5px dashed ${ACCENT}` : "none",
    outlineOffset: via ? "3px" : "4px",
    color: "#ffffff",
    font: `600 11px/${size - 4}px "IBM Plex Mono", ui-monospace, monospace`,
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
      left: `${size + 5}px`,
      top: "50%",
      transform: "translateY(-50%)",
      whiteSpace: "nowrap",
      color: "var(--map-label, #1b2125)",
      font: "600 12px Barlow, system-ui, sans-serif",
      // On a dark basemap the name is light on a dark halo (MapView, index.css `.map-dark`).
      textShadow:
        "0 0 3px var(--map-halo, #fff), 0 0 3px var(--map-halo, #fff), 0 0 3px var(--map-halo, #fff)",
      pointerEvents: "none",
    });
    el.appendChild(span);
  }
  return el;
}

/** The mockup's accent (selection) and error colours. */
const ACCENT = "#0c6a60";
const ERROR = "#bf3a2b";

/** Purpose: DOM element for the depot gate. */
export function depotElement(): HTMLElement {
  const el = document.createElement("div");
  el.textContent = "D";
  el.title = tNow("street.depotGate");
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
