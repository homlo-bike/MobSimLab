import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig } from "../config/env";
import { DATABASE, type Database } from "../db/database";
import { type ProjectActor, ProjectsService } from "../projects/projects.service";
import { checkChecksums, checkSignature, parsePublicKey, sha256, type SignatureStatus } from "./signature";
import {
  BUNDLED,
  checkPlugin,
  claims,
  compareVersions,
  type OtherPlugin,
  type PluginEntry,
  satisfies,
} from "./validate";
import { PackageError, unzip } from "./zip";

/** What a plugin adds, in words the install screen and Project Preferences show (ADR-0036 §9). */
export interface PluginContributions {
  modes: string[];
  tools: string[];
  parameters: number;
  calculations: string[];
  mapLayers: string[];
}

/** One plugin version as the admin screen lists it. */
export interface PluginSummary {
  id: string;
  name: string;
  description: string;
  version: string;
  publisher: { name: string; url?: string };
  license: string;
  dataLicense: string;
  bundled: boolean;
  tiers: string[];
  permissions: string[];
  dependsOn: Record<string, string>;
  contributes: PluginContributions;
  /** Installed plugins only. */
  signature?: { status: "trusted" | "unsigned"; signer: string | null };
  sha256?: string;
  sizeBytes?: number;
  installedAt?: string;
  installedBy?: string | null;
  /** Projects that have this version turned on. */
  projects: number;
}

/** The result of checking an uploaded package, before it is installed. */
export interface Inspection {
  plugin: PluginSummary | null;
  signature: SignatureStatus["status"] | null;
  signer: string | null;
  sha256: string;
  problems: string[];
}

/** One plugin as a project's Preferences tab lists it. */
export interface ProjectPlugin {
  id: string;
  name: string;
  description: string;
  publisher: { name: string; url?: string };
  bundled: boolean;
  enabled: boolean;
  /** The version the project uses: the pinned one, or the bundled one. */
  version: string;
  /** Installed versions to choose from (empty for bundled plugins). */
  versions: string[];
  permissions: string[];
  contributes: PluginContributions;
  /** The project pins a version that is no longer installed; its objects stay but the plugin is off. */
  missing: boolean;
  /** The registry entry, for enabled installed plugins (the web app has the bundled ones). */
  entry?: PluginEntry;
}

/** Who acts, with what the audit needs. */
export type PluginActor = ProjectActor;

function contributions(e: PluginEntry): PluginContributions {
  return {
    modes: e.modes.map((m) => m.label),
    tools: e.tools.map((t) => t.label),
    parameters: Object.keys(e.parameters).length,
    calculations: (e.calculations as { label?: string; id: string }[]).map((c) => c.label ?? c.id),
    mapLayers: (e.mapLayers as { label?: string; id: string }[]).map((l) => l.label ?? l.id),
  };
}

function summary(e: PluginEntry, dependsOn: Record<string, string> = {}): Omit<PluginSummary, "projects"> {
  return {
    id: e.id,
    name: e.name,
    description: e.description,
    version: e.version,
    publisher: e.publisher,
    license: e.license,
    dataLicense: e.dataLicense,
    bundled: e.bundled,
    tiers: e.tiers,
    permissions: e.permissions,
    dependsOn,
    contributes: contributions(e),
  };
}

const latest = (versions: string[]) => [...versions].sort(compareVersions).at(-1);

/**
 * Plugins (ADR-0036 §9, Phase 1): Admins install and remove plugin packages and manage the publisher keys they
 * trust; a project's Owner turns plugins on or off for the project and picks the version. Installed plugins are
 * data plugins; code runs only in the plugins bundled with MobSimLab until the sandbox (Phase 2) exists.
 */
