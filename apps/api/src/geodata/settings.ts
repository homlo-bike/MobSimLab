import { join } from "node:path";
import { z } from "zod";

/**
 * Settings of the OpenStreetMap and elevation import (06-gis §2 and §4), from the environment. Each has a
 * default that suits a small server; operators change them in `.env`. The project area's buffer is a project
 * setting (`project.area_buffer_km`), and the import dialog chooses the method, the Geofabrik region and
 * whether planned roads are kept.
 */
export interface GeodataSettings {
  /** Where downloads, uploads, the Overpass cache and each project's OSM extract are kept. */
  dataDir: string;
  overpass: {
    /** Areas up to this size use Overpass when the method is "auto"; larger ones need a PBF extract. */
    maxAreaKm2: number;
    /** Side of the tiles an area is split into before querying. Tiles that time out are split again. */
    tileKm: number;
    /** Smallest tile side a split goes down to before the import gives up. */
    minTileKm: number;
    /** Seconds between two Overpass requests of an import (06-gis §2.3: 1 request every 5 s). */
    intervalS: number;
    /** Overpass `[timeout:N]` per query, seconds; the HTTP timeout is 30 s longer. */
    queryTimeoutS: number;
    /** Largest answer per tile, MB. */
    maxResponseMb: number;
    /** How long cached answers are reused, days (06-gis §2.3: 7). */
    cacheDays: number;
  };
  /** Largest project area an OpenStreetMap import accepts, km². */
  maxAreaKm2: number;
  /** Largest `.osm.pbf` file, uploaded or downloaded from Geofabrik, MB. */
  maxPbfMb: number;
  /** Geofabrik download server (https). */
  geofabrikUrl: string;
  /** How long a downloaded Geofabrik extract is reused before it is fetched again, days. */
  geofabrikCacheDays: number;
  dem: {
    /** Largest project area an elevation import accepts, km². */
    maxAreaKm2: number;
    /** Largest uploaded elevation GeoTIFF, MB. */
    maxUploadMb: number;
  };
  /** Longest a single osmium or osm2pgsql run may take, minutes. */
  toolTimeoutMin: number;
}

const num = (min: number, max: number, dflt: number) =>
  z.preprocess(
    (v) => (v === undefined || v === "" ? undefined : v),
    z.coerce.number().min(min).max(max).default(dflt),
  );

const schema = z.object({
  MOBSIMLAB_DATA_DIR: z.string().min(1).default("/data"),
  MOBSIMLAB_OSM_OVERPASS_MAX_KM2: num(1, 100_000, 400),
  MOBSIMLAB_OSM_OVERPASS_TILE_KM: num(0.5, 50, 3),
  MOBSIMLAB_OSM_OVERPASS_MIN_TILE_KM: num(0.1, 10, 0.5),
  MOBSIMLAB_OSM_OVERPASS_INTERVAL_S: num(0, 600, 5),
  MOBSIMLAB_OSM_OVERPASS_TIMEOUT_S: num(10, 3_600, 180),
  MOBSIMLAB_OSM_OVERPASS_MAX_MB: num(1, 4_096, 256),
  MOBSIMLAB_OSM_CACHE_DAYS: num(0, 365, 7),
  MOBSIMLAB_OSM_MAX_AREA_KM2: num(1, 1_000_000, 20_000),
  MOBSIMLAB_OSM_PBF_MAX_MB: num(1, 200_000, 4_000),
  MOBSIMLAB_GEOFABRIK_URL: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.url({ protocol: /^https$/ }).default("https://download.geofabrik.de"),
  ),
  MOBSIMLAB_GEOFABRIK_CACHE_DAYS: num(0, 365, 7),
  MOBSIMLAB_DEM_MAX_AREA_KM2: num(1, 1_000_000, 20_000),
  MOBSIMLAB_DEM_UPLOAD_MAX_MB: num(1, 50_000, 500),
  MOBSIMLAB_OSM_TOOL_TIMEOUT_MIN: num(1, 24 * 60, 120),
});

/** Purpose: read the settings; throws a ZodError naming the variable when one is out of range. */
export function geodataSettings(env: NodeJS.ProcessEnv = process.env): GeodataSettings {
  const e = schema.parse(env);
  return {
    dataDir: e.MOBSIMLAB_DATA_DIR,
    overpass: {
      maxAreaKm2: e.MOBSIMLAB_OSM_OVERPASS_MAX_KM2,
      tileKm: e.MOBSIMLAB_OSM_OVERPASS_TILE_KM,
      minTileKm: e.MOBSIMLAB_OSM_OVERPASS_MIN_TILE_KM,
      intervalS: e.MOBSIMLAB_OSM_OVERPASS_INTERVAL_S,
      queryTimeoutS: e.MOBSIMLAB_OSM_OVERPASS_TIMEOUT_S,
      maxResponseMb: e.MOBSIMLAB_OSM_OVERPASS_MAX_MB,
      cacheDays: e.MOBSIMLAB_OSM_CACHE_DAYS,
    },
    maxAreaKm2: e.MOBSIMLAB_OSM_MAX_AREA_KM2,
    maxPbfMb: e.MOBSIMLAB_OSM_PBF_MAX_MB,
    geofabrikUrl: e.MOBSIMLAB_GEOFABRIK_URL.replace(/\/+$/, ""),
    geofabrikCacheDays: e.MOBSIMLAB_GEOFABRIK_CACHE_DAYS,
    dem: { maxAreaKm2: e.MOBSIMLAB_DEM_MAX_AREA_KM2, maxUploadMb: e.MOBSIMLAB_DEM_UPLOAD_MAX_MB },
    toolTimeoutMin: e.MOBSIMLAB_OSM_TOOL_TIMEOUT_MIN,
  };
}

/** Purpose: the folders under the data directory. */
export function geodataDirs(s: GeodataSettings) {
  const root = join(s.dataDir, "geodata");
  return {
    root,
    overpassCache: join(root, "overpass-cache"),
    geofabrik: join(root, "geofabrik"),
    uploads: join(root, "uploads"),
    work: join(root, "work"),
    /** One folder per project holding `area.osm.pbf`, the extract the street tiles are cut from. */
    project: (projectId: string) => join(root, "projects", projectId),
  };
}

const EARTH_KM_PER_DEG = 111.32;

/** Purpose: area of a box `[west, south, east, north]` in km² (spherical approximation). */
export function bboxAreaKm2(b: readonly [number, number, number, number] | readonly number[]): number {
  const [w, s, e, n] = b as [number, number, number, number];
  const lat = ((s + n) / 2) * (Math.PI / 180);
  return Math.max(0, (e - w) * EARTH_KM_PER_DEG * Math.cos(lat)) * Math.max(0, (n - s) * EARTH_KM_PER_DEG);
}
