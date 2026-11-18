import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig } from "../config/env";
import { DATABASE, type Database } from "../db/database";
import type { ProjectActor } from "../projects/projects.service";
import type { Tile } from "./esri.client";
import { type OgcKind, type ResolvedLayer, tileUrl } from "./ogc";
import { type OgcAuth, OgcClient, OgcError } from "./ogc.client";
import { BUILTIN_SERVICES, type BuiltinService } from "./builtin-layers";

/** How a service's layers are drawn: as a basemap under the place names, or over any basemap. */
export type ShowAs = "basemap" | "overlay";

/** A service as the Admin screen lists it. The password or key never comes back. */
export interface MapLayerServiceView {
  id: string;
  kind: OgcKind;
  name: string;
  /** The service's host and path, without query parameters (which may hold a key); XYZ: the template's. */
  address: string;
  auth: { type: OgcAuth["type"]; name: string | null };
  showAs: ShowAs;
  attribution: string;
  layers: { id: string; title: string }[];
  addedAt: string;
  addedBy: string | null;
  /** MobSimLab comes with this service: it can be hidden, not removed. */
  builtin: boolean;
  /** Hidden by an Admin: not offered on maps. */
  hidden: boolean;
}

/** A layer as members' maps get it from `GET /api/basemaps`: tiles through the API, never the service's address. */
export interface MapLayerOffer {
  /** Unique on this MobSimLab: `ogc-<service id>-<layer number>`. */
  id: string;
  label: string;
  service: string;
  kind: OgcKind;
  showAs: ShowAs;
  tiles: string[];
  tileSize: 256 | 512;
  minzoom: number;
  maxzoom: number;
  bounds?: [number, number, number, number];
  attribution: string;
}

/** What the Admin screen shows after reading a service: its layers, and which the map can draw. */
export interface Inspection {
  kind: OgcKind;
  title: string;
  attribution: string;
  layers: { id: string; title: string; problem?: string }[];
}

/** What an Admin sends to add a service. */
export interface NewService {
  kind: OgcKind;
  name: string;
  url: string;
  auth: OgcAuth;
  showAs: ShowAs;
  attribution: string;
  layers: string[];
  /** XYZ tiles: the deepest zoom level the service has. */
  maxzoom?: number;
}

interface Row {
  id: string;
  kind: OgcKind;
  name: string;
  url: string;
  auth: OgcAuth;
  showAs: ShowAs;
  attribution: string;
  layers: ResolvedLayer[];
}

/** Deepest zoom of XYZ tiles when the Admin gives none. */
export const XYZ_MAX_ZOOM = 18;

/** How long the API keeps the services in memory between tiles; adding or removing one clears this at once. */
const CACHE_MS = 30_000;

/** How often the API tries again to add a built-in service it could not read (the service was down). */
const BUILTIN_RETRY_MS = 10 * 60_000;

