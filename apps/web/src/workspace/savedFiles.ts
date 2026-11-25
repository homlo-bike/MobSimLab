/**
 * Project preferences → Saved project files: which kinds of data a saved `.mslab` file holds. The choices are kept
 * in the preferences document (`savedFiles`), so everyone who saves the project gets the same file.
 */
import type { Tab } from "../shell/route";
import type { PreferencesDoc } from "./preferences";

/** The kinds of data a project holds, in the order the section lists them (as the API's `SAVED_DATA_IDS`). */
export const SAVED_DATA_IDS = [
  "design",
  "vehicles",
  "processed",
  "runs",
  "comments",
  "history",
  "osm",
  "liveTiles",
  "elevation",
  "population",
  "uploads",
  "facts",
  "economy",
  "otherFetched",
  "viewerMap",
] as const;
export type SavedDataId = (typeof SAVED_DATA_IDS)[number];

/** What the project holds of one kind of data (GET /api/projects/:id/mslab/contents). */
export interface SavedDataRow {
  id: SavedDataId;
  /** Bytes, before the file's compression. */
  bytes: number;
  items: number;
  /** When it was last fetched or worked out, ISO time; null when the project holds none. */
  at: string | null;
  /** The services it came from; empty for what the planner made. */
  sources: string[];
}

/** Always in the file: what the planner drew and set. */
export const ALWAYS_SAVED: ReadonlySet<SavedDataId> = new Set(["design"]);

/** The kinds a saved file holds today; the others are kept as choices for the coming updates of the file format. */
export const SAVED_NOW: ReadonlySet<SavedDataId> = new Set([
  "design",
  "vehicles",
  "processed",
  "runs",
  "comments",
  "history",
  "liveTiles",
  "elevation",
  "population",
  "uploads",
  "facts",
  "economy",
  "otherFetched",
  "viewerMap",
]);

/** The kinds of fetched and imported data a file can hold (file format 1.6), as the download's options name them. */
export const FETCHED_IDS = [
  "facts",
  "economy",
  "otherFetched",
  "liveTiles",
  "elevation",
  "population",
  "uploads",
] as const satisfies readonly SavedDataId[];
export type FetchedId = (typeof FETCHED_IDS)[number];

/** Off unless the planner turns it on: the map data for the static viewer is large and takes minutes to make. */
const OFF_BY_DEFAULT: ReadonlySet<SavedDataId> = new Set(["viewerMap"]);

/** Where the data of a kind is updated: a tab, or a section of Project preferences. */
export type UpdateTarget = { tab: Tab } | { section: string };

/** Purpose: where the planner updates a kind of data, or null for data the planner makes by working. */
export function updateTarget(id: SavedDataId): UpdateTarget | null {
  switch (id) {
    case "processed":
      return { tab: "tables" };
    case "runs":
      return { tab: "simulator" };
    case "osm":
    case "liveTiles":
    case "elevation":
    case "population":
    case "uploads":
      return { tab: "gis" };
    case "facts":
      return { section: "climate" };
    case "economy":
      return { section: "currency" };
    default:
      return null;
  }
}

/** Purpose: whether a saved file holds a kind of data: always for the design, else the planner's choice or the default. */
export function savedIn(doc: PreferencesDoc | null | undefined, id: SavedDataId): boolean {
  if (ALWAYS_SAVED.has(id)) return true;
  return doc?.savedFiles?.[id] ?? !OFF_BY_DEFAULT.has(id);
}

/** Purpose: the preferences with one kind of data in or out of saved files. */
export function withSaved(doc: PreferencesDoc, id: SavedDataId, on: boolean): PreferencesDoc {
  return { ...doc, savedFiles: { ...doc.savedFiles, [id]: on } };
}

/** Purpose: the options of a file download as the preferences choose them (the kinds a file holds today). */
export function saveOptions(doc: PreferencesDoc | null | undefined): {
  runs: boolean;
  map: boolean;
  results: boolean;
  vehicles: boolean;
  comments: boolean;
  history: boolean;
  /** The fetched and imported data, kind by kind. */
  fetched: Record<FetchedId, boolean>;
} {
  return {
    runs: savedIn(doc, "runs"),
    map: savedIn(doc, "viewerMap"),
    results: savedIn(doc, "processed"),
    vehicles: savedIn(doc, "vehicles"),
    comments: savedIn(doc, "comments"),
    history: savedIn(doc, "history"),
    fetched: Object.fromEntries(FETCHED_IDS.map((id) => [id, savedIn(doc, id)])) as Record<
      FetchedId,
      boolean
    >,
  };
}
