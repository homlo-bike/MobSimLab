/**
 * Names for stops and stations (06-gis §9.3, ADR-0029 point 3, ADR-0032).
 *
 * - Stops and stations within the grouping distance of each other are one stop or station for
 *   passengers: they share one name (rail-model groups stations by normalised name).
 * - A new stop or station near an existing one takes that one's name.
 * - A new stop or station with nothing nearby gets a name from the map around it, in this order
 *   (lower wins, then distance): 1 existing transport station · 2 landmark · 3 district ·
 *   4 facility · 5 street intersection · 6 major street · 7 street · 8 local place name.
 * - Names are unique otherwise: a name already used farther away gets its district or street as a
 *   qualifier, "Market (Old Town)", or else a number, "Market 2".
 */
import type { FeatureCategory, LonLat, NameFeature } from "./labels";

/** Stops and stations closer than this form one station group (06-gis §9.3 default, 150 m). */
export const STATION_GROUPING_M = 150;

/** Map features farther than this are not offered as names. */
export const SUGGESTION_RADIUS_M = 500;

export const CATEGORY_PRIORITY: Record<FeatureCategory | "intersection", number> = {
  transit_station: 1,
  landmark: 2,
  district: 3,
  facility: 4,
  intersection: 5,
  major_street: 6,
  street: 7,
  place: 8,
};

/** A named stop or station anywhere in the project. */
export interface NamedPlace {
  /** Unique across tools, e.g. `street:4` or `rail:12`. */
  id: string;
  name: string;
  lonlat: LonLat;
  /** Half the platform length (m) for stations: nearness is measured to the platform, not the centre. */
  halfLengthM?: number;
  /** Platform direction, degrees counter-clockwise from east. */
  rotationDeg?: number;
}

export interface NameSuggestion {
  name: string;
  /** What the name comes from, e.g. "landmark: Opera House". */
  source: string;
  distanceM: number;
  priority: number;
  /** District or street that tells it apart from another place of the same name. */
  qualifier?: string;
}

export interface NameChoice {
  name: string;
  /** joined: shares a nearby stop's name; suggested: from the map; fallback: nothing named nearby. */
  reason: "joined" | "suggested" | "fallback";
  /** The nearby stop or station it joined. */
  joined?: NamedPlace;
  source?: string;
}

/** Purpose: the key two names are compared by; case, accents and spacing are ignored (as rail-model). */
export function normaliseName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[\s\-._]+/)
    .filter(Boolean)
    .join(" ");
}

/** Purpose: metres east and north of `from` to `to` (equirectangular, fine within a few km). */
function offsetM(from: LonLat, to: LonLat): [number, number] {
  const k = Math.cos((from[1] * Math.PI) / 180);
  return [(to[0] - from[0]) * k * 111_320, (to[1] - from[1]) * 111_320];
}

export function distanceM(a: LonLat, b: LonLat): number {
  const [x, y] = offsetM(a, b);
  return Math.hypot(x, y);
}

/** Purpose: distance from a point to a place: to its platform line for a station, else its point. */
export function distanceToPlaceM(at: LonLat, p: NamedPlace): number {
  const [x, y] = offsetM(p.lonlat, at);
  const h = p.halfLengthM ?? 0;
  if (h <= 0) return Math.hypot(x, y);
  const r = ((p.rotationDeg ?? 0) * Math.PI) / 180;
  const along = Math.max(-h, Math.min(h, x * Math.cos(r) + y * Math.sin(r)));
  return Math.hypot(x - along * Math.cos(r), y - along * Math.sin(r));
}

function placeToPlaceM(a: NamedPlace, b: NamedPlace): number {
  return Math.min(distanceToPlaceM(a.lonlat, b), distanceToPlaceM(b.lonlat, a));
}

/** Purpose: the places within `radiusM` of `at`, nearest first. */
export function placesNear(at: LonLat, places: readonly NamedPlace[], radiusM: number): NamedPlace[] {
  return places
    .map((p) => ({ p, d: distanceToPlaceM(at, p) }))
    .filter((x) => x.d <= radiusM)
    .sort((a, b) => a.d - b.d)
    .map((x) => x.p);
}

/**
 * Purpose: the places that are one stop or station with `id`: everything reachable through
 * neighbours within `radiusM` (as the street-routing station groups). Includes the place itself.
 */
export function groupOf(id: string, places: readonly NamedPlace[], radiusM: number): NamedPlace[] {
  const start = places.find((p) => p.id === id);
  if (!start) return [];
  const group = [start];
  const left = places.filter((p) => p.id !== id);
  for (let i = 0; i < group.length; i++) {
    for (let j = left.length - 1; j >= 0; j--)
      if (placeToPlaceM(group[i]!, left[j]!) <= radiusM) group.push(...left.splice(j, 1));
  }
  return group;
}

/** Pick the localised name if there is one: name:<lang>, then name, then name:en. */
export function localName(f: NameFeature, language?: string): string | null {
  const n = (language && f.names[`name:${language}`]) || f.name || f.names["name:en"] || "";
  return n.trim() || null;
}

