import Ajv2020 from "ajv/dist/2020";
import { parse as parseYaml } from "yaml";
import CORE from "./core.generated.json";

/** MobSimLab version a plugin's `engines.mobsimlab` range is checked against (apps/api/package.json). */
export const MOBSIMLAB_VERSION = "0.1.0";

/** Where a plugin's manifest is in its package. */
export const MANIFEST = "mobsimlab-plugin.json";

/**
 * Licences a plugin's code and data may use until the legal check of ADR-0036 (Consequences): the licence
 * gate's list (tools/license-gate/policy.json), which holds only AGPL-compatible licences.
 */
export const ALLOWED_LICENCES = new Set([
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BSL-1.0",
  "CC0-1.0",
  "CC-BY-4.0",
  "ISC",
  "MIT",
  "MIT-0",
  "MPL-2.0",
  "PSF-2.0",
  "PostgreSQL",
  "Python-2.0",
  "Unicode-3.0",
  "Unicode-DFS-2016",
  "Unlicense",
  "Zlib",
  "BlueOak-1.0.0",
  "LGPL-2.1-or-later",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
  "GPL-2.0-or-later",
  "GPL-3.0-only",
  "GPL-3.0-or-later",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
]);

/** A transport mode a plugin contributes (contracts/plugin-mode.schema.json). */
export interface PluginMode {
  id: string;
  label: string;
  kit: string;
  contextKey?: string;
  contexts?: string[];
  defaultContext?: string;
  [k: string]: unknown;
}

/** Low, central and high value of a parameter. */
export interface Range {
  low: unknown;
  central: unknown;
  high: unknown;
}

/** One plugin as the web app's registry needs it (the same shape tools/plugins/check.py renders). */
export interface PluginEntry {
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
  modes: PluginMode[];
  contexts: { key: string; label: string; options: { id: string; label: string }[] }[];
  tools: { id: string; label: string; hint?: string; kit: string; modes: string[] }[];
  calculations: unknown[];
  importers?: unknown[];
  exporters?: unknown[];
  /** Project tabs (bundled plugins only); the web app ships each tab's view. */
  tabs: { id: string; label: string; view: string; calculations: string[] }[];
  mapLayers: unknown[];
  parameters: Record<string, { label: string; unit: string }>;
  defaults: Record<string, Record<string, Record<string, Range>>>;
}

/** The core's own ids and the bundled plugins, from tools/plugins/check.py --render. */
export const BUNDLED: readonly PluginEntry[] = CORE.bundled as unknown as PluginEntry[];

/** What a new plugin must not clash with: the bundled plugins and the other installed ones. */
export interface OtherPlugin {
  id: string;
  version: string;
  modes: string[];
  parameters: string[];
}

/** Purpose: what a plugin entry adds that others must not reuse. */
export function claims(p: PluginEntry): OtherPlugin {
  return {
    id: p.id,
    version: p.version,
    modes: p.modes.map((m) => m.id),
    parameters: Object.keys(p.parameters),
  };
}

const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
const validateManifest = ajv.compile(CORE.manifestSchema);
const validateMode = ajv.compile(CORE.modeSchema);

type Ctx = Record<string, unknown>;
type Param = { key?: string; values?: Record<string, unknown>[]; [k: string]: unknown };

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : [v]);
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Purpose: order two SemVer versions (pre-releases before their release). Output: negative, 0 or positive. */
export function compareVersions(a: string, b: string): number {
  const [ma = "", pa] = a.split(/-(.*)/s);
  const [mb = "", pb] = b.split(/-(.*)/s);
  const x = ma.split(".").map(Number);
  const y = mb.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  if (pa === pb) return 0;
  if (pa === undefined) return 1;
  if (pb === undefined) return -1;
  return pa < pb ? -1 : 1;
}

/**
 * Purpose: compare a SemVer version with a range of space-separated comparators, such as ">=0.1 <1"
 * (missing minor and patch count as 0). Output: true when every comparator holds.
 */
