import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { DATABASE, type Database } from "../db/database";
import { CredentialVault } from "./credential-vault";

/** Where the Esri key is stored, bound into its encryption. */
export const ESRI_KEY_PLACE = "iam.instance.esri_api_key";

/** Where a map service's password or key is stored, bound into its encryption with the service's id. */
export const mapLayerSecretPlace = (serviceId: string) => `plugin.map_layer_service.auth_secret:${serviceId}`;

/**
 * At start-up, encrypts the stored credentials saved before they were encrypted (releases up to 2026.11.3-alpha)
 * and moves values made with an older master key to the current one. A value that cannot be read (its master key
 * is gone) is left as it is and named in the log, never shown; an Admin saves it again.
 */
@Injectable()
export class CredentialsAtRest implements OnApplicationBootstrap {
  private readonly log = new Logger("Credentials");

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly vault: CredentialVault,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.reseal();
    } catch (e) {
      this.log.error(`stored credentials not checked: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Purpose: encrypt or re-encrypt every stored credential that needs it. Output: how many were written. */
  async reseal(): Promise<number> {
    let written = 0;
    const inst = await this.db.selectFrom("iam.instance").select("esri_api_key").executeTakeFirst();
    const esri = inst?.esri_api_key;
    if (esri && this.vault.needsReseal(esri)) {
      const next = this.again(esri, ESRI_KEY_PLACE, "the Esri key");
      if (next) {
        const r = await this.db
          .updateTable("iam.instance")
          .set({ esri_api_key: next })
          .where("esri_api_key", "=", esri)
          .executeTakeFirst();
        written += Number(r.numUpdatedRows);
      }
    }
    const services = await this.db
      .selectFrom("plugin.map_layer_service")
      .select(["id", "name", "auth_secret"])
      .where("auth_secret", "is not", null)
      .execute();
    for (const s of services) {
      if (!s.auth_secret || !this.vault.needsReseal(s.auth_secret)) continue;
      const next = this.again(
        s.auth_secret,
        mapLayerSecretPlace(s.id),
        `the sign-in of map service "${s.name}"`,
      );
      if (!next) continue;
      const r = await this.db
        .updateTable("plugin.map_layer_service")
        .set({ auth_secret: next })
        .where("id", "=", s.id)
        .where("auth_secret", "=", s.auth_secret)
        .executeTakeFirst();
      written += Number(r.numUpdatedRows);
    }
    if (written > 0) this.log.log(`encrypted ${written} stored credential(s) with the current master key`);
    return written;
  }

  private again(stored: string, place: string, what: string): string | null {
    try {
      return this.vault.encrypt(this.vault.decrypt(stored, place), place);
    } catch {
      this.log.warn(`${what} cannot be read with this MobSimLab's master key; an Admin should save it again`);
      return null;
    }
  }
}
