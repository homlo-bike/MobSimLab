import type { FeatureCollection, Network, RailView, StorageRole, Track, Yard } from "./types";

/**
 * Purpose: what trains stand on a storage track for: the role the planner set, else overnight for a
 * track in a stabling yard, else `null` (not set; the timetable planner infers it).
 */
export function storageRole(t: Track, yards: readonly Yard[] = []): StorageRole | null {
  if (t.use !== "storage") return null;
  if (t.storage_role) return t.storage_role;
  return yards.some((y) => y.tracks.includes(t.id)) ? "overnight" : null;
}

/** Purpose: how many of the line's longest trains fit on a storage track (all its lines together). */
export function trainsThatFit(length_m: number, tracks: number, train_length_m: number): number {
  if (!(train_length_m > 0)) return 0;
  return Math.floor(length_m / train_length_m) * tracks;
}

/**
 * Purpose: a label point at the middle of every storage track with its role and how many trains fit,
 * for the map. `label` turns a role (or `null`) and the train count into the text shown.
 */
export function storageLabels(
  doc: Network,
  view: RailView,
  label: (role: StorageRole | null, trains: number) => string,
): FeatureCollection {
  const features = [];
  for (const t of doc.tracks) {
    if (t.use !== "storage") continue;
    const tv = view.tracks.find((x) => x.id === t.id);
    if (!tv || tv.centre.length < 2) continue;
    const role = storageRole(t, doc.yards);
    const trains = trainsThatFit(tv.length_m, tv.tracks, view.train_length_m);
    features.push({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: middle(tv.centre) },
      properties: { ref: t.id, role: role ?? "", label: label(role, trains) },
    });
  }
  return { type: "FeatureCollection", features } as FeatureCollection;
}

/** The point halfway along a line (by plain coordinate distance, enough for a label). */
function middle(line: [number, number][]): [number, number] {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += dist(line[i - 1]!, line[i]!);
  let rest = total / 2;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const d = dist(a, b);
    if (d > 0 && rest <= d) {
      const f = rest / d;
      return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])];
    }
    rest -= d;
  }
  return line[line.length - 1]!;
}

const dist = (a: [number, number], b: [number, number]) => Math.hypot(b[0] - a[0], b[1] - a[1]);