export function satisfies(version: string, range: string): boolean {
  const nums = (v: string) => {
    const [a = 0, b = 0, c = 0] = v.split("-")[0]!.split(".").map(Number);
    return [a, b, c];
  };
  const cmp = (x: number[], y: number[]) => x[0]! - y[0]! || x[1]! - y[1]! || x[2]! - y[2]!;
  const v = nums(version);
  const parts = range.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every((p) => {
    const m = /^(>=|<=|>|<|=|\^|~)?(\d+(?:\.\d+){0,2})$/.exec(p);
    if (!m) return false;
    const op = m[1] ?? "=";
    const w = nums(m[2]!);
    const c = cmp(v, w);
    switch (op) {
      case ">=":
        return c >= 0;
      case "<=":
        return c <= 0;
      case ">":
        return c > 0;
      case "<":
        return c < 0;
      case "^":
        return c >= 0 && (w[0]! > 0 ? v[0] === w[0] : v[0] === 0 && v[1] === w[1]);
      case "~":
        return c >= 0 && v[0] === w[0] && v[1] === w[1];
      default:
        return c === 0;
    }
  });
}

/** Specificity of a value entry for (mode, key=option), or null when it does not apply (check.py `matches`). */
function matches(ctx: Ctx, mode: string, key: string | null, option: string | null): number | null {
  let score = 0;
  const modes = asList(ctx.mode ?? "*");
  if (!modes.includes("*")) {
    if (!modes.includes(mode)) return null;
    score += 1;
  }
  for (const [k, v] of Object.entries(ctx)) {
    if (k === "mode") continue;
    if (k !== key || !asList(v).includes(option)) return null;
    score += 1;
  }
  return score;
}

/** Most specific entry for a mode and context option; the first of equally specific ones (check.py `resolve`). */
function resolve(p: Param, mode: string, key: string | null, option: string | null): Record<string, unknown> {
  let best: Record<string, unknown> | null = null;
  let bestScore = -1;
  for (const v of p.values ?? []) {
    const s = matches((v.context as Ctx) ?? {}, mode, key, option);
    if (s !== null && s > bestScore) {
      best = v;
      bestScore = s;
    }
  }
  if (!best) throw new Error(`${p.key}: no entry for ${mode}`);
  return best;
}

const BASES = ["cited", "documented", "educated-guess"];
const CHECKS = ["read", "secondary", "unverified"];
const ACCESS = ["free", "paywalled", "on-request"];
const CHECKED_VIA = ["direct", "search-snippet", "none"];
const SOURCE_FIELDS = new Set([
  "id",
  "title",
  "publisher",
  "url",
  "licence",
  "access",
  "retrieved",
  "checked_via",
  "kind",
  "note",
]);
const PARAM_FIELDS = new Set(["key", "label", "group", "unit", "kind", "options", "used_by", "values"]);
const VALUE_FIELDS = new Set(["context", "low", "central", "high", "basis", "sources", "check", "rationale"]);
const show = (v: unknown) => JSON.stringify(v);

/**
 * Purpose: the assumption library's rules (ADR-0018, tools/assumptions/check.py `validate`) for a plugin's
 * sources and parameters, with the plugin's modes added to the core's.
 * Output: error messages; `used` collects the source ids the parameters cite.
 */
