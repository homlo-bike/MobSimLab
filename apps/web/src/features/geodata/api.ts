import { get, send } from "../../session/api";

/** `[west, south, east, north]` in degrees. */
export type Box = [number, number, number, number];

/** One import run (apps/api/src/geodata/geodata.service.ts `ImportRun`). */
export interface ImportRun {
  id: string;
  kind: "osm" | "dem" | "dem_upload";
  method: "overpass" | "geofabrik" | "upload" | "copernicus" | "geotiff";
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  bbox: Box;
  bufferKm: number;
  options: {
    planned?: boolean;
    region?: { id: string; name: string };
    upload?: { name: string; bytes: number };
    crs?: string | null;
    sourceName?: string | null;
    licence?: string | null;
    accuracyM?: number | null;
  };
  progress: { step?: "download" | "merge" | "extract" | "database"; done?: number; total?: number };
  stats: {
    rows?: Record<string, number>;
    tiles?: number;
    cellsWithoutData?: number;
    /** Notes on an uploaded elevation grid (English, from the API). */
    notes?: string[];
  };
  source: {
    name?: string;
    licence?: string;
    url?: string;
    retrievedAt?: string;
    dataTimestamp?: string | null;
    via?: string;
    verticalAccuracyM?: number;
    resolutionM?: number;
    crs?: string;
  };
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ImportPair {
  current: ImportRun | null;
  latest: ImportRun | null;
  coversDrawing?: boolean;
}

/** What `GET /api/projects/:id/geodata` answers. */
export interface GeodataStatus {
  canImport: boolean;
  area: {
    bbox: Box;
    drawnBbox: Box;
    bufferKm: number;
    areaKm2: number;
    /** The OpenStreetMap regions the project area is made of (#140); empty when it follows the drawing. */
    regions?: { id: string; name: string; ring: [number, number][] }[];
  } | null;
  osm: ImportPair;
  dem: ImportPair;
  demUpload: ImportPair;
  suggestedMethod: "overpass" | "geofabrik";
  limits: {
    overpassMaxKm2: number;
    osmMaxAreaKm2: number;
    demMaxAreaKm2: number;
    maxPbfMb: number;
    demUploadMaxMb: number;
  };
}

export interface GeofabrikRegion {
  id: string;
  name: string;
  parent: string | null;
  bboxKm2: number;
}

/** The calls the Map data panel makes for one project; an interface so tests can fake them. */
export interface GeodataApi {
  status(): Promise<GeodataStatus>;
  regions(): Promise<GeofabrikRegion[]>;
  startOsm(body: { method: "overpass" | "geofabrik"; region?: string; planned: boolean }): Promise<ImportRun>;
  uploadPbf(file: File, planned: boolean): Promise<ImportRun>;
  startDem(): Promise<ImportRun>;
  /** The planner's own elevation GeoTIFF, with what they say about it. */
  uploadDem(file: File, meta: DemUploadMeta): Promise<ImportRun>;
  cancel(importId: string): Promise<ImportRun>;
  /** Remove a finished import and its data (the planner's own grid). */
  remove(importId: string): Promise<void>;
  /** Set the project's buffer around the drawing, km (shared with the population import). */
  setBuffer(km: number): Promise<void>;
}

/** What the planner says about their elevation grid; empty fields are left out. */
export interface DemUploadMeta {
  crs?: string;
  source?: string;
  licence?: string;
  accuracy?: number | null;
}

/** Purpose: send a file as the request body; answers the import, or throws the API's message. */
async function uploadFile(url: string, csrf: string, file: File): Promise<ImportRun> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/octet-stream", "X-CSRF-Token": csrf },
    body: file,
  });
  const json = (await res.json().catch(() => ({}))) as {
    import?: ImportRun;
    message?: string | string[];
  };
  if (!res.ok || !json.import)
    throw new Error(
      (Array.isArray(json.message) ? json.message.join("; ") : json.message) ??
        `Upload failed (${res.status})`,
    );
  return json.import;
}

/** Purpose: the Map data API of one project over HTTP; writes send the session's CSRF token. */
export function projectGeodata(projectId: string, csrf: string): GeodataApi {
  const base = `/api/projects/${encodeURIComponent(projectId)}/geodata`;
  return {
    status: () => get<GeodataStatus>(base),
    regions: async () => (await get<{ regions: GeofabrikRegion[] }>(`${base}/geofabrik-regions`)).regions,
    startOsm: async (body) => (await send<{ import: ImportRun }>("POST", `${base}/osm`, csrf, body)).import,
    uploadPbf: (file, planned) => {
      const q = new URLSearchParams({ name: file.name, planned: String(planned) });
      return uploadFile(`${base}/osm/upload?${q.toString()}`, csrf, file);
    },
    startDem: async () => (await send<{ import: ImportRun }>("POST", `${base}/dem`, csrf)).import,
    cancel: async (importId) =>
      (
        await send<{ import: ImportRun }>(
          "POST",
          `${base}/imports/${encodeURIComponent(importId)}/cancel`,
          csrf,
        )
      ).import,
    uploadDem: (file, meta) => {
      const q = new URLSearchParams({ name: file.name });
      if (meta.crs?.trim()) q.set("crs", meta.crs.trim());
      if (meta.source?.trim()) q.set("source", meta.source.trim());
      if (meta.licence?.trim()) q.set("licence", meta.licence.trim());
      if (meta.accuracy !== undefined && meta.accuracy !== null) q.set("accuracy", String(meta.accuracy));
      return uploadFile(`${base}/dem/upload?${q.toString()}`, csrf, file);
    },
    remove: async (importId) => {
      const res = await fetch(`${base}/imports/${encodeURIComponent(importId)}`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "X-CSRF-Token": csrf },
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(json.message ?? `Remove failed (${res.status})`);
      }
    },
    setBuffer: async (km) => {
      await send("PUT", `/api/projects/${encodeURIComponent(projectId)}/population/area`, csrf, {
        bufferKm: km,
      });
    },
  };
}
