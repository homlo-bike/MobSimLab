/**
 * The stops and stations of every tool, so a new stop in one tool can join a station drawn in
 * another (a bus stop beside a railway station is one interchange). Each tool publishes its own
 * places; the last list a tool published is kept while it is closed, like its drawing.
 */
import type { NamedPlace } from "./names";

const bySource = new Map<string, readonly NamedPlace[]>();

/** Purpose: replace the places a tool (`street`, `rail`) has. */
export function publishPlaces(source: string, places: readonly NamedPlace[]): void {
  bySource.set(source, places);
}

/** Purpose: the places of every tool except `source`. */
export function placesOtherThan(source: string): NamedPlace[] {
  return [...bySource].filter(([s]) => s !== source).flatMap(([, p]) => p);
}

/** Purpose: forget everything (tests). */
export function clearPlaces(): void {
  bySource.clear();
}
