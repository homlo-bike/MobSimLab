import { get, send } from "../../session/api";

/** An OpenStreetMap region picked as (part of) the project area (apps/api/src/projects/project-area.ts). */
export interface AreaRegion {
  /** `r123` for a relation, `w123` for a way. */
  id: string;
  name: string;
  kind: string;
  adminLevel: number | null;
  /** Outer ring `[lon, lat]`, closed. */
  ring: [number, number][];
  areaKm2: number;
}

/** One import queued (or not) when the area was saved. */
export interface AreaImport {
  kind: "osm" | "dem" | "population";
  status: "queued" | "current" | "failed";
  reason?: string;
}

/** A country of the project area, with its share of the area (apps/api/src/projects/area-facts.ts). */
export interface AreaCountry {
  iso2: string;
  iso3: string | null;
  name: string;
  share: number;
}

/** What `GET /api/projects/:id/area` answers. */
export interface AreaView {
  regions: AreaRegion[];
  bbox: [number, number, number, number] | null;
  areaKm2: number | null;
  /** The area's countries, looked up once; the first is the project's country. Null until looked up. */
  countries?: { main: AreaCountry | null; countries: AreaCountry[] } | null;
}

export interface ProjectAreaApi {
  get(): Promise<AreaView>;
  /** Set the regions (an empty list follows the drawing again) and, with `importData`, queue the imports. */
  set(regions: AreaRegion[], importData?: boolean): Promise<AreaView & { imports: AreaImport[] }>;
}

/** Purpose: the project area endpoints of one project. */
export function projectAreaApi(projectId: string, csrf: string): ProjectAreaApi {
  const base = `/api/projects/${encodeURIComponent(projectId)}/area`;
  return {
    get: () => get<AreaView>(base),
    set: (regions, importData = true) => send("PUT", base, csrf, { regions, import: importData }),
  };
}

/** Purpose: the OpenStreetMap regions (states and provinces too) containing a point, smallest first. */
export async function regionsAt([lon, lat]: [number, number]): Promise<AreaRegion[]> {
  const q = `lon=${lon.toFixed(6)}&lat=${lat.toFixed(6)}&wide=1`;
  return (await get<{ areas: AreaRegion[] }>(`/api/benefits/osm-areas?${q}`)).areas;
}
