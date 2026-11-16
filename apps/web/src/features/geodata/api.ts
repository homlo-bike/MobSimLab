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
  };
  progress: { step?: "download" | "merge" | "extract" | "database"; done?: number; total?: number };
  stats: {
    rows?: Record<string, number>;
    tiles?: number;
    cellsWithoutData?: number;
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
  area: { bbox: Box; drawnBbox: Box; bufferKm: number; areaKm2: number } | null;
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
  cancel(importId: string): Promise<ImportRun>;
}

/** Purpose: the Map data API of one project over HTTP; writes send the session's CSRF token. */
export function projectGeodata(projectId: string, csrf: string): GeodataApi {
  const base = `/api/projects/${encodeURIComponent(projectId)}/geodata`;
  return {
    status: () => get<GeodataStatus>(base),
    regions: async () => (await get<{ regions: GeofabrikRegion[] }>(`${base}/geofabrik-regions`)).regions,
    startOsm: async (body) => (await send<{ import: ImportRun }>("POST", `${base}/osm`, csrf, body)).import,
    uploadPbf: async (file, planned) => {
      const q = new URLSearchParams({ name: file.name, planned: String(planned) });
      const res = await fetch(`${base}/osm/upload?${q.toString()}`, {
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
  };
}
