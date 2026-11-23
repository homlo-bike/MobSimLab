import { type DataSource, ProjectDataCache } from "../projects/data-cache";
import { Injectable, Optional } from "@nestjs/common";
import { DESTINATION_FILTERS, type DestinationPoint, destinationCategories } from "../agents/destinations";
import { OverpassClient, OverpassError } from "../gateway/overpass.client";
import { GeodataReader } from "../geodata/geodata-reader";
import { type Bbox, waterQuery, waterShapes } from "./water";

/** Street tiles use this web-mercator zoom: about 2.4 km × 2.4 km at the equator, 1.5 km at 50° N. */
export const TILE_ZOOM = 14;
const CACHE_TILES = 256;

/** Road classes the street line router can use (see crates/street-routing `way_info`). */
const ROAD_CLASSES =
  "motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|" +
  "tertiary|tertiary_link|unclassified|residential|living_street|service|road|busway|bus_guideway|pedestrian";

/**
 * Road classes of a "Main roads and railways only" tile (large-area projects, step 3): motorways, trunk and
 * primary roads with their links, enough for intercity buses between the towns drawn at Full detail.
 */
export const MAIN_ROAD_CLASSES = "motorway|motorway_link|trunk|trunk_link|primary|primary_link";

/** An OSM XML answer with no elements, for the kinds a main-only tile does not hold (walkways). */
export const EMPTY_OSM_XML =
  '<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" generator="MobSimLab"></osm>\n';

/** Purpose: bounding box `[south, west, north, east]` of a web-mercator tile. */
export function tileBbox(z: number, x: number, y: number): [number, number, number, number] {
  const n = 2 ** z;
  const lon = (i: number) => (i / n) * 360 - 180;
  const lat = (j: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * j) / n))) * 180) / Math.PI;
  return [lat(y + 1), lon(x), lat(y), lon(x + 1)];
}

/**
 * Purpose: Overpass QL for the streets of one tile: road ways with all their nodes, and the
 * turn restrictions on them. Ways are returned whole, so neighbouring tiles join up.
 */
export function streetQuery(z: number, x: number, y: number, classes = ROAD_CLASSES): string {
  const b = tileBbox(z, x, y)
    .map((v) => v.toFixed(7))
    .join(",");
  return (
    `[out:xml][timeout:90][maxsize:67108864];` +
    `way["highway"~"^(${classes})$"](${b})->.w;` +
    `node(w.w)->.n;` +
    `rel(bw.w)["type"="restriction"]->.r;` +
    `(.n;.w;.r;);out body;`
  );
}

/** Ways people may walk along (see crates/street-routing `walk::walk_way`), for walk coverage (ADR-0035). */
const WALK_CLASSES =
  "footway|path|pedestrian|steps|living_street|residential|service|unclassified|tertiary|tertiary_link|" +
  "secondary|secondary_link|primary|primary_link|trunk|trunk_link|track|road|cycleway|bridleway|corridor|platform";

/**
 * Purpose: Overpass QL for the walkable ways of one tile with all their nodes (crossing and signal tags
 * included). Ways are returned whole, so neighbouring tiles join up.
 */
export function walkQuery(z: number, x: number, y: number): string {
  const b = tileBbox(z, x, y)
    .map((v) => v.toFixed(7))
    .join(",");
  return (
    `[out:xml][timeout:120][maxsize:134217728];` +
    `way["highway"~"^(${WALK_CLASSES})$"](${b})->.w;` +
    `node(w.w)->.n;` +
    `(.n;.w;);out body;`
  );
}

/** Railway kinds the railway design tool shows as existing infrastructure (crates/rail-design `existing`). */
const RAIL_KINDS =
  "rail|light_rail|tram|subway|narrow_gauge|monorail|funicular|construction|disused|preserved";

/**
 * Purpose: Overpass QL for the railway tracks of one tile with all their nodes (switches, buffer stops,
 * level crossings and signals carry tags). Ways are returned whole, so neighbouring tiles join up.
 */
