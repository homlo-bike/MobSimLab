import type { MutableRefObject } from "react";
import type { NewStationOpts, NewSwitchOpts, NewTrackOpts, RailTool } from "./railPanelTypes";
import type { Anchor, ConnectionView, Network, RailView, SignalView, Track } from "./types";

/** The selected element, and the selected point of a track. */
export interface Selection {
  id: number;
  pi?: number;
}

/** The point under the cursor while drawing, and the connection there. */
export type Cursor = { at: [number, number]; conn: ConnectionView | null };

/** The editor's latest state, for map and keyboard handlers registered once. */
export interface EditorState {
  tool: RailTool;
  doc: Network | null;
  draft: Track | null;
  sel: Selection | null;
  trackOpts: NewTrackOpts;
  stationOpts: NewStationOpts;
  switchOpts: NewSwitchOpts;
  view: RailView | null;
  cursor: Cursor | null;
  picking: string | null;
  /** Stations closer than this share a name, m (`analysis.station_grouping_m`). */
  stationGroupingM: number;
}

/** What is being dragged on the map. */
export type Dragging =
  | { kind: "station"; id: number; dx: number; dy: number }
  | { kind: "switch"; id: number; track: number; offset: number }
  | { kind: "signal"; id: number }
  | { kind: "end" }
  | null;

export type LatestRef = MutableRefObject<EditorState>;
export type DraggingRef = MutableRefObject<Dragging>;

/** Purpose: the drawn signals of a view (generated and the planner's), or none before a build. */
export const sigs = (v: RailView | null | undefined): SignalView[] => v?.signals ?? [];

export const sameAnchor = (a: Anchor, b: Anchor) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Purpose: the level the next points of a track being drawn get: the draft's level, which starts at the level of
 * where the track began and changes with + / − or the panel's level buttons. (Taking the last point's level made
 * + / − work only before the first point.)
 */
export function draftLevel(t: Track) {
  return t.level;
}
