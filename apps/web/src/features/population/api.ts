import { get, send } from "../../session/api";
import type { PopulationAnswer } from "../noise/population";
import { withApiMsg } from "../../i18n/engine";

/**
 * The project's population layers on the server (apps/api/src/population, 06-gis §3): WorldPop and GHSL
 * imports for the project area, the planners' own files, the primary layer and the difference layer.
 */

export type Bbox = [number, number, number, number];
export type Confidence = "high" | "medium" | "low";

/** One population layer. */
export interface PopulationLayer {
  id: string;
  name: string;
  source: "worldpop" | "ghsl" | "upload";
  kind: "grid" | "zones" | "points";
  status: "importing" | "ready" | "failed";
  error: string | null;
  progress: { step: string; receivedBytes?: number; totalBytes?: number | null } | null;
  licence: string;
  sourceUrl: string;
  citation: string;
  confidence: Confidence;
  referenceYear: number | null;
  resolutionM: number | null;
  coverage: Bbox | null;
  peopleTotal: number;
  featureCount: number;
  isPrimary: boolean;
  options: { notes?: string[]; tiles?: string[]; countries?: string[]; format?: string } & Record<
    string,
    unknown
  >;
  createdAt: string;
  updatedAt: string;
}

/** The project area, the layers and what an import offers. */
export interface PopulationOverview {
  /** The project area: the box round its polygons (what the import covers). */
  area: { bbox: Bbox } | null;
  areaKm2: number | null;
  layers: PopulationLayer[];
  choices: {
    worldpopYears: { first: number; last: number };
    ghslEpochs: number[];
    ghslResolutions: ("3ss" | "30ss")[];
    maxUploadMb: number;
    maxAreaKm2: number;
    maxFeatures: number;
  };
}

export type ImportRequest =
  | { source: "worldpop"; year?: number; confidence?: Confidence }
  | { source: "ghsl"; epoch?: number; resolution?: "3ss" | "30ss"; confidence?: Confidence };

/** What the planner says about an upload. */
export interface LayerDetails {
  name: string;
  licence: string;
  sourceUrl: string;
  citation: string;
  confidence: Confidence;
  referenceYear: number | null;
}

/** How the server reads an uploaded file. */
export type FileOptions =
  | { format: "geotiff"; values: "count" | "density_km2"; clipToArea: boolean; crs?: string }
  | { format: "geojson"; peopleField: string; zoneField?: string; crs?: string }
  | { format: "csv"; mode: "points"; lonField: string; latField: string; peopleField: string; crs?: string }
  | { format: "csv"; mode: "zones"; zoneField: string; peopleField: string; zonesLayerId: string };

/** A layer, or a layer minus another, on a lattice: values per cell, rows from the south. */
export interface LatticeView {
  grid: { x0: number; y0: number; dx: number; dy: number; nx: number; ny: number; values: number[] };
  cellM: number;
  bbox: Bbox;
}

/** The answer of the catchment request (benefit tables). */
export interface CatchmentAnswer {
  year: number | null;
  populations: Record<string, number | null>;
  failed: number;
  reasons: string[];
  source: { id: string; name: string; dataset: string; url: string; licence: string; citation: string };
}

export interface PopulationApi {
  overview(): Promise<PopulationOverview>;
  startImport(req: ImportRequest): Promise<PopulationLayer>;
  upload(details: LayerDetails, file: FileOptions, bytes: Blob): Promise<PopulationLayer>;
  layer(id: string): Promise<PopulationLayer>;
  update(id: string, patch: Partial<LayerDetails>): Promise<PopulationLayer>;
  remove(id: string): Promise<void>;
  setPrimary(id: string | null): Promise<PopulationLayer[]>;
  lattice(layerId: string, minusId: string | null, cellM: number): Promise<LatticeView>;
  /** People per 100 m cell over a box: the primary layer, or WorldPop's live grid. */
  grid(bbox: Bbox): Promise<PopulationAnswer>;
  /** People inside each area (station catchments). */
  catchments(areas: { id: string; ring: [number, number][] }[]): Promise<CatchmentAnswer>;
}

/** Purpose: the population layers of one project, through the session cookie and CSRF token. */
export function projectPopulation(projectId: string, csrf: string): PopulationApi {
  const base = `/api/projects/${encodeURIComponent(projectId)}/population`;
  const one = (id: string) => `${base}/layers/${encodeURIComponent(id)}`;
  return {
    overview: () => get<PopulationOverview>(base),
    startImport: async (req) =>
      (await send<{ layer: PopulationLayer }>("POST", `${base}/imports`, csrf, req)).layer,
    upload: async (details, file, bytes) => {
      const info = encodeURIComponent(JSON.stringify({ details, file }));
      const res = await fetch(`${base}/uploads?info=${info}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/octet-stream", "X-CSRF-Token": csrf },
        body: bytes,
      });
      const body = (await res.json().catch(() => ({}))) as {
        layer?: PopulationLayer;
        message?: string | string[];
      };
      if (!res.ok || !body.layer) {
        const msg = Array.isArray(body.message) ? body.message.join("; ") : body.message;
        throw withApiMsg(
          new Error(
            msg || (res.status === 413 ? "the file is too large" : `the server answered ${res.status}`),
          ),
          body,
        );
      }
      return body.layer;
    },
    layer: async (id) => (await get<{ layer: PopulationLayer }>(one(id))).layer,
    update: async (id, patch) =>
      (await send<{ layer: PopulationLayer }>("PATCH", one(id), csrf, patch)).layer,
    remove: async (id) => {
      await send<{ ok: true }>("DELETE", one(id), csrf);
    },
    setPrimary: async (id) =>
      (await send<{ layers: PopulationLayer[] }>("PUT", `${base}/primary`, csrf, { layerId: id })).layers,
    lattice: (layerId, minusId, cellM) =>
      send<LatticeView>("POST", `${base}/lattice`, csrf, { layerId, minusId, cellM }),
    grid: (bbox) => send<PopulationAnswer>("POST", `${base}/grid`, csrf, { bbox }),
    catchments: (areas) => send<CatchmentAnswer>("POST", `${base}/catchments`, csrf, { areas }),
  };
}