/** Purpose: name suggestions for `at` from map features, best first, without duplicates. */
export function suggestNames(
  at: LonLat,
  features: readonly NameFeature[],
  options: { language?: string; maxDistanceM?: number } = {},
): NameSuggestion[] {
  const max = options.maxDistanceM ?? SUGGESTION_RADIUS_M;
  const named = features
    .map((f) => ({ f, name: localName(f, options.language), d: distanceM(f.lonlat, at) }))
    .filter((x): x is { f: NameFeature; name: string; d: number } => !!x.name && Number.isFinite(x.d))
    .sort((a, b) => a.d - b.d);
  const district = named.find((x) => x.f.category === "district");
  const streets = named.filter((x) => x.f.category === "street" || x.f.category === "major_street");
  const candidates: NameSuggestion[] = [];
  for (const { f, name, d } of named) {
    if (d > max) continue;
    const q = f.category === "district" ? streets[0] : (district ?? streets.find((s) => s.name !== name));
    candidates.push({
      name,
      source: `${f.category.replace("_", " ")}: ${name}`,
      distanceM: Math.round(d),
      priority: CATEGORY_PRIORITY[f.category],
      ...(q && q.name !== name ? { qualifier: q.name } : {}),
    });
  }
  // Two different streets both close by: "A / B" (06-gis §9.3 rule 4).
  const [a, b] = [streets[0], streets.find((s) => s.name !== streets[0]?.name)];
  if (a && b && a.d <= 60 && b.d <= 60)
    candidates.push({
      name: `${a.name} / ${b.name}`,
      source: `intersection: ${a.name} and ${b.name}`,
      distanceM: Math.round(Math.max(a.d, b.d)),
      priority: CATEGORY_PRIORITY.intersection,
      ...(district ? { qualifier: district.name } : {}),
    });
  candidates.sort((x, y) => x.priority - y.priority || x.distanceM - y.distanceM);
  const seen = new Set<string>();
  return candidates.filter((c) => {
    const k = normaliseName(c.name);
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

/**
 * Purpose: `wanted` when no place outside `group` uses it, else with the qualifier, else numbered.
 * `group` holds the ids of the places that are allowed to share the name (the same stop or station).
 */
export function uniqueName(
  wanted: string,
  places: readonly NamedPlace[],
  group: ReadonlySet<string>,
  qualifier?: string,
): string {
  const used = new Set(places.filter((p) => !group.has(p.id)).map((p) => normaliseName(p.name)));
  const free = (n: string) => !used.has(normaliseName(n));
  if (free(wanted)) return wanted;
  if (qualifier && normaliseName(qualifier) !== normaliseName(wanted)) {
    const q = `${wanted} (${qualifier})`;
    if (free(q)) return q;
  }
  for (let i = 2; ; i++) if (free(`${wanted} ${i}`)) return `${wanted} ${i}`;
}

/**
 * Purpose: the name for a new stop or station at `at`.
 * - Within `radiusM` of an existing stop or station: its name (they are one stop or station).
 * - Otherwise the best map suggestion whose name no other place uses; if every suggestion is taken,
 *   the best one with a qualifier or number.
 * - Nothing named nearby: `fallback`, made unique.
 */
export function nameForNewPlace(
  at: LonLat,
  options: {
    places: readonly NamedPlace[];
    features: readonly NameFeature[];
    fallback: string;
    radiusM?: number;
    language?: string;
  },
): NameChoice {
  const radius = options.radiusM ?? STATION_GROUPING_M;
  const near = placesNear(at, options.places, radius)[0];
  if (near) return { name: near.name, reason: "joined", joined: near };
  const none = new Set<string>();
  const suggestions = suggestNames(at, options.features, { language: options.language });
  const free = suggestions.find((s) => uniqueName(s.name, options.places, none) === s.name);
  const best = free ?? suggestions[0];
  if (best)
    return {
      name: uniqueName(best.name, options.places, none, best.qualifier),
      reason: "suggested",
      source: best.source,
    };
  return { name: uniqueName(options.fallback, options.places, none), reason: "fallback" };
}

export interface Rename {
  /** The name to give every member of the group. */
  name: string;
  /** The ids of the group's places (all of them take the name). */
  members: string[];
  /** Set when the wanted name was already used farther away and had to be changed. */
  clash?: { wanted: string; with: NamedPlace; distanceM: number };
}

/**
 * Purpose: rename a stop or station. All places of its group take the new name; the name must not be
 * used by a place outside the group, so a clash gets a number.
 */
export function renamePlace(
  id: string,
  wanted: string,
  places: readonly NamedPlace[],
  radiusM = STATION_GROUPING_M,
): Rename {
  const group = groupOf(id, places, radiusM);
  const members = group.map((p) => p.id);
  const name = uniqueName(wanted.trim(), places, new Set(members));
  if (name === wanted.trim() || !group[0]) return { name, members };
  const other = places.find(
    (p) => !members.includes(p.id) && normaliseName(p.name) === normaliseName(wanted),
  )!;
  return {
    name,
    members,
    clash: { wanted: wanted.trim(), with: other, distanceM: Math.round(placeToPlaceM(group[0], other)) },
  };
}

/** Purpose: a short sentence for the planner about a chosen name. */
export function describeChoice(c: NameChoice, kind: "stop" | "station"): string {
  if (c.reason === "joined") return `Named “${c.name}”: it is one ${kind} with the ${kind} next to it.`;
  if (c.reason === "suggested") return `Named “${c.name}” after the nearby ${c.source}.`;
  return `Named “${c.name}”: nothing else is named nearby on the map. You can rename it.`;
}

/** Purpose: a short sentence for the planner about a rename that clashed. */
export function describeClash(r: Rename, radiusM = STATION_GROUPING_M): string | null {
  if (!r.clash) return null;
  const d = r.clash.distanceM;
  const away = d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${d} m`;
  return `“${r.clash.wanted}” is already the name of a stop or station ${away} away, so this one is called “${r.name}”. Only stops and stations within ${radiusM} m of each other share a name.`;
}
