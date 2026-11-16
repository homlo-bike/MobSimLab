/**
 * Destination categories of the 15-minute city preset (ADR-0035 §6, `accessibility_to_destinations`): the
 * daily needs of Moreno et al. (2021) as OpenStreetMap tags. The list is versioned like the KPI catalogue;
 * a change of tags is a new version, so results say which list they used.
 */

export const DESTINATION_LIST_VERSION = "2026-11-16";

export interface DestinationCategory {
  id: string;
  label: string;
  /** The OSM tags that make a place count, as written in the result. */
  osm: string;
}

export const DESTINATION_CATEGORIES: DestinationCategory[] = [
  {
    id: "food_shop",
    label: "Food shop",
    osm: "shop=supermarket|convenience|greengrocer|bakery|butcher|deli|grocery|farm; amenity=marketplace",
  },
  {
    id: "primary_school",
    label: "Primary school",
    osm: "amenity=school, unless school=secondary or isced:level is given without 1",
  },
  {
    id: "gp_clinic",
    label: "GP or clinic",
    osm: "amenity=doctors|clinic; healthcare=doctor|clinic|centre",
  },
  { id: "pharmacy", label: "Pharmacy", osm: "amenity=pharmacy; healthcare=pharmacy" },
  { id: "park", label: "Park", osm: "leisure=park (the centre of the area)" },
  {
    id: "workplace",
    label: "Workplace",
    osm: "office=*; craft=*; landuse=industrial|commercial (centre of the area); man_made=works",
  },
];

export type DestinationCategoryId = (typeof DESTINATION_CATEGORIES)[number]["id"];

const FOOD = new Set([
  "supermarket",
  "convenience",
  "greengrocer",
  "bakery",
  "butcher",
  "deli",
  "grocery",
  "farm",
]);

/** Purpose: the categories one OSM element counts for (a place can be in several, e.g. a shop in an office block). */
export function destinationCategories(t: Record<string, string>): string[] {
  const out: string[] = [];
  if (FOOD.has(t.shop ?? "") || t.amenity === "marketplace") out.push("food_shop");
  if (t.amenity === "school") {
    const isced = t["isced:level"];
    const secondaryOnly =
      t.school === "secondary" || (isced !== undefined && !isced.split(/[;,\s-]+/).includes("1"));
    if (!secondaryOnly) out.push("primary_school");
  }
  if (
    t.amenity === "doctors" ||
    t.amenity === "clinic" ||
    ["doctor", "clinic", "centre"].includes(t.healthcare ?? "")
  )
    out.push("gp_clinic");
  if (t.amenity === "pharmacy" || t.healthcare === "pharmacy") out.push("pharmacy");
  if (t.leisure === "park") out.push("park");
  if (
    t.office !== undefined ||
    t.craft !== undefined ||
    t.landuse === "industrial" ||
    t.landuse === "commercial" ||
    t.man_made === "works"
  )
    out.push("workplace");
  return out;
}

/** Purpose: Overpass QL filters (inside a union) for every element that can count for a category. */
export const DESTINATION_FILTERS = [
  `nwr["shop"~"^(${[...FOOD].join("|")})$"]`,
  `nwr["amenity"~"^(marketplace|school|doctors|clinic|pharmacy)$"]`,
  `nwr["healthcare"~"^(doctor|clinic|centre|pharmacy)$"]`,
  `nwr["leisure"="park"]`,
  `nwr["office"]`,
  `nwr["craft"]`,
  `wr["landuse"~"^(industrial|commercial)$"]`,
  `nwr["man_made"="works"]`,
];

/** One destination: where it is and which categories it counts for. */
export interface DestinationPoint {
  id: string;
  categories: string[];
  lonlat: [number, number];
  name?: string;
}
