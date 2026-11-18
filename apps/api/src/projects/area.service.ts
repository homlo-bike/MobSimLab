import { BadRequestException, Inject, Injectable, Optional } from "@nestjs/common";
import { z } from "zod";
import { DATABASE, type Database } from "../db/database";
import { GeodataService } from "../geodata/geodata.service";
import { bboxAreaKm2 } from "../geodata/settings";
import { PopulationLayersService } from "../population/layers.service";
import { type AreaCountries, AreaFactsService } from "./area-facts";
import { type AreaRegion, type Bbox, MAX_AREA_REGIONS, projectArea } from "./project-area";
import { type ProjectActor, ProjectsService } from "./projects.service";

const lonLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

/** What a planner sends to set the project area: the picked OpenStreetMap regions, with their outlines. */
export const areaBody = z.strictObject({
  regions: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[rw]\d{1,15}$/, "A region id is r or w and a number"),
        name: z.string().trim().min(1).max(200),
        kind: z.string().trim().min(1).max(100),
        adminLevel: z.number().int().min(1).max(15).nullable(),
        ring: z.array(lonLat).min(4).max(1500),
        areaKm2: z.number().min(0).max(1e8),
      }),
    )
    .max(MAX_AREA_REGIONS)
    .refine((rs) => new Set(rs.map((r) => r.id)).size === rs.length, "A region is listed twice"),
  /** Queue the OpenStreetMap, elevation and population imports for the new area. */
  import: z.boolean().default(true),
});
export type AreaBody = z.infer<typeof areaBody>;

/** One import queued (or not) when the area was saved. */
export interface AreaImport {
  kind: "osm" | "dem" | "population";
  /** queued: started now; current: an import already covers the area or is running; failed: could not start. */
  status: "queued" | "current" | "failed";
  /** Why it could not start (English, from the service that refused). */
  reason?: string;
}

/** What `GET /api/projects/:id/area` answers. */
export interface AreaView {
  regions: AreaRegion[];
  /** The box imports cover, or null when there are no regions and nothing is drawn. */
  bbox: Bbox | null;
  areaKm2: number | null;
  /** The area's countries, looked up once (#140 step 3); null until they are. More than one: it crosses a border. */
  countries?: AreaCountries | null;
}

const covers = (outer: readonly number[] | null | undefined, inner: Bbox) =>
  !!outer && outer[0]! <= inner[0] && outer[1]! <= inner[1] && outer[2]! >= inner[2] && outer[3]! >= inner[3];

/**
 * The project area from OpenStreetMap regions (#140 steps 1 and 2): Owners and Editors pick one or more regions
 * (stored on the project); the area is their union. Saving the area queues the OpenStreetMap, elevation and
 * population imports once, so the tools read the project's own data (06-gis §2 to §4).
 */
@Injectable()
export class ProjectAreaService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projects: ProjectsService,
    private readonly geodata: GeodataService,
    private readonly population: PopulationLayersService,
    @Optional() private readonly facts?: AreaFactsService,
  ) {}

  /** Purpose: the project's regions and the box imports cover. Every member. */
  async get(actor: ProjectActor, projectId: string): Promise<AreaView> {
    await this.projects.access(actor, projectId, "read");
    const area = await projectArea(this.db, projectId);
    const countries = this.facts ? await this.facts.countries(projectId, area?.bbox ?? null) : null;
    // Not looked up yet for this area (an older project, or the drawing grew): look up once, in the background.
    if (this.facts && area && !countries) this.facts.lookUp(projectId);
    return {
      regions: area?.regions ?? [],
      bbox: area?.bbox ?? null,
      areaKm2: area ? Math.round(bboxAreaKm2(area.bbox) * 10) / 10 : null,
      countries,
    };
  }

  /**
   * Purpose: set the project's regions (an empty list goes back to the box round the drawing) and, when asked,
   * queue the imports for the new area. Output: the area and what happened to each import.
   */
  async set(
    actor: ProjectActor,
    projectId: string,
    body: AreaBody,
  ): Promise<AreaView & { imports: AreaImport[] }> {
    await this.db.transaction().execute(async (tx) => {
      await this.projects.access(actor, projectId, "edit", tx, true);
      const cur = await tx
        .selectFrom("project.project")
        .select("area_regions")
        .where("id", "=", projectId)
        .executeTakeFirstOrThrow();
      await tx
        .updateTable("project.project")
        // The regions name the area (Preferences has no separate area name to type).
        .set({
          area_regions: JSON.stringify(body.regions),
          area_name: body.regions.length
            ? body.regions
                .map((r) => r.name)
                .join(", ")
                .slice(0, 200)
            : null,
          updated_at: new Date(),
        })
        .where("id", "=", projectId)
        .execute();
      const names = (v: unknown) =>
        (Array.isArray(v) ? v : []).map((r) => {
          const x = r as { id?: unknown; name?: unknown };
          return { id: x.id, name: x.name };
        });
      await this.projects.logProject(
        actor,
        projectId,
        "project.area_changed",
        { regions: names(cur.area_regions) },
        { regions: names(body.regions) },
        tx,
      );
    });
    const imports = body.import && body.regions.length ? await this.queueImports(actor, projectId) : [];
    // A new area: look up its country, holidays and climate once, in the background.
    this.facts?.lookUp(projectId, true);
    return { ...(await this.get(actor, projectId)), imports };
  }

  /**
   * Purpose: queue the OpenStreetMap (Overpass up to its limit, else the smallest Geofabrik region holding the
   * area), elevation (Copernicus GLO-30) and population (WorldPop) imports for the project area, skipping those
   * that already cover it or are running. Each import that cannot start says why; the others still start.
   */
  async queueImports(actor: ProjectActor, projectId: string): Promise<AreaImport[]> {
    const area = await projectArea(this.db, projectId);
    if (!area) return [];
    const status = await this.geodata.status(actor, projectId);
    const running = (s: string | undefined) => s === "queued" || s === "running";
    const attempt = async (kind: AreaImport["kind"], f: () => Promise<unknown>): Promise<AreaImport> => {
      try {
        await f();
        return { kind, status: "queued" };
      } catch (e) {
        return { kind, status: "failed", reason: e instanceof Error ? e.message : String(e) };
      }
    };
    const out: AreaImport[] = [];
    if (status.osm.coversDrawing || running(status.osm.latest?.status))
      out.push({ kind: "osm", status: "current" });
    else
      out.push(
        await attempt("osm", async () => {
          if (status.suggestedMethod === "overpass")
            return this.geodata.startOsm(actor, projectId, { method: "overpass", planned: false });
          const region = (await this.geodata.regions(actor, projectId))[0];
          if (!region) throw new BadRequestException("No Geofabrik region holds the project area");
          return this.geodata.startOsm(actor, projectId, {
            method: "geofabrik",
            region: region.id,
            planned: false,
          });
        }),
      );
    if (status.dem.coversDrawing || running(status.dem.latest?.status))
      out.push({ kind: "dem", status: "current" });
    else out.push(await attempt("dem", () => this.geodata.startDem(actor, projectId)));
    const layers = (await this.population.overview(actor, projectId)).layers;
    if (
      layers.some(
        (l) =>
          l.status === "importing" ||
          (l.status === "ready" && l.kind === "grid" && covers(l.coverage, area.bbox)),
      )
    )
      out.push({ kind: "population", status: "current" });
    else
      out.push(
        await attempt("population", () =>
          this.population.startImport(actor, projectId, { source: "worldpop", confidence: "medium" }),
        ),
      );
    return out;
  }
}