export function railQuery(z: number, x: number, y: number): string {
  const b = tileBbox(z, x, y)
    .map((v) => v.toFixed(7))
    .join(",");
  return (
    `[out:xml][timeout:90][maxsize:67108864];` +
    `way["railway"~"^(${RAIL_KINDS})$"](${b})->.w;` +
    `node(w.w)->.n;` +
    `(.n;.w;);out body;`
  );
}

/**
 * Purpose: Overpass QL for the buildings of one tile (ways and multipolygons tagged `building`, not
 * `building=no`), as JSON with tags and geometry, for the noise map (ADR-0038 step N2).
 */
export function buildingQuery(z: number, x: number, y: number): string {
  const b = tileBbox(z, x, y)
    .map((v) => v.toFixed(7))
    .join(",");
  return (
    `[out:json][timeout:120][maxsize:67108864];` +
    `(way["building"]["building"!="no"](${b});` +
    `rel["building"]["building"!="no"]["type"="multipolygon"](${b}););` +
    `out tags geom;`
  );
}

/**
 * One building as the noise map and the benefit tables take it: outer ring `[lon, lat]`, what OSM says of
 * its height, whether it holds homes (`homes`), and what it is used for (`use`: the `building` value, or
 * `shop`, `office` or `amenity:<value>` when the building is only tagged `building=yes` with one of those).
 */
export interface BuildingFootprint {
  id: string;
  ring: [number, number][];
  height_m?: number;
  levels?: number;
  use?: string;
  /** True when tagged as housing, false when tagged as another use, absent when not said (`building=yes`). */
  homes?: boolean;
}

/** Purpose: what a building is used for, from its OSM tags (see `BuildingFootprint.use`). */
export function buildingUse(t: Record<string, string>): string {
  const b = (t.building ?? "yes").toLowerCase();
  if (b !== "yes") return b;
  if (t.shop) return "shop";
  if (t.office) return "office";
  if (t.amenity) return `amenity:${t.amenity.toLowerCase()}`;
  return "yes";
}

/** `building=*` values that are housing (OSM wiki, Key:building, "Accommodation"). */
const HOME_BUILDINGS = new Set([
  "apartments",
  "bungalow",
  "cabin",
  "detached",
  "dormitory",
  "farm",
  "ger",
  "house",
  "houseboat",
  "residential",
  "semidetached_house",
  "static_caravan",
  "stilt_house",
  "terrace",
  "tree_house",
  "trullo",
]);

/**
 * Purpose: whether a building holds homes, from its `building` value: true for housing, false
 * for any other named use (shop, office, garage, church…), undefined for `yes` and unknown values
 * used only as building parts or construction states.
 */
export function buildingHomes(tags: Record<string, string>): boolean | undefined {
  const v = (tags.building ?? "").trim().toLowerCase();
  if (HOME_BUILDINGS.has(v)) return true;
  if (v === "" || v === "yes" || v === "construction" || v === "no") return undefined;
  return false;
}

interface OverpassElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: ({ lat: number; lon: number } | null)[];
  members?: { type: string; role: string; geometry?: ({ lat: number; lon: number } | null)[] }[];
}

