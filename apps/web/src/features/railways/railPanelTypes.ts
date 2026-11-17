import type { ServiceCalendar } from "../../workspace/calendar";
import type { Selection } from "./editorState";
import type { Publication } from "./ServiceLinesPanel";
import type { IssueView, Level, LonLat, Network, Power, RailMode, RailView, Track, TrackUse } from "./types";

/** Railway editing tools, as in the mockup. */
export type RailTool = "select" | "station" | "track" | "turnout" | "crossover" | "signal" | "pan" | "line";

/** Settings for the next track drawn. */
export interface NewTrackOpts {
  tracks: 1 | 2;
  level: Level;
  power: Power;
  use: TrackUse;
}

/** Settings for the next station placed. */
export interface NewStationOpts {
  level: Level;
  sides: number;
  islands: number;
}

/** Settings for the next switch placed (`element` null = the mode's default turnout). */
export interface NewSwitchOpts {
  junction: boolean;
  scissors: boolean;
  element: string | null;
}

/** Edits the panel can ask for; the editor applies them. */
export interface RailPanelActions {
  setTool: (t: RailTool) => void;
  setDoc: (d: Network) => void;
  select: (s: Selection | null) => void;
  setTrackOpts: (o: NewTrackOpts) => void;
  setStationOpts: (o: NewStationOpts) => void;
  setSwitchOpts: (o: NewSwitchOpts) => void;
  finishDraft: () => void;
  cancelDraft: () => void;
  remove: (id: number) => void;
  setMode: (m: RailMode) => void;
  clear: () => void;
  showIssue: (at: LonLat | null, ref: number | null) => void;
  /** Rename a station and the stations next to it; a name used farther away gets a number. */
  renameStation: (id: number, name: string) => void;
  fit: () => void;
  /** Drop the planner's signal changes, so the plan is the generated one again. */
  resetSignals: () => void;
}

/** What the railway side panel and its inspectors are given. */
export interface RailPanelProps {
  /** Why streets (and so level crossings) are missing, if they are. */
  streetNote?: string | null;
  /** Existing railways from OpenStreetMap are loaded (app setting). */
  existingRailways?: boolean;
  doc: Network;
  view: RailView;
  tool: RailTool;
  sel: Selection | null;
  draft: Track | null;
  trackOpts: NewTrackOpts;
  stationOpts: NewStationOpts;
  switchOpts: NewSwitchOpts;
  error: string | null;
  actions: RailPanelActions;
  /** Checks from plugins (noise), added after the design's own. */
  extraIssues?: IssueView[];
  /** Service lines: the last publication, publishing, and picking stops on the map. */
  service: {
    /** The project's design rules (Project preferences), for the platform access check. */
    designValues?: Readonly<Record<string, number>> | null;
    publication: Publication | null;
    publish: () => void;
    picking: string | null;
    setPicking: (id: string | null) => void;
    /** The project calendar (peak windows of each day type); the default calendar when absent. */
    calendar?: ServiceCalendar;
  };
}