/** Purpose: the address without its query (which may hold a key), for screens and the audit log. */
export function addressOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${decodeURI(u.pathname)}`;
  } catch {
    return "";
  }
}

/**
 * WMS and WMTS map layers (bundled plugin `org.mobsimlab.ogc-layers`, docs/architecture/06-gis.md §8): Admins add
 * a service with its sign-in details and pick its layers; members' maps get the tiles through the API, which keeps
 * the details on the server and does not store the tiles.
 */
@Injectable()
export class MapLayersService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger("MapLayers");
  private cached: { rows: Row[]; at: number } | null = null;
  private retry: NodeJS.Timeout | null = null;
  private adding: Promise<void> | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly ogc: OgcClient,
  ) {}

  /** Purpose: add the services MobSimLab comes with in the background, so a slow service never holds up the start. */
  onApplicationBootstrap(): void {
    if (this.config.mapLayerDefaultsOff) return;
    void this.addBuiltins();
    this.retry = setInterval(() => void this.addBuiltins(), BUILTIN_RETRY_MS);
    this.retry.unref();
  }

  onModuleDestroy(): void {
    if (this.retry) clearInterval(this.retry);
  }

  /**
   * Purpose: add each service MobSimLab comes with that this MobSimLab lacks, read from its capabilities. One that
   * cannot be read now is tried again later; once all are in, no more tries. A hidden one stays as it is.
   */
  addBuiltins(services: readonly BuiltinService[] = BUILTIN_SERVICES): Promise<void> {
    this.adding ??= this.addMissing(services).finally(() => (this.adding = null));
    return this.adding;
  }

  private async addMissing(services: readonly BuiltinService[]): Promise<void> {
    const have = new Set(
      (
        await this.db
          .selectFrom("plugin.map_layer_service")
          .select("builtin")
          .where("builtin", "is not", null)
          .execute()
      ).map((r) => r.builtin),
    );
    let missing = 0;
    for (const b of services) {
      if (have.has(b.id)) continue;
      try {
        const layers = await this.resolve(
          b.kind,
          b.url,
          { type: "none" },
          b.maxzoom ?? XYZ_MAX_ZOOM,
          b.layers,
        );
        await this.db
          .insertInto("plugin.map_layer_service")
          .values({
            kind: b.kind,
            name: b.name,
            url: b.url,
            auth_type: "none",
            show_as: b.showAs,
            attribution: b.attribution,
            layers: JSON.stringify(layers),
            builtin: b.id,
          })
          .onConflict((oc) => oc.column("builtin").doNothing())
          .execute();
        this.cached = null;
      } catch (e) {
        missing++;
        this.log.warn(
          `built-in map layer ${b.id} not added yet: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    if (missing === 0 && this.retry) {
      clearInterval(this.retry);
      this.retry = null;
    }
  }

  /** Purpose: the picked layers of a service, read from its capabilities. Throws OgcError 400 for a missing one. */
  private async resolve(
    kind: OgcKind,
    url: string,
    auth: OgcAuth,
    maxzoom: number,
    ids: string[],
  ): Promise<ResolvedLayer[]> {
    const c = await this.read(kind, url, auth, maxzoom);
    return ids.map((id) => {
      const found = c.layers.find((l) => l.id === id);
      if (!found) throw new OgcError(`the service has no layer ${id}`, 400);
      if (!found.layer)
        throw new OgcError(`${found.title}: ${found.problem ?? "the map cannot draw it"}`, 400);
      return found.layer;
    });
  }

  /** Purpose: the services for the Admin screen, newest first. */
  async list(): Promise<MapLayerServiceView[]> {
    const rows = await this.db
      .selectFrom("plugin.map_layer_service as s")
      .leftJoin("iam.user as u", "u.id", "s.added_by")
      .select([
        "s.id",
        "s.kind",
        "s.name",
        "s.url",
        "s.auth_type",
        "s.auth_name",
        "s.show_as",
        "s.attribution",
        "s.layers",
        "s.added_at",
        "s.builtin",
        "s.hidden",
        "u.display_name",
        "u.email",
      ])
      .orderBy("s.added_at", "desc")
      .execute();
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      address: addressOf(r.url),
      auth: { type: r.auth_type, name: r.auth_name },
      showAs: r.show_as,
      attribution: r.attribution,
      layers: (r.layers as ResolvedLayer[]).map((l) => ({ id: l.id, title: l.title })),
      addedAt: r.added_at.toISOString(),
      addedBy: r.display_name ?? r.email ?? null,
      builtin: r.builtin !== null,
      hidden: r.hidden,
    }));
  }

  /** Purpose: read a service's capabilities (or check an XYZ address) for the Admin screen, saving nothing. */
  async inspect(kind: OgcKind, url: string, auth: OgcAuth, maxzoom = XYZ_MAX_ZOOM): Promise<Inspection> {
    const c = await this.read(kind, url, auth, maxzoom);
    return {
      kind,
      title: c.title,
      attribution: c.attribution,
      layers: c.layers.map((l) => ({
        id: l.id,
        title: l.title,
        ...(l.problem ? { problem: l.problem } : {}),
      })),
    };
  }

  /**
   * Purpose: add a service with the picked layers, read again from its capabilities. Admins and Owners.
   * Side effects: audit `instance.map_layer_service_added` (host, kind, layers and the sign-in type; never the
   * password or key, nor the address's query).
   */
  async add(actor: ProjectActor, s: NewService): Promise<MapLayerServiceView[]> {
    const layers = await this.resolve(s.kind, s.url, s.auth, s.maxzoom ?? XYZ_MAX_ZOOM, s.layers);
    await this.db.transaction().execute(async (tx) => {
      const row = await tx
        .insertInto("plugin.map_layer_service")
        .values({
          kind: s.kind,
          name: s.name,
          url: s.url,
          auth_type: s.auth.type,
          auth_name: s.auth.type === "none" ? null : s.auth.name,
          auth_secret: s.auth.type === "none" ? null : s.auth.secret,
          show_as: s.showAs,
          attribution: s.attribution,
          layers: JSON.stringify(layers),
          added_by: actor.userId,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await this.audit.append(
        {
          action: "instance.map_layer_service_added",
          objectType: "map_layer_service",
          objectId: row.id,
          actorId: actor.userId,
          actorIpHash: actor.ipHash,
          requestId: actor.requestId,
          after: {
            kind: s.kind,
            name: s.name,
            address: addressOf(s.url),
            auth: s.auth.type,
            showAs: s.showAs,
            layers: layers.map((l) => l.id),
          },
        },
        tx,
      );
    });
    this.cached = null;
    return this.list();
  }

  /**
   * Purpose: remove a service; its layers leave the maps at once. A built-in service is hidden instead, so it is
   * not added again at the next start. Side effects: audit `…_removed` (or `…_hidden`).
   */
  async remove(actor: ProjectActor, id: string): Promise<MapLayerServiceView[]> {
    const row = await this.db
      .selectFrom("plugin.map_layer_service")
      .select("builtin")
      .where("id", "=", id)
      .executeTakeFirst();
    if (row?.builtin) return this.setHidden(actor, id, true);
    await this.db.transaction().execute(async (tx) => {
      const gone = await tx
        .deleteFrom("plugin.map_layer_service")
        .where("id", "=", id)
        .returning(["kind", "name", "url"])
        .executeTakeFirst();
      if (!gone) return;
      await this.audit.append(
        {
          action: "instance.map_layer_service_removed",
          objectType: "map_layer_service",
          objectId: id,
          actorId: actor.userId,
          actorIpHash: actor.ipHash,
          requestId: actor.requestId,
          before: { kind: gone.kind, name: gone.name, address: addressOf(gone.url) },
        },
        tx,
      );
    });
    this.cached = null;
    return this.list();
  }

  /**
   * Purpose: hide a service from the maps, or show it again. Side effects: audit `instance.map_layer_service_hidden`
   * or `…_shown`.
   */
  async setHidden(actor: ProjectActor, id: string, hidden: boolean): Promise<MapLayerServiceView[]> {
    await this.db.transaction().execute(async (tx) => {
      const changed = await tx
        .updateTable("plugin.map_layer_service")
        .set({ hidden })
        .where("id", "=", id)
        .where("hidden", "=", !hidden)
        .returning(["kind", "name", "url"])
        .executeTakeFirst();
      if (!changed) return;
      await this.audit.append(
        {
          action: hidden ? "instance.map_layer_service_hidden" : "instance.map_layer_service_shown",
          objectType: "map_layer_service",
          objectId: id,
          actorId: actor.userId,
          actorIpHash: actor.ipHash,
          requestId: actor.requestId,
          after: { kind: changed.kind, name: changed.name, address: addressOf(changed.url), hidden },
        },
        tx,
      );
    });
    this.cached = null;
    return this.list();
  }

  /** Purpose: the layers members' maps offer, with tile paths through the API. */
  async offers(): Promise<MapLayerOffer[]> {
    return (await this.rows()).flatMap((r) =>
      r.layers.map((l, i) => ({
        id: `ogc-${r.id}-${i}`,
        label: r.layers.length > 1 ? `${l.title} (${r.name})` : r.name,
        service: r.name,
        kind: r.kind,
        showAs: r.showAs,
        tiles: [`/api/map-layers/${r.id}/${i}/tiles/{z}/{x}/{y}`],
        tileSize: l.tileSize,
        minzoom: l.minzoom,
        maxzoom: l.maxzoom,
        ...(l.bounds ? { bounds: l.bounds } : {}),
        attribution: r.attribution,
      })),
    );
  }

  /** Purpose: one tile of a layer, fetched with the service's sign-in details. Throws TileError 404 if unknown. */
  async tile(serviceId: string, index: number, z: number, x: number, y: number): Promise<Tile> {
    const row = (await this.rows()).find((r) => r.id === serviceId);
    const layer = row?.layers[index];
    if (!row || !layer) throw new OgcError("no such map layer on this MobSimLab", 404);
    const url = tileUrl(layer, z, x, y);
    if (!url) throw new OgcError("the layer has no tile here", 404);
    return this.ogc.tile(row.url, url, row.auth);
  }

  private read(kind: OgcKind, url: string, auth: OgcAuth, maxzoom: number) {
    return kind === "xyz" ? this.ogc.xyz(url, auth, maxzoom) : this.ogc.capabilities(kind, url, auth);
  }

  private async rows(): Promise<Row[]> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.rows;
    const rows = await this.db
      .selectFrom("plugin.map_layer_service")
      .selectAll()
      .where("hidden", "=", false)
      .orderBy("added_at", "asc")
      .execute();
    const out: Row[] = rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      url: r.url,
      auth:
        r.auth_type === "none" || r.auth_name === null || r.auth_secret === null
          ? { type: "none" }
          : { type: r.auth_type, name: r.auth_name, secret: r.auth_secret },
      showAs: r.show_as,
      attribution: r.attribution,
      layers: r.layers as ResolvedLayer[],
    }));
    this.cached = { rows: out, at: Date.now() };
    return out;
  }
}
