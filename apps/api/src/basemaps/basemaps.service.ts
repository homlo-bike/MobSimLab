import { Inject, Injectable, Logger } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { CredentialVault } from "../config/credential-vault";
import { ESRI_KEY_PLACE } from "../config/credentials-at-rest";
import { DATABASE, type Database } from "../db/database";
import type { ProjectActor } from "../projects/projects.service";
import { ESRI_PLUGIN, pluginsOff } from "../plugins/instance-off";
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
 * accepting Esri's terms. The key is stored encrypted (config/credential-vault.ts). Tiles come through the API so
 * browsers never see the key; they are not stored.
 */
@Injectable()
export class BasemapsService {
  private readonly log = new Logger("Basemaps");
  private cached: { key: string | null; at: number } | null = null;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly esri: EsriImageryClient,
    private readonly vault: CredentialVault,
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
      keyEnd: r.esri_api_key ? (this.open(r.esri_api_key)?.slice(-4) ?? null) : null,
      termsAcceptedAt: r.esri_api_key ? (r.esri_terms_accepted_at?.toISOString() ?? null) : null,
      termsAcceptedBy: r.esri_api_key ? (r.display_name ?? r.email ?? null) : null,
      termsUrl: ESRI_TERMS_URL,
    };
  }

  /** Purpose: the keyed basemaps members can use now (an Admin has saved their key and not turned the plugin off). */
  async available(): Promise<string[]> {
    if ((await pluginsOff(this.db)).has(ESRI_PLUGIN)) return [];
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
          esri_api_key: this.vault.encrypt(apiKey, ESRI_KEY_PLACE),
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
    if ((await pluginsOff(this.db)).has(ESRI_PLUGIN))
      throw new TileError("Esri World Imagery is turned off on this MobSimLab", 404);
    const key = await this.esriKey();
    if (!key) throw new TileError("Esri World Imagery is not set up on this MobSimLab", 404);
    return this.esri.tile(key, z, x, y);
  }

  private async esriKey(): Promise<string | null> {
    if (this.cached && Date.now() - this.cached.at < KEY_CACHE_MS) return this.cached.key;
    const r = await this.db.selectFrom("iam.instance").select("esri_api_key").executeTakeFirstOrThrow();
    const key = r.esri_api_key ? this.open(r.esri_api_key) : null;
    this.cached = { key, at: Date.now() };
    return key;
  }

  /** Purpose: the stored key in plain text, or null (logged, never shown) when it cannot be read. */
  private open(stored: string): string | null {
    try {
      return this.vault.decrypt(stored, ESRI_KEY_PLACE);
    } catch {
      this.log.warn(
        "the saved Esri key cannot be read with this MobSimLab's master key; an Admin should save it again",
      );
      return null;
    }
  }
}
