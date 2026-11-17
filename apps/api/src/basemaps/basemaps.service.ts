import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { DATABASE, type Database } from "../db/database";
import type { ProjectActor } from "../projects/projects.service";
import { EsriImageryClient, type Tile, TileError } from "./esri.client";

/** Where Admins read Esri's terms before saving a key. */
export const ESRI_TERMS_URL = "https://www.esri.com/en-us/legal/terms/full-master-agreement";

/** What the Admin screen shows about the Esri key. The key itself is never sent back. */
export interface EsriStatus {
  configured: boolean;
  /** Last four characters of the key, so an Admin can tell which key is saved. */
  keyEnd: string | null;
  termsAcceptedAt: string | null;
  termsAcceptedBy: string | null;
  termsUrl: string;
}

/** How long the API keeps the key in memory between tiles; saving or removing it clears this at once. */
const KEY_CACHE_MS = 30_000;

/**
 * Keyed basemaps (docs/architecture/06-gis.md §8): Esri World Imagery, whose ArcGIS key an Admin saves after
 * accepting Esri's terms. Tiles come through the API so browsers never see the key; they are not stored.
 */
@Injectable()
export class BasemapsService {
  private cached: { key: string | null; at: number } | null = null;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly esri: EsriImageryClient,
  ) {}

  /** Purpose: the Esri key's status for the Admin screen. */
  async esriStatus(): Promise<EsriStatus> {
    const r = await this.db
      .selectFrom("iam.instance as i")
      .leftJoin("iam.user as u", "u.id", "i.esri_terms_accepted_by")
      .select(["i.esri_api_key", "i.esri_terms_accepted_at", "u.display_name", "u.email"])
      .executeTakeFirstOrThrow();
    return {
      configured: r.esri_api_key !== null,
      keyEnd: r.esri_api_key ? r.esri_api_key.slice(-4) : null,
      termsAcceptedAt: r.esri_api_key ? (r.esri_terms_accepted_at?.toISOString() ?? null) : null,
      termsAcceptedBy: r.esri_api_key ? (r.display_name ?? r.email ?? null) : null,
      termsUrl: ESRI_TERMS_URL,
    };
  }

  /** Purpose: the keyed basemaps members can use now (an Admin has saved their key). */
  async available(): Promise<string[]> {
    return (await this.esriKey()) ? ["esri"] : [];
  }

  /**
   * Purpose: save the ArcGIS key, recording that the actor accepted Esri's terms. Admins and Owners.
   * Side effects: audit `instance.esri_key_set` (with the key's last four characters, never the key).
   */
  async setEsriKey(actor: ProjectActor, apiKey: string): Promise<EsriStatus> {
    await this.db.transaction().execute(async (tx) => {
      const before = await tx
        .selectFrom("iam.instance")
        .select("esri_api_key")
        .forUpdate()
        .executeTakeFirstOrThrow();
      const now = new Date();
      await tx
        .updateTable("iam.instance")
        .set({
          esri_api_key: apiKey,
          esri_terms_accepted_at: now,
          esri_terms_accepted_by: actor.userId,
          updated_at: now,
        })
        .execute();
      await this.audit.append(
        {
          action: "instance.esri_key_set",
          objectType: "instance",
          actorId: actor.userId,
          actorIpHash: actor.ipHash,
          requestId: actor.requestId,
          before: { configured: before.esri_api_key !== null },
          after: { configured: true, keyEnd: apiKey.slice(-4), termsAccepted: ESRI_TERMS_URL },
        },
        tx,
      );
    });
    this.cached = null;
    return this.esriStatus();
  }

  /** Purpose: remove the ArcGIS key; Esri imagery stops at once. Side effects: audit `instance.esri_key_removed`. */
  async removeEsriKey(actor: ProjectActor): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      const before = await tx
        .selectFrom("iam.instance")
        .select("esri_api_key")
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (before.esri_api_key === null) return;
      await tx
        .updateTable("iam.instance")
        .set({
          esri_api_key: null,
          esri_terms_accepted_at: null,
          esri_terms_accepted_by: null,
          updated_at: new Date(),
        })
        .execute();
      await this.audit.append(
        {
          action: "instance.esri_key_removed",
          objectType: "instance",
          actorId: actor.userId,
          actorIpHash: actor.ipHash,
          requestId: actor.requestId,
          before: { configured: true },
          after: { configured: false },
        },
        tx,
      );
    });
    this.cached = null;
  }

  /** Purpose: one Esri imagery tile, fetched with the saved key. Throws TileError 404 when no key is saved. */
  async esriTile(z: number, x: number, y: number): Promise<Tile> {
    const key = await this.esriKey();
    if (!key) throw new TileError("Esri World Imagery is not set up on this MobSimLab", 404);
    return this.esri.tile(key, z, x, y);
  }

  private async esriKey(): Promise<string | null> {
    if (this.cached && Date.now() - this.cached.at < KEY_CACHE_MS) return this.cached.key;
    const r = await this.db.selectFrom("iam.instance").select("esri_api_key").executeTakeFirstOrThrow();
    this.cached = { key: r.esri_api_key, at: Date.now() };
    return r.esri_api_key;
  }
}