function validateAssumptions(
  sources: Record<string, Record<string, unknown>>,
  params: Param[],
  modes: ReadonlySet<string>,
  used: Set<string>,
): string[] {
  const errors: string[] = [];
  for (const [sid, s] of Object.entries(sources)) {
    const extra = Object.keys(s).filter((k) => !SOURCE_FIELDS.has(k));
    if (extra.length) errors.push(`source ${sid}: unknown fields ${show(extra.sort())}`);
    for (const f of ["title", "url", "licence", "access", "retrieved", "checked_via"])
      if (!s[f]) errors.push(`source ${sid}: missing ${f}`);
    if (!ACCESS.includes(s.access as string))
      errors.push(`source ${sid}: access must be one of ${show(ACCESS)}`);
    if (!CHECKED_VIA.includes(s.checked_via as string))
      errors.push(`source ${sid}: checked_via must be one of ${show(CHECKED_VIA)}`);
    if (s.kind !== undefined && s.kind !== "primary" && s.kind !== "secondary")
      errors.push(`source ${sid}: kind must be primary or secondary`);
  }
  const seen = new Set<string>();
  for (const p of params) {
    const key = typeof p.key === "string" ? p.key : "<no key>";
    if (seen.has(key)) errors.push(`${key}: defined twice`);
    seen.add(key);
    const extra = Object.keys(p).filter((k) => !PARAM_FIELDS.has(k));
    if (extra.length) errors.push(`${key}: unknown fields ${show(extra.sort())}`);
    for (const f of ["label", "group", "unit", "used_by", "values"]) {
      const v = p[f];
      if (!v || (Array.isArray(v) && v.length === 0)) errors.push(`${key}: missing ${f}`);
    }
    if (!Array.isArray(p.values)) continue;
    if (Array.isArray(p.used_by) && p.used_by.some((u) => typeof u !== "string"))
      errors.push(`${key}: used_by entries must be strings`);
    const kind = (p.kind as string | undefined) ?? "number";
    const options = Array.isArray(p.options) ? p.options : [];
    if (kind === "enum" && options.length === 0) errors.push(`${key}: enum without options`);
    let hasGlobal = false;
    const seenCtx = new Set<string>();
    for (const v of p.values) {
      if (!isRecord(v)) {
        errors.push(`${key}: every value must be a mapping`);
        continue;
      }
      const ctx = (isRecord(v.context) ? v.context : {}) as Ctx;
      const id = show(
        Object.entries(ctx)
          .map(([k, x]) => [k, asList(x)])
          .sort(),
      );
      const where = `${key} ${show(ctx)}`;
      if (seenCtx.has(id)) errors.push(`${where}: duplicate context`);
      seenCtx.add(id);
      if (Object.keys(ctx).length === 1 && ctx.mode === "*") hasGlobal = true;
      for (const m of asList(ctx.mode ?? "*"))
        if (m !== "*" && !modes.has(m as string)) errors.push(`${where}: unknown mode ${String(m)}`);
      for (const t of asList(ctx.traction ?? []))
        if (!CORE.tractions.includes(t as string)) errors.push(`${where}: unknown traction ${String(t)}`);
      const extraV = Object.keys(v).filter((k) => !VALUE_FIELDS.has(k));
      if (extraV.length) errors.push(`${where}: unknown fields ${show(extraV.sort())}`);
      if (!BASES.includes(v.basis as string)) errors.push(`${where}: basis must be one of ${show(BASES)}`);
      if (!CHECKS.includes(v.check as string)) errors.push(`${where}: check must be one of ${show(CHECKS)}`);
      if (!v.rationale) errors.push(`${where}: missing rationale`);
      const srcs = Array.isArray(v.sources) ? v.sources : [];
      if (srcs.length === 0) errors.push(`${where}: no sources`);
      for (const sid of srcs) {
        used.add(String(sid));
        if (!(String(sid) in sources) && !CORE.coreSourceIds.includes(String(sid)))
          errors.push(`${where}: unknown source ${String(sid)}`);
      }
      if (!("central" in v)) errors.push(`${where}: missing central`);
      if (kind === "number") {
        const nums = (["low", "central", "high"] as const)
          .map((k) => v[k])
          .filter((n) => n !== undefined && n !== null);
        if (nums.some((n) => typeof n !== "number"))
          errors.push(`${where}: low/central/high must be numbers`);
        else if (
          v.low !== undefined &&
          v.low !== null &&
          v.high !== undefined &&
          v.high !== null &&
          !((v.low as number) <= (v.central as number) && (v.central as number) <= (v.high as number))
        )
          errors.push(`${where}: needs low <= central <= high`);
      }
      if (kind === "enum")
        for (const k of ["low", "central", "high"])
          if (v[k] !== undefined && v[k] !== null && !options.includes(v[k]))
            errors.push(`${where}: ${k}=${show(v[k])} not in options`);
    }
    if (!hasGlobal) errors.push(`${key}: no global fallback entry (context mode '*')`);
  }
  return errors;
}

