import { BadRequestException, Inject, Injectable, Optional } from "@nestjs/common";
import { sql } from "kysely";
import { z } from "zod";
import { DATABASE, type Database } from "../db/database";
import { GeodataService } from "../geodata/geodata.service";
import { PopulationLayersService } from "../population/layers.service";
import { type AreaCountries, AreaFactsService } from "./area-facts";
import {
  type AreaEstimate,
  type AreaPolygon,
  areaLimitMb,
  areaPolygons,
  estimateArea,
} from "./area-polygons";
import { type Bbox, projectArea } from "./project-area";
import { type ProjectActor, ProjectsService } from "./projects.service";

/** What a planner sends to set the project area: the polygons drawn in the area window. */
export const areaBody = z.strictObject({
  polygons: areaPolygons,
  /** Queue the OpenStreetMap, elevation and population imports for the new area. */
  import: z.boolean().default(true),
});
export type AreaBody = z.infer<typeof areaBody>;

/** What a planner sends to estimate an area while drawing it. */
export const estimateBody = z.strictObject({
  polygons: areaPolygons,
  /** The saved area while editing it: the estimate then says what the new area adds. */
  previous: areaPolygons.optional(),
});

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
  /** The polygons of the area; empty until the planner draws one. */
  polygons: AreaPolygon[];
  /** What the polygons hold and the instance's limit. */
  estimate: AreaEstimate;
  /** The box round the polygons (what box-based imports cover), or null without polygons. */
  bbox: Bbox | null;
  /** When the area's map data was last downloaded (the latest finished OpenStreetMap import), or null. */
  dataDate: string | null;
  /** The area's countries, looked up once (#140 step 3); null until they are. More than one: it crosses a border. */
  countries?: AreaCountries | null;
}

const covers = (outer: readonly number[] | null | undefined, inner: Bbox) =>
  !!outer && outer[0]! <= inner[0] && outer[1]! <= inner[1] && outer[2]! >= inner[2] && outer[3]! >= inner[3];

/**
 * The project area as polygons the planner draws (large-area projects): Owners and Editors draw them in the area
 * window, each with a detail setting; saving queues the OpenStreetMap, elevation and population imports once, so
 * the tools read the project's own data (06-gis §2 to §4).
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

  /** Purpose: the project's polygons, what they hold and the box imports cover. Every member. */
  async get(actor: ProjectActor, projectId: string): Promise<AreaView> {
    await this.projects.access(actor, projectId, "read");
    const area = await projectArea(this.db, projectId);
    const countries = this.facts ? await this.facts.countries(projectId, area?.bbox ?? null) : null;
    // Not looked up yet for this area: look up once, in the background.
    if (this.facts && area && !countries) this.facts.lookUp(projectId);
    const polygons = area?.polygons ?? [];
    const last = await sql<{ finished_at: Date | null }>`
      SELECT finished_at FROM geo.import
      WHERE project_id = ${projectId} AND kind = 'osm' AND status = 'done'
      ORDER BY finished_at DESC LIMIT 1`
      .execute(this.db)
      .then((r) => r.rows[0])
      .catch(() => undefined);
    return {
      polygons,
      estimate: estimateArea(polygons, areaLimitMb()),
      bbox: area?.bbox ?? null,
      dataDate: last?.finished_at ? new Date(last.finished_at).toISOString() : null,
      countries,
    };
  }

  /**
   * Purpose: set the project's polygons and, when asked, queue the imports for the new area. Output: the area and
   * what happened to each import. 400 when the polygons hold more map data than the limit.
   */
  async set(
    actor: ProjectActor,
    projectId: string,
    body: AreaBody,
  ): Promise<AreaView & { imports: AreaImport[] }> {
    const est = estimateArea(body.polygons, areaLimitMb());
    if (est.overLimit)
      throw new BadRequestException(
        `The area holds about ${Math.round(est.bytes / 1024 / 1024)} MB of map data, more than the ` +
          `${Math.round(est.limitBytes / 1024 / 1024)} MB a project may hold. Make it smaller, or set polygons ` +
          "along routes to main roads and railways only.",
      );
    await this.db.transaction().execute(async (tx) => {
      await this.projects.access(actor, projectId, "edit", tx, true);
      const cur = await tx
        .selectFrom("project.project")
        .select("area_polygons")
        .where("id", "=", projectId)
        .executeTakeFirstOrThrow();
      await tx
        .updateTable("project.project")
        // The polygons name the area (Preferences has no separate area name to type).
        .set({
          area_polygons: JSON.stringify(body.polygons),
          area_name: body.polygons.length
            ? body.polygons
                .map((p) => p.name)
                .join(", ")
                .slice(0, 200)
            : null,
          updated_at: new Date(),
        })
        .where("id", "=", projectId)
        .execute();
      const summary = (v: unknown) =>
        (Array.isArray(v) ? v : []).map((r) => {
          const x = r as { id?: unknown; name?: unknown; detail?: unknown };
          return { id: x.id, name: x.name, detail: x.detail };
        });
      await this.projects.logProject(
        actor,
        projectId,
        "project.area_changed",
        { polygons: summary(cur.area_polygons) },
        { polygons: summary(body.polygons) },
        tx,
      );
    });
    const imports = body.import && body.polygons.length ? await this.queueImports(actor, projectId) : [];
    // A new area: look up its country, holidays and climate once, in the background.
    this.facts?.lookUp(projectId, true);
    return { ...(await this.get(actor, projectId)), imports };
  }

  /** Purpose: what some polygons would hold, for the area window while the planner draws. */
  estimate(polygons: AreaPolygon[], previous?: AreaPolygon[]): AreaEstimate {
    return estimateArea(polygons, areaLimitMb(), previous);
  }

  /**
   * Purpose: download the area's map data again (Refresh map data): queue the imports even when the current ones
   * cover the area, except those still running. Owners and Editors.
   */
  async refresh(actor: ProjectActor, projectId: string): Promise<AreaImport[]> {
    await this.projects.access(actor, projectId, "edit");
    return this.queueImports(actor, projectId, true);
  }

  /**
   * Purpose: queue the OpenStreetMap (Overpass up to its limit, else the smallest Geofabrik region holding the
   * area), elevation (Copernicus GLO-30) and population (WorldPop) imports for the project area, skipping those
   * that already cover it or are running. Each import that cannot start says why; the others still start.
   */
  async queueImports(actor: ProjectActor, projectId: string, again = false): Promise<AreaImport[]> {
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
    if (running(status.osm.latest?.status) || (!again && status.osm.coversDrawing))
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
    if (running(status.dem.latest?.status) || (!again && status.dem.coversDrawing))
      out.push({ kind: "dem", status: "current" });
    else out.push(await attempt("dem", () => this.geodata.startDem(actor, projectId)));
    const layers = (await this.population.overview(actor, projectId)).layers;
    if (
      layers.some(
        (l) =>
          l.status === "importing" ||
          (!again && l.status === "ready" && l.kind === "grid" && covers(l.coverage, area.bbox)),
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
