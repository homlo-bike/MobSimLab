/**
 * Which project's imported OpenStreetMap and elevation data the map tools read (ADR-0045). The open project
 * sets it; the street, railway, building, place and water requests then carry `project=<id>`, and the API answers
 * from the project's import where it covers the request (else live from OpenStreetMap). The OSM import's ID is
 * part of the URL too, so the browser's cached tiles are not reused after a new import.
 */

let project: string | null = null;
let osmImport: string | null = null;

/** Purpose: set (or clear, with null) the open project and its current OpenStreetMap import. */
export function setDataProject(id: string | null, importId: string | null = null): void {
  project = id;
  osmImport = id ? importId : null;
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