/** Result of checking a plugin: errors for the Admin, or the registry entry. */
export type CheckResult =
  { ok: true; manifest: Record<string, unknown>; entry: PluginEntry } | { ok: false; errors: string[] };

/**
 * Purpose: check a plugin package's contents with the same rules as tools/plugins/check.py (ADR-0036 §2, §3,
 * ADR-0018), plus what an uploaded plugin needs (§9): its licences are allowed, it fits this MobSimLab version,
 * it is not marked bundled, it brings data only (code runs only in bundled plugins until the sandbox exists),
 * and it does not reuse a mode or parameter of the core, a bundled plugin or another installed plugin.
 * Inputs: path → bytes; the plugins it must not clash with (other versions of the same id are ignored);
 * `bundled` true only when checking the image's own plugins. Output: the registry entry or the errors.
 */
export function checkPlugin(
  files: ReadonlyMap<string, Buffer>,
  others: readonly OtherPlugin[],
  options: { bundled?: boolean } = {},
): CheckResult {
  const errors: string[] = [];
  const text = (path: string): string | null => {
    const b = files.get(path);
    if (!b) {
      errors.push(`${path} does not exist`);
      return null;
    }
    return b.toString("utf8");
  };
  const json = (path: string): unknown => {
    const t = text(path);
    if (t === null) return null;
    try {
      return JSON.parse(t);
    } catch {
      errors.push(`${path} is not valid JSON`);
      return null;
    }
  };
  const yaml = (path: string): unknown[] => {
    const t = text(path);
    if (t === null) return [];
    try {
      const v = parseYaml(t, { maxAliasCount: 50 }) as unknown;
      if (v === null || v === undefined) return [];
      if (!Array.isArray(v)) {
        errors.push(`${path} must be a list`);
        return [];
      }
      return v;
    } catch (e) {
      errors.push(`${path} is not valid YAML: ${(e as Error).message.split("\n")[0]}`);
      return [];
    }
  };

  const manifest = json(MANIFEST);
  if (!isRecord(manifest))
    return { ok: false, errors: errors.length ? errors : [`${MANIFEST} must be an object`] };
  if (!validateManifest(manifest)) {
    for (const e of validateManifest.errors ?? [])
      errors.push(`${MANIFEST}: ${e.instancePath || "/"}: ${e.message}`);
    return { ok: false, errors };
  }
  const m = manifest as {
    id: string;
    name: string;
    description?: string;
    version: string;
    publisher: { name: string; url?: string };
    license: string;
    dataLicense: string;
    engines: { mobsimlab: string };
    bundled?: boolean;
    tiers: string[];
    permissions: string[];
    dependsOn?: Record<string, string>;
    contributes: {
      modes?: { id: string; file: string }[];
      contexts?: PluginEntry["contexts"];
      parameters?: { file: string }[];
      sources?: { file: string }[];
      vehicles?: { dir: string }[];
      tools?: PluginEntry["tools"];
      calculations?: { id: string }[];
      importers?: { id: string }[];
      exporters?: { id: string }[];
      tabs?: PluginEntry["tabs"];
      mapLayers?: { id: string; calculation: string; style: string }[];
    };
  };
  const pid = m.id;
  const c = m.contributes;

  if (!options.bundled) {
    if (m.bundled) errors.push(`${pid}: only plugins that ship with MobSimLab may say "bundled"`);
    for (const t of m.tiers)
      if (t !== "data")
        errors.push(
          `${pid}: the ${t} tier is not supported for installed plugins yet; only data plugins can be installed`,
        );
    if (c.calculations?.length)
      errors.push(`${pid}: only bundled plugins may contribute calculations for now`);
    if (c.importers?.length || c.exporters?.length)
      errors.push(`${pid}: only bundled plugins may contribute importers and exporters for now`);
    if (c.tabs?.length) errors.push(`${pid}: only bundled plugins may contribute tabs for now`);
    if (m.publisher.url !== undefined && !/^https:\/\/[^\s]+$/.test(m.publisher.url))
      errors.push(`${pid}: the publisher URL must start with https://`);
    for (const [what, lic] of [
      ["licence", m.license],
      ["data licence", m.dataLicense],
    ] as const)
      if (!ALLOWED_LICENCES.has(lic)) errors.push(`${pid}: the ${what} ${lic} is not on the allowed list`);
    if (!satisfies(MOBSIMLAB_VERSION, m.engines.mobsimlab))
      errors.push(`${pid}: made for MobSimLab ${m.engines.mobsimlab}, this is ${MOBSIMLAB_VERSION}`);
    for (const [dep, range] of Object.entries(m.dependsOn ?? {})) {
      const found = others.filter((o) => o.id === dep);
      if (!found.some((o) => satisfies(o.version, range)))
        errors.push(`${pid}: needs ${dep} ${range}, which is not installed`);
    }
  }
  const rivals = others.filter((o) => o.id !== pid);

  const contexts = new Map((c.contexts ?? []).map((x) => [x.key, x]));
  const modes: PluginMode[] = [];
  for (const item of c.modes ?? []) {
    const mode = json(item.file);
    if (mode === null) continue;
    if (!validateMode(mode)) {
      for (const e of validateMode.errors ?? [])
        errors.push(`${pid}: ${item.file}: ${e.instancePath || "/"}: ${e.message}`);
      continue;
    }
    const md = mode as PluginMode;
    if (md.id !== item.id) errors.push(`${pid}: ${item.file} has id ${md.id}, the manifest says ${item.id}`);
    if (CORE.coreModes.includes(item.id)) errors.push(`${pid}: mode ${item.id} is a core mode`);
    const owner = rivals.find((o) => o.modes.includes(item.id));
    if (owner) errors.push(`${pid}: mode ${item.id} is also contributed by ${owner.id}`);
    if (modes.some((x) => x.id === item.id)) errors.push(`${pid}: mode ${item.id} is listed twice`);
    const key = md.contextKey;
    if (key) {
      const ctx = contexts.get(key);
      const opts = new Set((ctx?.options ?? []).map((o) => o.id));
      if (!ctx)
        errors.push(`${pid}: mode ${item.id} uses context key ${key}, which the plugin does not declare`);
      for (const o of md.contexts ?? [])
        if (!opts.has(o))
          errors.push(`${pid}: mode ${item.id}: context option ${o} is not an option of ${key}`);
      if (!(md.contexts ?? []).includes(md.defaultContext ?? ""))
        errors.push(`${pid}: mode ${item.id}: defaultContext must be one of its contexts`);
    }
    modes.push(md);
  }
  const kits = new Map(modes.map((x) => [x.id, x.kit]));
  for (const t of c.tools ?? [])
    for (const mid of t.modes) {
      if (!kits.has(mid))
        errors.push(`${pid}: tool ${t.id} draws ${mid}, which the plugin does not contribute`);
      else if (kits.get(mid) !== t.kit)
        errors.push(`${pid}: tool ${t.id} uses kit ${t.kit}, mode ${mid} needs ${kits.get(mid)}`);
    }

  const calcIds = new Set((c.calculations ?? []).map((x) => x.id));
  const layers: unknown[] = [];
  for (const layer of c.mapLayers ?? []) {
    if (!calcIds.has(layer.calculation))
      errors.push(`${pid}: map layer ${layer.id} uses unknown calculation ${layer.calculation}`);
    const style = json(layer.style);
    if (style !== null) layers.push({ ...layer, style });
  }
  for (const v of c.vehicles ?? [])
    if (![...files.keys()].some((p) => p.startsWith(v.dir))) errors.push(`${pid}: ${v.dir} does not exist`);

  const sources: Record<string, Record<string, unknown>> = {};
  for (const item of c.sources ?? [])
    for (const s of yaml(item.file)) {
      if (!isRecord(s) || typeof s.id !== "string") {
        errors.push(`${pid}: ${item.file}: every source needs an id`);
        continue;
      }
      if (CORE.coreSourceIds.includes(s.id) || s.id in sources)
        errors.push(`${pid}: source ${s.id} is defined twice`);
      const { id, ...rest } = s;
      sources[id as string] = rest;
    }
  const params: Param[] = [];
  for (const item of c.parameters ?? [])
    for (const p of yaml(item.file)) {
      if (isRecord(p)) params.push(p as Param);
      else errors.push(`${pid}: ${item.file}: every parameter must be a mapping`);
    }
  const used = new Set<string>();
  const modeIds = new Set([...CORE.coreModes, ...modes.map((x) => x.id)]);
  errors.push(...validateAssumptions(sources, params, modeIds, used).map((e) => `${pid}: ${e}`));
  const allowed = new Set(["mode", "traction", ...contexts.keys()]);
  for (const p of params) {
    if (CORE.coreParameterKeys.includes(p.key ?? "")) errors.push(`${pid}: ${p.key} is a core parameter`);
    const owner = rivals.find((o) => o.parameters.includes(p.key ?? ""));
    if (owner) errors.push(`${pid}: ${p.key} is also a parameter of ${owner.id}`);
    for (const v of p.values ?? [])
      for (const [k, val] of Object.entries(isRecord(v.context) ? v.context : {})) {
        if (!allowed.has(k)) errors.push(`${pid}: ${p.key}: unknown context key ${k}`);
        else if (contexts.has(k)) {
          const opts = new Set(contexts.get(k)!.options.map((o) => o.id));
          for (const o of asList(val))
            if (!opts.has(o as string))
              errors.push(`${pid}: ${p.key}: ${String(o)} is not an option of ${k}`);
        }
      }
  }
  for (const sid of Object.keys(sources).sort())
    if (!used.has(sid)) errors.push(`${pid}: source ${sid} defined but never used`);
  if (errors.length) return { ok: false, errors };

  const defaults: PluginEntry["defaults"] = {};
  try {
    for (const md of modes) {
      const key = md.contextKey ?? null;
      const per: Record<string, Record<string, Range>> = {};
      for (const o of md.contexts ?? [null]) {
        per[o ?? "*"] = Object.fromEntries(
          params.map((p) => {
            const r = resolve(p, md.id, key, o);
            return [p.key!, { low: r.low, central: r.central, high: r.high }];
          }),
        );
      }
      defaults[md.id] = per;
    }
    // A plugin without modes of its own (a calculation) gives values per core mode, so the app can
    // resolve them for each line of the project.
    if (!modes.length && params.length)
      for (const mid of CORE.coreModes)
        defaults[mid] = {
          "*": Object.fromEntries(
            params.map((p) => {
              const r = resolve(p, mid, null, null);
              return [p.key!, { low: r.low, central: r.central, high: r.high }];
            }),
          ),
        };
  } catch (e) {
    return { ok: false, errors: [`${pid}: ${(e as Error).message}`] };
  }
  const entry: PluginEntry = {
    id: pid,
    name: m.name,
    description: m.description ?? "",
    version: m.version,
    publisher: m.publisher,
    license: m.license,
    dataLicense: m.dataLicense,
    bundled: m.bundled ?? false,
    tiers: m.tiers,
    permissions: m.permissions,
    modes,
    contexts: [...contexts.values()],
    tools: c.tools ?? [],
    calculations: c.calculations ?? [],
    importers: c.importers ?? [],
    exporters: c.exporters ?? [],
    tabs: c.tabs ?? [],
    mapLayers: layers,
    parameters: Object.fromEntries(
      params.map((p) => [p.key!, { label: p.label as string, unit: p.unit as string }]),
    ),
    defaults,
  };
  return { ok: true, manifest, entry };
}
