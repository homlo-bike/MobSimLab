/**
 * Which project's imported OpenStreetMap and elevation data the map tools read (ADR-0046). The open project
 * sets it; the street, railway, building, place and water requests then carry `project=<id>`, and the API answers
 * from the project's import where it covers the request (else live from OpenStreetMap). The OSM import's ID is
 * part of the URL too, so the browser's cached tiles are not reused after a new import.
 */

let project: string | null = null;
let osmImport: string | null = null;

/** Purpose: set (or clear, with null) the open project and its current OpenStreetMap import. */
export function setDataProject(id: string | null, importId: string | null = null): void {
  if (id !== project) live = { tiles: 0, heights: 0 };
  project = id;
  osmImport = id ? importId : null;
  emit();
}

/** Purpose: the open project, for requests that send it in the body (terrain). */
export function dataProject(): string | null {
  return project;
}

/** Purpose: a map data URL with the open project (and its import) added; unchanged when no project is open. */
export function withProject(url: string): string {
  if (!project) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}project=${encodeURIComponent(project)}${osmImport ? `&osm=${encodeURIComponent(osmImport)}` : ""}`;
}

/**
 * Purpose: a location fact URL (country, holidays, climate) with the open project added, so the API keeps the
 * answer for the project and serves it from there next time (#140 step 3); unchanged when no project is open.
 */
export function withProjectFacts(url: string): string {
  if (!project) return url;
  return `${url}${url.includes("?") ? "&" : "?"}project=${encodeURIComponent(project)}`;
}

/** What the open project's tools read live, outside its imported data (#140 step 5). */
export interface LiveData {
  /** Map tiles (streets, railways, buildings, water) OpenStreetMap answered live. */
  tiles: number;
  /** Terrain heights read live. */
  heights: number;
}

let live: LiveData = { tiles: 0, heights: 0 };
const listeners = new Set<(l: LiveData) => void>();
const emit = () => listeners.forEach((f) => f(live));

/**
 * Purpose: note where a map data answer came from (the API's `X-MSL-Data-Source`: import, cache or live), so the
 * workspace can say when tools read data live outside the project's imports. Side effects: tells the listeners.
 */
export function noteSource(res: Response): void {
  if (!project || res.headers?.get?.("X-MSL-Data-Source") !== "live") return;
  live = { ...live, tiles: live.tiles + 1 };
  emit();
}

/** Purpose: note terrain heights read live outside the project's elevation import. */
export function noteLiveHeights(n: number): void {
  if (!project || !(n > 0)) return;
  live = { ...live, heights: live.heights + n };
  emit();
}

/** Purpose: what the open project's tools have read live so far; `f` is told of every change. */
export function watchLiveData(f: (l: LiveData) => void): () => void {
  listeners.add(f);
  f(live);
  return () => listeners.delete(f);
}
