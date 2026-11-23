import { Inject, Injectable, Optional } from "@nestjs/common";
import { sql } from "kysely";
import { DATABASE, type Database } from "../db/database";
import { geodataSettings } from "./settings";

/** What the shared store holds: OpenStreetMap tiles, terrain heights, byte ranges of GLO-30 cell files. */
export type SharedKind = "osm" | "height" | "glo30";

/** The kinds a project points at (`project.data_use`). */
export type ProjectSharedKind = "osm" | "height";

/** Most keys read or written in one statement. */
const BATCH = 500;

/** How often, at most, copies no project uses any more are removed. */
const SWEEP_MS = 60 * 60 * 1000;

/** A store of byte ranges, as the GLO-30 client reads them; `null` marks a cell file that does not exist. */
export interface RangeStore {
  get(key: string): Promise<Uint8Array | null | undefined>;
  put(key: string, body: Uint8Array | null): Promise<void>;
}

/**
 * Map data held once for the instance (large-area projects, step 4; db/migrations/0028_shared_data.sql):
 * OpenStreetMap tiles and terrain heights fetched live, and the byte ranges of the GLO-30 cell files. Each copy is
 * kept with its data date (when it was fetched); a project points at the copies its tools used, so its data stays
 * the same until it is fetched again, and another project in the same area takes the copies already held instead
 * of downloading them. OpenStreetMap copies are taken while they are younger than `MOBSIMLAB_OSM_CACHE_DAYS`;
 * heights and GLO-30 ranges do not change and are always taken. A failing store never fails a tool: reads then
 * miss and writes are skipped.
 */
@Injectable()
export class SharedDataStore {
  private lastSweep = 0;
  private readonly osmDays: number;

  constructor(@Optional() @Inject(DATABASE) private readonly db?: Database) {
    let days = 7;
    try {
      days = geodataSettings().overpass.cacheDays;
    } catch {
      // Settings out of range are reported by the geodata service; the default serves here.
    }
    this.osmDays = days;
  }

  /** Purpose: the copies a project points at among `keys`, by key. */
  async used(
    projectId: string,
    kind: ProjectSharedKind,
    keys: readonly string[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!this.db || keys.length === 0) return out;
    try {
      for (let i = 0; i < keys.length; i += BATCH) {
        const rows = await this.db
          .selectFrom("project.data_use as u")
          .innerJoin("geo.shared_data as s", "s.id", "u.shared_id")
          .select(["u.key", "s.body"])
          .where("u.project_id", "=", projectId)
          .where("u.kind", "=", kind)
          .where("u.key", "in", keys.slice(i, i + BATCH))
          .execute();
        for (const r of rows) out.set(r.key, r.body.toString("utf8"));
      }
    } catch {
      // A store that cannot be read is a miss.
    }
    return out;
  }

  /**
   * Purpose: the newest copies the instance holds among `keys` that may still be taken, and point the project at
   * them. Output: by key; a key with no usable copy is absent.
   */
  async adopt(
    projectId: string,
    kind: ProjectSharedKind,
    keys: readonly string[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!this.db || keys.length === 0) return out;
    try {
      for (let i = 0; i < keys.length; i += BATCH) {
        let q = this.db
          .selectFrom("geo.shared_data")
          .select(["id", "key", "body"])
          .distinctOn("key")
          .where("kind", "=", kind)
          .where("key", "in", keys.slice(i, i + BATCH))
          .orderBy("key")
          .orderBy("data_date", "desc");
        if (kind === "osm") q = q.where("data_date", ">=", new Date(Date.now() - this.osmDays * 86_400_000));
        const rows = await q.execute();
        if (!rows.length) continue;
        await this.point(
          projectId,
          kind,
          rows.map((r) => [r.key, r.id]),
        );
        for (const r of rows) out.set(r.key, r.body.toString("utf8"));
      }
    } catch {
      // A store that cannot be read is a miss.
    }
    return out;
  }

  /** Purpose: keep fetched answers once for the instance and point the project at them. */
  async keep(
    projectId: string,
    kind: ProjectSharedKind,
    entries: readonly [string, string][],
  ): Promise<void> {
    if (!this.db || entries.length === 0) return;
    const unique = [...new Map(entries).entries()];
    try {
      for (let i = 0; i < unique.length; i += BATCH) {
        const rows = await this.db
          .insertInto("geo.shared_data")
          .values(
            unique.slice(i, i + BATCH).map(([key, body]) => ({ kind, key, body: Buffer.from(body, "utf8") })),
          )
          .returning(["id", "key"])
          .execute();
        await this.point(
          projectId,
          kind,
          rows.map((r) => [r.key, r.id]),
        );
      }
    } catch {
      // Not kept this time; the tool fetches it again next time.
    }
    void this.sweep();
  }

  /** Purpose: the GLO-30 byte ranges as a store for the Copernicus client; held for every project. */
  glo30(): RangeStore {
    return {
      get: async (key) => {
        if (!this.db) return undefined;
        try {
          const row = await this.db
            .selectFrom("geo.shared_data")
            .select("body")
            .where("kind", "=", "glo30")
            .where("key", "=", key)
            .orderBy("data_date", "desc")
            .limit(1)
            .executeTakeFirst();
          if (!row) return undefined;
          return row.body.byteLength ? new Uint8Array(row.body) : null;
        } catch {
          return undefined;
        }
      },
      put: async (key, body) => {
        if (!this.db) return;
        try {
          await this.db
            .insertInto("geo.shared_data")
            .values({ kind: "glo30", key, body: body ? Buffer.from(body) : Buffer.alloc(0) })
            .onConflict((oc) => oc.doNothing())
            .execute();
        } catch {
          // Read from the bucket again next time.
        }
      },
    };
  }

  private async point(projectId: string, kind: ProjectSharedKind, ids: [string, string][]): Promise<void> {
    if (!this.db || ids.length === 0) return;
    await this.db
      .insertInto("project.data_use")
      .values(ids.map(([key, id]) => ({ project_id: projectId, kind, key, shared_id: id })))
      .onConflict((oc) =>
        oc
          .columns(["project_id", "kind", "key"])
          .doUpdateSet((eb) => ({ shared_id: eb.ref("excluded.shared_id") })),
      )
      .execute();
  }

  /**
   * Purpose: remove OpenStreetMap and height copies no project uses that are older than the OpenStreetMap reuse
   * time (they are no longer taken by a new project either). At most once an hour.
   */
  private async sweep(): Promise<void> {
    if (!this.db || Date.now() - this.lastSweep < SWEEP_MS) return;
    this.lastSweep = Date.now();
    try {
      await sql`
        DELETE FROM geo.shared_data s
        WHERE s.kind IN ('osm', 'height')
          AND s.data_date < now() - make_interval(days => ${this.osmDays})
          AND NOT EXISTS (SELECT 1 FROM project.data_use u WHERE u.shared_id = s.id)`.execute(this.db);
    } catch {
      // Tried again later.
    }
  }
}