/** Purpose: a number from an OSM value such as "12", "12.5 m" or "3;4" (the first); undefined otherwise. */
export function osmNumber(v: string | undefined): number | undefined {
  const m = v?.trim().match(/^(\d+(?:[.,]\d+)?)\s*(m|metres?|meters?)?(?:\s*;.*)?$/i);
  if (!m) return undefined;
  const n = Number(m[1]!.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Purpose: the footprints in an Overpass JSON answer. Ways give one ring; multipolygons give each
 * closed outer member. Unclosed rings and underground buildings are left out.
 */
export function footprints(json: string): BuildingFootprint[] {
  const els = (JSON.parse(json) as { elements?: OverpassElement[] }).elements ?? [];
  const r7 = (v: number) => Math.round(v * 1e7) / 1e7;
  const ring = (g: OverpassElement["geometry"]): [number, number][] | null => {
    if (!g || g.length < 4 || g.some((p) => !p)) return null;
    const pts = (g as { lat: number; lon: number }[]).map((p) => [r7(p.lon), r7(p.lat)] as [number, number]);
    const [a, b] = [pts[0]!, pts[pts.length - 1]!];
    return a[0] === b[0] && a[1] === b[1] ? pts : null;
  };
  const out: BuildingFootprint[] = [];
  for (const e of els) {
    const t = e.tags ?? {};
    if (t.location === "underground" || Number(t.layer) < 0) continue;
    const height = {
      height_m: osmNumber(t.height),
      levels: osmNumber(t["building:levels"]),
      use: buildingUse(t),
      homes: buildingHomes(t),
    };
    const rings =
      e.type === "way"
        ? [ring(e.geometry)]
        : (e.members ?? [])
            .filter((m) => m.type === "way" && m.role === "outer")
            .map((m) => ring(m.geometry));
    rings.forEach((r, i) => {
      if (r) out.push({ id: `${e.type[0]}${e.id}${i ? `-${i}` : ""}`, ring: r, ...clean(height) });
    });
  }
  return out;
}

/** Kinds of place the benefit tables count: schools, universities and colleges, hospitals and clinics. */
export type PlaceKind = "school" | "university" | "hospital" | "clinic";

/** One school, university, hospital or clinic: a point (the centre of an area) and its name. */
export interface PlacePoint {
  id: string;
  kind: PlaceKind;
  lonlat: [number, number];
  name?: string;
}

const PLACE_AMENITY = "school|kindergarten|college|university|hospital|clinic|doctors";
const PLACE_HEALTHCARE = "hospital|clinic|centre|doctor";

/**
 * Purpose: Overpass QL for the schools, universities, hospitals and clinics of one tile (nodes, ways and
 * relations, with their centre), for the benefit tables (ADR-0040).
 */
export function placeQuery(z: number, x: number, y: number): string {
  const b = tileBbox(z, x, y)
    .map((v) => v.toFixed(7))
    .join(",");
  return (
    `[out:json][timeout:90][maxsize:33554432];` +
    `(nwr["amenity"~"^(${PLACE_AMENITY})$"](${b});` +
    `nwr["healthcare"~"^(${PLACE_HEALTHCARE})$"](${b}););` +
    `out tags center;`
  );
}

/** Purpose: the kind of place from OSM tags, or null when it is none of the counted kinds. */
export function placeKind(t: Record<string, string>): PlaceKind | null {
  const a = t.amenity;
  const h = t.healthcare;
  if (a === "school" || a === "kindergarten") return "school";
  if (a === "college" || a === "university") return "university";
  if (a === "hospital" || h === "hospital") return "hospital";
  if (a === "clinic" || a === "doctors" || h === "clinic" || h === "centre" || h === "doctor")
    return "clinic";
  return null;
}

/** Purpose: the places in an Overpass JSON answer (`out tags center`). */
export function places(json: string): PlacePoint[] {
  const els =
    (
      JSON.parse(json) as {
        elements?: (OverpassElement & {
          lat?: number;
          lon?: number;
          center?: { lat: number; lon: number };
        })[];
      }
    ).elements ?? [];
  const r7 = (v: number) => Math.round(v * 1e7) / 1e7;
  const out: PlacePoint[] = [];
  for (const e of els) {
    const kind = placeKind(e.tags ?? {});
    const at = e.center ?? (e.lat !== undefined && e.lon !== undefined ? { lat: e.lat, lon: e.lon } : null);
    if (!kind || !at) continue;
    const name = e.tags?.name;
    out.push({
      id: `${e.type[0]}${e.id}`,
      kind,
      lonlat: [r7(at.lon), r7(at.lat)],
      ...(name ? { name } : {}),
    });
  }
  return out;
}

/** A charging point or a secure bike parking for the cargo bike plugin. */
export type BikeAmenityKind = "charging" | "secure_parking" | "cargo_parking";

export interface BikeAmenity {
  id: string;
  kind: BikeAmenityKind;
  lonlat: [number, number];
  name?: string;
  /** OSM `opening_hours`, `fee` and `capacity`, when tagged. */
  hours?: string;
  fee?: string;
  capacity?: string;
}

/**
 * Purpose: Overpass QL for the bicycle charging points and the bike parkings of one tile that are secure
 * (lockers, sheds, bike stations, supervised) or take cargo bikes, with their centre.
 */
export function bikeAmenityQuery(z: number, x: number, y: number): string {
  const b = tileBbox(z, x, y)
    .map((v) => v.toFixed(7))
    .join(",");
  return (
    `[out:json][timeout:90][maxsize:33554432];` +
    `(nwr["amenity"="charging_station"]["bicycle"~"^(yes|designated)$"](${b});` +
    `nwr["amenity"="bicycle_parking"]["bicycle_parking"~"^(lockers|shed|building)$"](${b});` +
    `nwr["amenity"="bicycle_parking"]["supervised"="yes"](${b});` +
    `nwr["amenity"="bicycle_parking"]["cargo_bike"~"^(yes|designated)$"](${b});` +
    `nwr["amenity"="bicycle_parking"]["capacity:cargo_bike"](${b}););` +
    `out tags center;`
  );
}

/** Purpose: what a charging point or bike parking offers a cargo bike, or null when it is none of them. */
export function bikeAmenityKind(t: Record<string, string>): BikeAmenityKind | null {
  if (t.amenity === "charging_station")
    return t.bicycle === "yes" || t.bicycle === "designated" ? "charging" : null;
  if (t.amenity !== "bicycle_parking") return null;
  const cargoCapacity = Number(t["capacity:cargo_bike"] ?? 0);
  if (t.cargo_bike === "yes" || t.cargo_bike === "designated" || cargoCapacity > 0) return "cargo_parking";
  if (["lockers", "shed", "building"].includes(t.bicycle_parking ?? "") || t.supervised === "yes")
    return "secure_parking";
  return null;
}

/** Purpose: the charging points and bike parkings in an Overpass JSON answer (`out tags center`). */
export function bikeAmenities(json: string): BikeAmenity[] {
  const els =
    (
      JSON.parse(json) as {
        elements?: (OverpassElement & {
          lat?: number;
          lon?: number;
          center?: { lat: number; lon: number };
        })[];
      }
    ).elements ?? [];
  const r7 = (v: number) => Math.round(v * 1e7) / 1e7;
  const out: BikeAmenity[] = [];
  for (const e of els) {
    const t = e.tags ?? {};
    const kind = bikeAmenityKind(t);
    const at = e.center ?? (e.lat !== undefined && e.lon !== undefined ? { lat: e.lat, lon: e.lon } : null);
    if (!kind || !at) continue;
    out.push({
      id: `${e.type[0]}${e.id}`,
      kind,
      lonlat: [r7(at.lon), r7(at.lat)],
      ...clean({
        name: t.name || t.operator || undefined,
        hours: t.opening_hours,
        fee: t.fee,
        capacity: t["capacity:cargo_bike"] ?? t.capacity,
      }),
    });
  }
  return out;
}

/**
 * Purpose: Overpass QL for every bike parking and shared-bike station of one tile, with their centre, for the
 * demand model's bike and ride and shared bikes (ADR-0019).
 */
export function bikeAccessQuery(z: number, x: number, y: number): string {
  const b = tileBbox(z, x, y)
    .map((v) => v.toFixed(7))
    .join(",");
  return (
    `[out:json][timeout:90][maxsize:33554432];` +
    `(nwr["amenity"="bicycle_parking"](${b});nwr["amenity"="bicycle_rental"](${b}););` +
    `out tags center;`
  );
}

/** Bike parkings and shared-bike stations as `[lon, lat]`. */
export interface BikeAccess {
  parking: [number, number][];
  rental: [number, number][];
}

/**
 * Purpose: the bike parkings (`amenity=bicycle_parking`, not private) and shared-bike stations
 * (`amenity=bicycle_rental`, not a shop that hires bikes out) in an Overpass JSON answer (`out tags center`).
 */
export function bikeAccess(json: string): BikeAccess {
  const els =
    (
      JSON.parse(json) as {
        elements?: (OverpassElement & {
          lat?: number;
          lon?: number;
          center?: { lat: number; lon: number };
        })[];
      }
    ).elements ?? [];
  const r7 = (v: number) => Math.round(v * 1e7) / 1e7;
  const out: BikeAccess = { parking: [], rental: [] };
  for (const e of els) {
    const t = e.tags ?? {};
    const at = e.center ?? (e.lat !== undefined && e.lon !== undefined ? { lat: e.lat, lon: e.lon } : null);
    if (!at || ["private", "no", "customers"].includes(t.access ?? "")) continue;
    const p: [number, number] = [r7(at.lon), r7(at.lat)];
    if (t.amenity === "bicycle_parking") out.parking.push(p);
    else if (t.amenity === "bicycle_rental" && t.bicycle_rental !== "shop") out.rental.push(p);
  }
  return out;
}

/**
 * Purpose: Overpass QL for the daily-needs destinations of one tile (shops, schools, doctors, pharmacies, parks,
 * workplaces; nodes, ways and relations with their centre), for the 15-minute city preset (ADR-0035 §6).
 */
export function destinationQuery(z: number, x: number, y: number): string {
  const b = tileBbox(z, x, y)
    .map((v) => v.toFixed(7))
    .join(",");
  return (
    `[out:json][timeout:90][maxsize:33554432];(` +
    DESTINATION_FILTERS.map((f) => `${f}(${b});`).join("") +
    `);out tags center;`
  );
}

/** Purpose: the destinations in an Overpass JSON answer (`out tags center`), each with its categories. */
export function destinations(json: string): DestinationPoint[] {
  const els =
    (
      JSON.parse(json) as {
        elements?: (OverpassElement & {
          lat?: number;
          lon?: number;
          center?: { lat: number; lon: number };
        })[];
      }
    ).elements ?? [];
  const r7 = (v: number) => Math.round(v * 1e7) / 1e7;
  const out: DestinationPoint[] = [];
  for (const e of els) {
    const categories = destinationCategories(e.tags ?? {});
    const at = e.center ?? (e.lat !== undefined && e.lon !== undefined ? { lat: e.lat, lon: e.lon } : null);
    if (!categories.length || !at) continue;
    const name = e.tags?.name;
    out.push({
      id: `${e.type[0]}${e.id}`,
      categories,
      lonlat: [r7(at.lon), r7(at.lat)],
      ...(name ? { name } : {}),
    });
  }
  return out;
}

function clean<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Purpose: the zoom-14 tiles `[x, y]` covering a bounding box `[west, south, east, north]`. */
export function tilesFor(bbox: [number, number, number, number], z = TILE_ZOOM): [number, number][] {
  const n = 2 ** z;
  const tx = (lon: number) => Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
  const ty = (lat: number) => {
    const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
    return Math.min(n - 1, Math.max(0, Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * n)));
  };
  const out: [number, number][] = [];
  for (let x = tx(bbox[0]); x <= tx(bbox[2]); x++)
    for (let y = ty(bbox[3]); y <= ty(bbox[1]); y++) out.push([x, y]);
  return out;
}

/** Purpose: a tile's box as `[west, south, east, north]`. */
function tileBox(x: number, y: number): [number, number, number, number] {
  const [s, w, n, e] = tileBbox(TILE_ZOOM, x, y);
  return [w, s, e, n];
}

/**
 * Streets, railways, buildings, places and water for the editors and tables. When a request names a project
 * whose OpenStreetMap import holds the tile (06-gis §2, ADR-0046), the answer comes from the import; otherwise it
 * is fetched tile by tile from OSM through the gateway's Overpass client. Both are cached in memory.
 * Data © OpenStreetMap contributors, ODbL.
 */
@Injectable()
export class StreetNetworkService {
  private readonly cache = new Map<string, string>();
  private readonly pending = new Map<string, Promise<string>>();
  /** Project keys in `cache` that came from the project's data cache (fetched live before), not its import. */
  private readonly fromCache = new Set<string>();

  constructor(
    private readonly overpass: OverpassClient,
    @Optional() private readonly imported?: GeodataReader,
    @Optional() private readonly kept?: ProjectDataCache,
  ) {
    imported?.onChange((projectId) => this.forgetProject(projectId));
  }

  /**
   * Purpose: OSM XML for the streets of tile x/y at TILE_ZOOM; with `main`, only the main roads
   * (`MAIN_ROAD_CLASSES`), for a tile of a project held at "Main roads and railways only". Side effects: may call
   * Overpass.
   */
  tile(
    x: number,
    y: number,
    projectId?: string,
    source?: (s: DataSource) => void,
    main = false,
  ): Promise<string> {
    if (main)
      return this.cached(
        `roadmain/${x}/${y}`,
        () => streetQuery(TILE_ZOOM, x, y, MAIN_ROAD_CLASSES),
        undefined,
        projectId && (() => this.imported!.tileXml(projectId, "roadMain", tileBox(x, y))),
        projectId,
        source,
      );
    return this.cached(
      `road/${x}/${y}`,
      () => streetQuery(TILE_ZOOM, x, y),
      undefined,
      projectId && (() => this.imported!.tileXml(projectId, "road", tileBox(x, y))),
      projectId,
      source,
    );
  }

  /** Purpose: OSM XML for the railway tracks of tile x/y at TILE_ZOOM. Side effects: may call Overpass. */
  railTile(x: number, y: number, projectId?: string, source?: (s: DataSource) => void): Promise<string> {
    return this.cached(
      `rail/${x}/${y}`,
      () => railQuery(TILE_ZOOM, x, y),
      undefined,
      projectId && (() => this.imported!.tileXml(projectId, "rail", tileBox(x, y))),
      projectId,
      source,
    );
  }

  /** Purpose: OSM XML for the walkable ways of tile x/y at TILE_ZOOM. Side effects: may call Overpass. */
  walkTile(x: number, y: number, projectId?: string, source?: (s: DataSource) => void): Promise<string> {
    return this.cached(
      `walk/${x}/${y}`,
      () => walkQuery(TILE_ZOOM, x, y),
      undefined,
      projectId && (() => this.imported!.tileXml(projectId, "walk", tileBox(x, y))),
      projectId,
      source,
    );
  }

  /**
   * Purpose: the building footprints of tile x/y at TILE_ZOOM as JSON `{buildings: BuildingFootprint[]}`.
   * Side effects: may call Overpass.
   */
  buildingTile(x: number, y: number, projectId?: string, source?: (s: DataSource) => void): Promise<string> {
    return this.cached(
      `building/${x}/${y}`,
      () => buildingQuery(TILE_ZOOM, x, y),
      (json) => JSON.stringify({ buildings: footprints(json) }),
      projectId && (() => this.imported!.buildings(projectId, tileBox(x, y))),
      projectId,
      source,
    );
  }

  /**
   * Purpose: the schools, universities, hospitals and clinics of tile x/y at TILE_ZOOM as JSON
   * `{places: PlacePoint[]}`. Side effects: may call Overpass.
   */
  placeTile(x: number, y: number, projectId?: string, source?: (s: DataSource) => void): Promise<string> {
    return this.cached(
      `place/${x}/${y}`,
      () => placeQuery(TILE_ZOOM, x, y),
      (json) => JSON.stringify({ places: places(json) }),
      projectId && (() => this.imported!.places(projectId, tileBox(x, y))),
      projectId,
      source,
    );
  }

  /**
   * Purpose: sea, lakes and rivers inside a box as JSON `WaterShapes` (water.ts), for the Schematic tab.
   * Inputs: `[west, south, east, north]`, already checked and rounded by the controller.
   * Side effects: may call Overpass.
   */
  water(b: Bbox, projectId?: string, source?: (s: DataSource) => void): Promise<string> {
    return this.cached(
      `water/${b.join(",")}`,
      () => waterQuery(b),
      (json) => JSON.stringify(waterShapes(json, b)),
      projectId && (() => this.imported!.water(projectId, b)),
      projectId,
      source,
    );
  }

  /**
   * Purpose: the bicycle charging points and secure or cargo bike parkings of tile x/y at TILE_ZOOM as
   * JSON `{amenities: BikeAmenity[]}`, for the cargo bike plugin. Side effects: may call Overpass.
   */
  bikeAmenityTile(x: number, y: number): Promise<string> {
    return this.cached(
      `bike-amenity/${x}/${y}`,
      () => bikeAmenityQuery(TILE_ZOOM, x, y),
      (json) => JSON.stringify({ amenities: bikeAmenities(json) }),
    );
  }

  /**
   * Purpose: the bike parkings and shared-bike stations of tile x/y at TILE_ZOOM as JSON `BikeAccess`, for the
   * demand model. Side effects: may call Overpass.
   */
  bikeAccessTile(x: number, y: number): Promise<string> {
    return this.cached(
      `bike-access/${x}/${y}`,
      () => bikeAccessQuery(TILE_ZOOM, x, y),
      (json) => JSON.stringify(bikeAccess(json)),
    );
  }

  /**
   * Purpose: the daily-needs destinations of tile x/y at TILE_ZOOM as JSON `{destinations: DestinationPoint[]}`.
   * Side effects: may call Overpass.
   */
  destinationTile(x: number, y: number): Promise<string> {
    return this.cached(
      `destination/${x}/${y}`,
      () => destinationQuery(TILE_ZOOM, x, y),
      (json) => JSON.stringify({ destinations: destinations(json) }),
    );
  }

  /** Purpose: forget what was cached from a project's import (called when the import changes). */
  forgetProject(projectId: string): void {
    for (const k of [...this.cache.keys()])
      if (k.startsWith(`${projectId}:`)) {
        this.cache.delete(k);
        this.fromCache.delete(k);
      }
  }

  /**
   * Purpose: a cached answer; from the project's import when `fromImport` gives one, else from Overpass.
   * Imported answers are cached under the project, so another project's import or Overpass never mixes in.
   */
  private async cached(
    liveKey: string,
    query: () => string,
    convert: (body: string) => string = (b) => b,
    fromImport?: (() => Promise<string | null>) | "" | undefined,
    projectId?: string,
    source?: (s: DataSource) => void,
  ): Promise<string> {
    const projectKey = projectId ? `${projectId}:${liveKey}` : null;
    if (fromImport && projectId && projectKey) {
      const hit = this.cache.get(projectKey);
      if (hit !== undefined) {
        source?.(this.fromCache.has(projectKey) ? "cache" : "import");
        return hit;
      }
      const body = await fromImport();
      if (body !== null) {
        const out = convert(body);
        this.remember(projectKey, out);
        source?.("import");
        return out;
      }
      // Outside the import: what was fetched live for the project before (#140 step 4).
      const kept = await this.kept?.get(projectId, "osm", liveKey);
      if (kept != null) {
        this.remember(projectKey, kept);
        this.fromCache.add(projectKey);
        source?.("cache");
        return kept;
      }
    }
    const key = liveKey;
    const hit = this.cache.get(key);
    if (hit !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      if (fromImport && projectId && projectKey) {
        await this.kept?.put(projectId, "osm", liveKey, hit);
        this.fromCache.add(projectKey);
      }
      source?.("live");
      return hit;
    }
    let p = this.pending.get(key);
    if (!p) {
      p = this.overpass
        .run(query())
        .then(convert)
        .finally(() => this.pending.delete(key));
      this.pending.set(key, p);
    }
    let xml: string;
    try {
      xml = await p;
    } catch (e) {
      // With an import, the place asked for lies outside it: importing again is not the advice to give.
      if (e instanceof OverpassError && fromImport && projectId && (await this.imported?.hasOsm(projectId)))
        throw new OverpassError(
          "This place is outside the project's imported OpenStreetMap area, and OpenStreetMap's Overpass " +
            "service is busy or cannot be reached for it. Try again in a few minutes, or import a larger area " +
            "(Map data).",
          e.status,
        );
      throw e;
    }
    this.remember(key, xml);
    if (fromImport && projectId && projectKey) {
      // Kept for the project, so every tool reads it from there next time.
      await this.kept?.put(projectId, "osm", liveKey, xml);
      this.remember(projectKey, xml);
      this.fromCache.add(projectKey);
    }
    source?.("live");
    return xml;
  }

  private remember(key: string, value: string): void {
    this.cache.set(key, value);
    while (this.cache.size > CACHE_TILES) {
      const old = this.cache.keys().next().value as string;
      this.cache.delete(old);
      this.fromCache.delete(old);
    }
  }
}
