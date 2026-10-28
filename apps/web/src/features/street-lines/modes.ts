import type { Mode } from "./types";

/** Display settings per street mode (colours as in the line and track drawing mockup). */
export const MODES: Record<Mode, { label: string; color: string; profile: string }> = {
  bus: {
    label: "Bus",
    color: "#d2392c",
    profile: "Routed on the bus road profile: one-way streets, bus lanes, access rules, vehicle limits.",
  },
  brt: {
    label: "BRT",
    color: "#a3358c",
    profile: "Prefers bus lanes and busways; may use guided busways.",
  },
  trolleybus: {
    label: "Trolleybus",
    color: "#1e8a4f",
    profile: "Follows the overhead wire; stretches without wire need battery range.",
  },
  intercity_bus: {
    label: "Intercity bus",
    color: "#cf7f00",
    profile: "May use motorways; stops can be at bus stations.",
  },
};

export const MODE_ORDER: Mode[] = ["bus", "brt", "trolleybus", "intercity_bus"];

/** Timetable sketch values for the panel's cycle and vehicle numbers. Sample defaults, editable. */
export interface Timing {
  headwayMin: number;
  dwellS: number;
  layoverMin: number;
}

export const DEFAULT_TIMING: Timing = { headwayMin: 10, dwellS: 20, layoverMin: 5 };
