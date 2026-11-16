import { sql } from "kysely";
import type { Database } from "../db/database";

/**
 * TEMPORARY stand-in until the population import's project-area helper merges (same interface): the project
 * area is the box around everything drawn in the project, buffered by `project.area_buffer_km`.
 */

export type Bbox = [number, number, number, number];

export interface ProjectArea {
  bbox: Bbox;
  drawnBbox: Bbox;
  bufferKm: number;
}

/** Purpose: a box grown by `km` on every side. */
export function bufferedBox(b: Bbox, km: number): Bbox {
  const dLat = km / 111.32;
  const lat = (Math.max(Math.abs(b[1]), Math.abs(b[3])) * Math.PI) / 180;
  const dLon = km / (111.32 * Math.max(0.01, Math.cos(lat)));
  return [
    Math.max(-180, b[0] - dLon),
    Math.max(-85, b[1] - dLat),
    Math.min(180, b[2] + dLon),
    Math.min(85, b[3] + dLat),
  ];
}

/** Purpose: the project area, or null when nothing is drawn. */
export async function projectArea(
  db: Database,
  projectId: string,
  bufferKm?: number,
): Promise<ProjectArea | null> {
  const { rows } = await sql<{ doc: unknown; buffer: string | null }>`
    SELECT d.doc, to_jsonb(p) ->> 'area_buffer_km' AS buffer FROM project.project p
    LEFT JOIN project.drawing d ON d.project_id = p.id WHERE p.id = ${projectId}`.execute(db);
  let b: Bbox | null = null;
  const visit = (v: unknown) => {
    if (Array.isArray(v)) {
      if (
        v.length >= 2 &&
        typeof v[0] === "number" &&
        typeof v[1] === "number" &&
        Math.abs(v[0]) <= 180 &&
        Math.abs(v[1]) <= 90
      ) {
        const [x, y] = v as [number, number];
        b = b ? [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)] : [x, y, x, y];
        return;
      }
      v.forEach(visit);
    } else if (v && typeof v === "object") Object.values(v).forEach(visit);
  };
  for (const r of rows) visit(r.doc);
  if (!b) return null;
  const km = bufferKm ?? Number(rows[0]?.buffer ?? 2);
  return { bbox: bufferedBox(b, km), drawnBbox: b, bufferKm: km };
}
