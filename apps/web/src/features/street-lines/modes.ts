import type { MessageKey } from "../../i18n/messages";
import type { Mode } from "./types";

/** Display settings per street mode (colours as in the line and track drawing mockup). */
export const MODES: Record<Mode, { label: MessageKey; color: string; profile: MessageKey }> = {
  bus: { label: "mode.bus", color: "#d2392c", profile: "street.profile.bus" },
  brt: { label: "mode.brt", color: "#a3358c", profile: "street.profile.brt" },
  trolleybus: { label: "mode.trolleybus", color: "#1e8a4f", profile: "street.profile.trolleybus" },
  intercity_bus: { label: "mode.intercity_bus", color: "#cf7f00", profile: "street.profile.intercity_bus" },
};

export const MODE_ORDER: Mode[] = ["bus", "brt", "trolleybus", "intercity_bus"];

/** Timetable sketch values for the panel's cycle and vehicle numbers. Sample defaults, editable. */
export interface Timing {
  headwayMin: number;
  dwellS: number;
  layoverMin: number;
}

export const DEFAULT_TIMING: Timing = { headwayMin: 10, dwellS: 20, layoverMin: 5 };