@Injectable()
export class PluginsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly projects: ProjectsService,
  ) {}

  /** Purpose: everything the admin screen shows: bundled and installed plugins, keys and the unsigned setting. */
  async adminList() {
    const [rows, keys, inst, use] = await Promise.all([
      this.db
        .selectFrom("plugin.package as p")
        .leftJoin("iam.user as u", "u.id", "p.installed_by")
        .select([
          "p.plugin_id",
          "p.version",
          "p.manifest",
          "p.entry",
          "p.sha256",
          "p.size_bytes",
          "p.signature",
          "p.signer_name",
          "p.installed_at",
          "u.display_name as installed_by_name",
        ])
        .orderBy("p.plugin_id")
        .execute(),
      this.db
        .selectFrom("plugin.trusted_key as k")
        .leftJoin("iam.user as u", "u.id", "k.added_by")
        .select(["k.id", "k.name", "k.fingerprint", "k.added_at", "u.display_name as added_by_name"])
        .orderBy("k.name")
        .execute(),
      this.db.selectFrom("iam.instance").select("allow_unsigned_plugins").executeTakeFirstOrThrow(),
      this.usage(),
    ]);
    const installed = rows
      .map((r) => {
        const e = r.entry as PluginEntry;
        return {
          ...summary(
            e,
            ((r.manifest as { dependsOn?: Record<string, string> }).dependsOn ?? {}) as Record<
              string,
              string
            >,
          ),
          signature: { status: r.signature, signer: r.signer_name },
          sha256: r.sha256,
          sizeBytes: r.size_bytes,
          installedAt: r.installed_at.toISOString(),
          installedBy: r.installed_by_name,
          projects: use.get(`${r.plugin_id}@${r.version}`) ?? 0,
        } satisfies PluginSummary;
      })
      .sort((a, b) => a.id.localeCompare(b.id) || compareVersions(b.version, a.version));
    return {
      bundled: BUNDLED.map(
        (e) => ({ ...summary(e), projects: use.get(`${e.id}@`) ?? 0 }) satisfies PluginSummary,
      ),
      installed,
      keys: keys.map((k) => ({
        id: k.id,
        name: k.name,
        fingerprint: k.fingerprint,
        addedAt: k.added_at.toISOString(),
        addedBy: k.added_by_name,
      })),
      developmentMode: this.config.developmentMode,
      allowUnsigned: this.config.developmentMode && inst.allow_unsigned_plugins,
    };
  }

  /**
   * Purpose: check an uploaded package without installing it, for the install screen (publisher, signature,
   * tiers, permissions, licences, contributions, and every problem that would stop the install).
   */
  async inspect(actor: PluginActor, buf: Buffer): Promise<Inspection> {
    return (await this.check(actor, buf, this.db)).inspection;
  }

  /**
   * Purpose: install a package for the whole instance. Admins and Owners.
   * Output: the installed version's summary. 400 with `problems` when the package cannot be installed.
   * Side effects: stores the package's manifest and registry entry; audit `plugin.installed`.
   */
  async install(actor: PluginActor, buf: Buffer): Promise<PluginSummary> {
    return this.db.transaction().execute(async (tx) => {
      await tx.selectFrom("iam.instance").select("id").forUpdate().executeTakeFirstOrThrow();
      const { inspection, entry, manifest, sig } = await this.check(actor, buf, tx);
      if (!entry || !manifest || inspection.problems.length > 0)
        throw new BadRequestException({
          message: "the plugin cannot be installed",
          problems: inspection.problems,
        });
      const trusted = sig?.status === "trusted";
      await tx
        .insertInto("plugin.package")
        .values({
          plugin_id: entry.id,
          version: entry.version,
          manifest: JSON.stringify(manifest),
          entry: JSON.stringify(entry),
          sha256: inspection.sha256,
          size_bytes: buf.length,
          signature: trusted ? "trusted" : "unsigned",
          signed_by: sig?.status === "trusted" ? sig.keyId : null,
          signer_name: trusted ? inspection.signer : null,
          installed_by: actor.userId,
        })
        .execute();
      await this.audit.append(
        {
          action: "plugin.installed",
          objectType: "plugin",
          objectId: `${entry.id}@${entry.version}`,
          actorId: actor.userId,
          actorIpHash: actor.ipHash,
          requestId: actor.requestId,
          after: {
            id: entry.id,
            version: entry.version,
            sha256: inspection.sha256,
            signature: trusted ? "trusted" : "unsigned",
            signer: inspection.signer,
            permissions: entry.permissions,
          },
        },
        tx,
      );
      return {
        ...inspection.plugin!,
        signature: { status: trusted ? "trusted" : "unsigned", signer: trusted ? inspection.signer : null },
        sha256: inspection.sha256,
        sizeBytes: buf.length,
        installedAt: new Date().toISOString(),
        projects: 0,
      };
    });
  }

  /**
   * Purpose: remove an installed version. Refused (409 with the projects) while projects have it turned on,
   * unless `force`: then it is turned off in those projects first. Their drawings are kept (ADR-0036 §9).
   * Side effects: audit `plugin.uninstalled`, and `project.plugin_disabled` on each affected project.
   */
  async uninstall(actor: PluginActor, id: string, version: string, force: boolean): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      // Installs and removals are serialised on the instance row.
      await tx.selectFrom("iam.instance").select("id").forUpdate().executeTakeFirstOrThrow();
      const row = await tx
        .selectFrom("plugin.package")
        .select(["sha256"])
        .where("plugin_id", "=", id)
        .where("version", "=", version)
        .executeTakeFirst();
      if (!row) throw new NotFoundException("that plugin version is not installed");
      const using = await tx
        .selectFrom("project.plugin as pp")
        .innerJoin("project.project as p", "p.id", "pp.project_id")
        .select(["p.id", "p.name"])
        .where("pp.plugin_id", "=", id)
        .where("pp.version", "=", version)
        .where("pp.enabled", "=", true)
        .where("p.deleted_at", "is", null)
        .execute();
      if (using.length > 0 && !force)
        throw new ConflictException({
          message: "projects use this plugin; confirm to turn it off in them and remove it",
          projects: using.map((p) => ({ id: p.id, name: p.name })),
        });
      for (const p of using) {
        await tx
          .updateTable("project.plugin")
          .set({ enabled: false, updated_by: actor.userId, updated_at: new Date() })
          .where("project_id", "=", p.id)
          .where("plugin_id", "=", id)
          .execute();
        await this.projects.logProject(
          actor,
          p.id,
          "project.plugin_disabled",
          { plugin: id, version, enabled: true },
          { plugin: id, version, enabled: false, reason: "uninstalled by an administrator" },
          tx,
        );
      }
      await tx
        .deleteFrom("plugin.package")
        .where("plugin_id", "=", id)
        .where("version", "=", version)
        .execute();
      await this.audit.append(
        {
          action: "plugin.uninstalled",
          objectType: "plugin",
          objectId: `${id}@${version}`,
          actorId: actor.userId,
          actorIpHash: actor.ipHash,
          requestId: actor.requestId,
          before: { id, version, sha256: row.sha256 },
          after: { turnedOffIn: using.map((p) => p.id) },
        },
        tx,
      );
    });
  }

  /** Purpose: trust a publisher's public key. Admins and Owners. Audit `plugin.key_added`. */
  async addKey(actor: PluginActor, name: string, publicKey: string) {
    let fingerprint: string;
    try {
      fingerprint = parsePublicKey(publicKey).fingerprint;
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    return this.db.transaction().execute(async (tx) => {
      const dup = await tx
        .selectFrom("plugin.trusted_key")
        .select("name")
        .where("fingerprint", "=", fingerprint)
        .executeTakeFirst();
      if (dup) throw new ConflictException(`this key is already trusted as "${dup.name}"`);
      const k = await tx
        .insertInto("plugin.trusted_key")
        .values({ name, public_key: publicKey.trim(), fingerprint, added_by: actor.userId })
        .returning(["id", "name", "fingerprint", "added_at"])
        .executeTakeFirstOrThrow();
      await this.audit.append(
        {
          action: "plugin.key_added",
          objectType: "plugin_key",
          objectId: k.id,
          actorId: actor.userId,
          actorIpHash: actor.ipHash,
          requestId: actor.requestId,
          after: { name, fingerprint },
        },
        tx,
      );
      return { id: k.id, name: k.name, fingerprint: k.fingerprint, addedAt: k.added_at.toISOString() };
    });
  }

  /**
   * Purpose: stop trusting a key. Installed plugins it signed stay installed; new packages signed with it are
   * refused. Audit `plugin.key_removed`.
   */
  async removeKey(actor: PluginActor, id: string): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      const k = await tx
        .deleteFrom("plugin.trusted_key")
        .where("id", "=", id)
        .returning(["name", "fingerprint"])
        .executeTakeFirst();
      if (!k) throw new NotFoundException("no such key");
      await this.audit.append(
        {
          action: "plugin.key_removed",
          objectType: "plugin_key",
          objectId: id,
          actorId: actor.userId,
          actorIpHash: actor.ipHash,
          requestId: actor.requestId,
          before: { name: k.name, fingerprint: k.fingerprint },
        },
        tx,
      );
    });
  }

  /**
   * Purpose: allow or refuse unsigned plugins (product owner, 2026-11-02: an Owner, only in development mode).
   * Side effects: audit `instance.plugin_unsigned_updated`.
   */
  async setAllowUnsigned(actor: PluginActor, allow: boolean): Promise<void> {
    if (actor.role !== "owner") throw new ForbiddenException("only an Owner can allow unsigned plugins");
    if (allow && !this.config.developmentMode)
      throw new ConflictException("unsigned plugins can only be allowed in development mode");
    await this.db.transaction().execute(async (tx) => {
      const before = await tx
        .selectFrom("iam.instance")
        .select("allow_unsigned_plugins")
        .forUpdate()
        .executeTakeFirstOrThrow();
      await tx
        .updateTable("iam.instance")
        .set({ allow_unsigned_plugins: allow, updated_at: new Date() })
        .execute();
      await this.audit.append(
        {
          action: "instance.plugin_unsigned_updated",
          objectType: "instance",
          actorId: actor.userId,
          actorIpHash: actor.ipHash,
          requestId: actor.requestId,
          before: { allow_unsigned_plugins: before.allow_unsigned_plugins },
          after: { allow_unsigned_plugins: allow },
        },
        tx,
      );
    });
  }

  /**
   * Purpose: the plugins a project can use, with whether each is on and which version. Any member may read it;
   * bundled plugins are on unless the Owner turned them off, installed ones are off until the Owner turns them on.
   */
  async forProject(actor: ProjectActor, projectId: string): Promise<ProjectPlugin[]> {
    await this.projects.access(actor, projectId, "read");
    return this.projectList(this.db, projectId);
  }

  /**
   * Purpose: turn a plugin on or off for a project, and pin the version of an installed plugin. Project Owners.
   * Inputs: `version` for installed plugins (default: the newest installed version); omitted for bundled ones.
   * Refused when the version is not installed, a plugin it depends on is off in the project, or another plugin
   * that is on depends on it. Side effects: audit `project.plugin_enabled` / `project.plugin_disabled`.
   */
  async setForProject(
    actor: ProjectActor,
    projectId: string,
    pluginId: string,
    enabled: boolean,
    version?: string,
  ): Promise<ProjectPlugin[]> {
    return this.db.transaction().execute(async (tx) => {
      await this.projects.access(actor, projectId, "manage", tx, true);
      const list = await this.projectList(tx, projectId);
      const cur = list.find((p) => p.id === pluginId);
      if (!cur) throw new NotFoundException("that plugin is not installed");
      let pinned: string | null = null;
      if (cur.bundled) {
        if (version !== undefined && version !== cur.version)
          throw new BadRequestException("bundled plugins come in the version of this MobSimLab");
      } else {
        pinned = version ?? (cur.missing || !cur.enabled ? latest(cur.versions) : cur.version) ?? null;
        if (!pinned || !cur.versions.includes(pinned))
          throw new BadRequestException(
            `version ${version ?? ""} of ${pluginId} is not installed`.replace("  ", " "),
          );
      }
      if (enabled) {
        const deps = cur.bundled
          ? {}
          : ((
              (
                await tx
                  .selectFrom("plugin.package")
                  .select("manifest")
                  .where("plugin_id", "=", pluginId)
                  .where("version", "=", pinned!)
                  .executeTakeFirstOrThrow()
              ).manifest as { dependsOn?: Record<string, string> }
            ).dependsOn ?? {});
        for (const [dep, range] of Object.entries(deps)) {
          const d = list.find((p) => p.id === dep);
          if (!d || !d.enabled || !satisfies(d.version, range))
            throw new ConflictException(`turn on ${d?.name ?? dep} ${range} in this project first`);
        }
      } else {
        const needs = await this.dependents(tx, list, pluginId);
        if (needs.length)
          throw new ConflictException(`${needs.join(", ")} needs this plugin; turn it off first`);
      }
      const before = { plugin: pluginId, version: cur.version, enabled: cur.enabled };
      const after = { plugin: pluginId, version: pinned ?? cur.version, enabled };
      await tx
        .insertInto("project.plugin")
        .values({
          project_id: projectId,
          plugin_id: pluginId,
          enabled,
          version: pinned,
          updated_by: actor.userId,
          updated_at: new Date(),
        })
        .onConflict((oc) =>
          oc.columns(["project_id", "plugin_id"]).doUpdateSet({
            enabled,
            version: pinned,
            updated_by: actor.userId,
            updated_at: new Date(),
          }),
        )
        .execute();
      await tx
        .updateTable("project.project")
        .set({ updated_at: new Date() })
        .where("id", "=", projectId)
        .execute();
      await this.projects.logProject(
        actor,
        projectId,
        enabled ? "project.plugin_enabled" : "project.plugin_disabled",
        before,
        after,
        tx,
      );
      return this.projectList(tx, projectId);
    });
  }

  // ---------------------------------------------------------------------------------------------------------

  /** Names of the plugins that are on in the project and depend on `pluginId`. */
  private async dependents(db: Database, list: ProjectPlugin[], pluginId: string): Promise<string[]> {
    const on = list.filter((p) => p.enabled && !p.bundled && p.id !== pluginId);
    if (on.length === 0) return [];
    const rows = await db
      .selectFrom("plugin.package")
      .select(["plugin_id", "version", "manifest"])
      .where(
        "plugin_id",
        "in",
        on.map((p) => p.id),
      )
      .execute();
    return on
      .filter((p) => {
        const r = rows.find((x) => x.plugin_id === p.id && x.version === p.version);
        return r && pluginId in ((r.manifest as { dependsOn?: Record<string, string> }).dependsOn ?? {});
      })
      .map((p) => p.name);
  }

  private async projectList(db: Database, projectId: string): Promise<ProjectPlugin[]> {
    const [rows, pkgs] = await Promise.all([
      db.selectFrom("project.plugin").selectAll().where("project_id", "=", projectId).execute(),
      db.selectFrom("plugin.package").select(["plugin_id", "version", "entry"]).execute(),
    ]);
    const choice = new Map(rows.map((r) => [r.plugin_id, r]));
    const out: ProjectPlugin[] = BUNDLED.map((e) => ({
      id: e.id,
      name: e.name,
      description: e.description,
      publisher: e.publisher,
      bundled: true,
      enabled: choice.get(e.id)?.enabled ?? true,
      version: e.version,
      versions: [],
      permissions: e.permissions,
      contributes: contributions(e),
      missing: false,
    }));
    const byId = new Map<string, { version: string; entry: PluginEntry }[]>();
    for (const p of pkgs)
      byId.set(p.plugin_id, [
        ...(byId.get(p.plugin_id) ?? []),
        { version: p.version, entry: p.entry as PluginEntry },
      ]);
    const ids = new Set([...byId.keys(), ...rows.filter((r) => r.version !== null).map((r) => r.plugin_id)]);
    for (const id of [...ids].sort()) {
      if (BUNDLED.some((b) => b.id === id)) continue;
      const versions = (byId.get(id) ?? []).map((v) => v.version).sort(compareVersions);
      const row = choice.get(id);
      const wanted = row?.version ?? latest(versions);
      const found =
        byId.get(id)?.find((v) => v.version === wanted) ??
        byId.get(id)?.find((v) => v.version === latest(versions));
      const missing = Boolean(row?.version) && !versions.includes(row!.version!);
      if (!found && !row) continue;
      const e = found?.entry;
      const enabled = Boolean(row?.enabled) && !missing;
      out.push({
        id,
        name: e?.name ?? id,
        description: e?.description ?? "",
        publisher: e?.publisher ?? { name: "" },
        bundled: false,
        enabled,
        version: wanted ?? "",
        versions,
        permissions: e?.permissions ?? [],
        contributes: e
          ? contributions(e)
          : { modes: [], tools: [], parameters: 0, calculations: [], mapLayers: [] },
        missing,
        ...(enabled && e ? { entry: e } : {}),
      });
    }
    return out;
  }

  /** Projects using each plugin version (`id@version`; bundled plugins `id@`). */
  private async usage(): Promise<Map<string, number>> {
    const rows = await this.db
      .selectFrom("project.plugin as pp")
      .innerJoin("project.project as p", "p.id", "pp.project_id")
      .select(["pp.plugin_id", "pp.version", "pp.enabled"])
      .where("p.deleted_at", "is", null)
      .execute();
    const live = await this.db
      .selectFrom("project.project")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("deleted_at", "is", null)
      .executeTakeFirstOrThrow();
    const out = new Map<string, number>();
    for (const r of rows)
      if (r.enabled)
        out.set(`${r.plugin_id}@${r.version ?? ""}`, (out.get(`${r.plugin_id}@${r.version ?? ""}`) ?? 0) + 1);
    // Bundled plugins are on in every project that did not turn them off.
    for (const b of BUNDLED) {
      const off = rows.filter((r) => r.plugin_id === b.id && !r.enabled).length;
      out.set(`${b.id}@`, Number(live.n) - off);
    }
    return out;
  }

  private trustedKeys(db: Database) {
    return db.selectFrom("plugin.trusted_key").select(["id", "name", "public_key"]).execute();
  }

  /** Unpack, check checksums, signature and contents, and decide whether the trust policy lets it in. */
  private async check(actor: PluginActor, buf: Buffer, db: Database) {
    const problems: string[] = [];
    const hash = sha256(buf);
    const fail = (message: string) => ({
      inspection: {
        plugin: null,
        signature: null,
        signer: null,
        sha256: hash,
        problems: [message],
      } as Inspection,
      entry: null,
      manifest: null,
      sig: null,
    });
    let files: Map<string, Buffer>;
    try {
      files = unzip(buf);
      checkChecksums(files);
    } catch (e) {
      if (e instanceof PackageError) return fail(e.message);
      throw e;
    }
    const [keys, installed, inst] = await Promise.all([
      this.trustedKeys(db),
      db.selectFrom("plugin.package").select(["plugin_id", "version", "entry"]).execute(),
      db.selectFrom("iam.instance").select("allow_unsigned_plugins").executeTakeFirstOrThrow(),
    ]);
    const sig = checkSignature(
      files,
      keys.map((k) => ({ id: k.id, name: k.name, publicKey: k.public_key })),
    );
    const others: OtherPlugin[] = [
      ...BUNDLED.map(claims),
      ...installed.map((r) => claims(r.entry as PluginEntry)),
    ];
    const result = checkPlugin(files, others);
    if (!result.ok) problems.push(...result.errors);
    const entry = result.ok ? result.entry : null;
    if (entry) {
      if (BUNDLED.some((b) => b.id === entry.id))
        problems.push(`${entry.id} ships with MobSimLab and cannot be installed again`);
      if (installed.some((r) => r.plugin_id === entry.id && r.version === entry.version))
        problems.push(`${entry.id} ${entry.version} is already installed`);
    }
    const unsignedOk = this.config.developmentMode && inst.allow_unsigned_plugins && actor.role === "owner";
    if (sig.status === "unsigned" && !unsignedOk)
      problems.push("the package is not signed; ask the publisher for a signed package");
    if (sig.status === "untrusted" && !unsignedOk)
      problems.push(
        "the package is signed with a key this instance does not trust; add the publisher's key first",
      );
    const manifest = result.ok ? result.manifest : null;
    return {
      inspection: {
        plugin: entry
          ? { ...summary(entry, (manifest?.dependsOn ?? {}) as Record<string, string>), projects: 0 }
          : null,
        signature: sig.status,
        signer: sig.status === "trusted" ? sig.keyName : null,
        sha256: hash,
        problems,
      } satisfies Inspection,
      entry,
      manifest,
      sig,
    };
  }
}
