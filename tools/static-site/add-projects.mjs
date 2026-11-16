#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Add MobSimLab projects to a static viewer site (`pnpm build:static`).
 *
 *   node tools/add-projects.mjs                     unpack every .mslab file in the site's projects/ folder
 *   node tools/add-projects.mjs a.mslab b.mslab     the same, plus these files from anywhere
 *   node tools/add-projects.mjs --site ./site       the site folder (default: the folder above this script)
 *
 * Each file is checked (ZIP limits, safe names, the SHA-256 of every file against its manifest) and unpacked to
 * projects/<project id>/, and projects/index.json lists them; the viewer reads both. Run it again after adding or
 * removing a file. Needs Node.js 18 or later and nothing else.
 *
 * Cloudflare Pages serves files of up to 25 MiB. A .mslab file larger than that can be kept outside the site and
 * passed as an argument; the unpacked files are what the viewer reads.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

/** Same limits as the MobSimLab reader (apps/api/src/mslab/format.mts). */
const LIMITS = {
  zipBytes: 200 * 1024 * 1024,
  entries: 5000,
  fileBytes: 70 * 1024 * 1024,
  totalBytes: 512 * 1024 * 1024,
  maxRatio: 500,
};
/** Largest file Cloudflare Pages serves. */
const CLOUDFLARE_FILE_BYTES = 25 * 1024 * 1024;
/** Files a .mslab file may hold (apps/api/src/mslab/format.mts FILES and FILE_PATTERNS). */
const ALLOWED = [
  /^manifest\.json$/,
  /^project\.json$/,
  /^plugins\.json$/,
  /^ATTRIBUTION\.md$/,
  /^data\/[a-z][a-z0-9-]{1,39}\.json$/,
  /^runs\/[0-9a-f-]{36}\/(?:run\.json|network\.txt|lines\.txt|replay\.json\.gz)$/,
  /^map\/(?:(?:area|water|population|reference)\.json|(?:streets|walk|rail)\/\d{1,5}-\d{1,5}\.xml|(?:buildings|places|bike-amenities)\/\d{1,5}-\d{1,5}\.json)$/,
];
const UUID = /^[0-9a-fA-F-]{36}$/;
/** The format versions this viewer reads: 1.x up to 1.1. */
const READS = [1, 1];

class FileError extends Error {}

/** Purpose: the files of a ZIP, name → bytes, within the limits; throws FileError for anything unsafe. */
export function readZip(buf) {
  if (buf.length > LIMITS.zipBytes) throw new FileError(`larger than ${LIMITS.zipBytes / 1024 / 1024} MB`);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new FileError("not a ZIP file");
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count > LIMITS.entries) throw new FileError(`more than ${LIMITS.entries} files`);
  if (cdOffset + cdSize > buf.length) throw new FileError("damaged ZIP file");
  const out = new Map();
  let total = 0;
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new FileError("damaged ZIP file");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    p += 46 + nlen + xlen + clen;
    if (flags & 0x1) throw new FileError(`${name} is encrypted`);
    if (!ALLOWED.some((r) => r.test(name))) throw new FileError(`${name} is not a file a MobSimLab project file can hold`);
    if (out.has(name)) throw new FileError(`${name} is in the file twice`);
    if (usize > LIMITS.fileBytes) throw new FileError(`${name} is larger than ${LIMITS.fileBytes / 1024 / 1024} MB`);
    total += usize;
    if (total > LIMITS.totalBytes) throw new FileError(`unpacks to more than ${LIMITS.totalBytes / 1024 / 1024} MB`);
    if (csize > 0 && usize / csize > LIMITS.maxRatio) throw new FileError(`${name} looks like a ZIP bomb`);
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new FileError("damaged ZIP file");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const body = buf.subarray(start, start + csize);
    let data;
    if (method === 0) data = Buffer.from(body);
    else if (method === 8) {
      try {
        data = inflateRawSync(body, { maxOutputLength: Math.max(1, usize) });
      } catch {
        throw new FileError(`${name} cannot be unpacked`);
      }
    } else throw new FileError(`${name} uses an unsupported compression`);
    if (data.length !== usize) throw new FileError(`${name} is damaged`);
    out.set(name, data);
  }
  return out;
}

/** Purpose: check a .mslab file and return its files and project details; throws FileError when it is not one. */
export function checkMslab(buf) {
  const files = readZip(buf);
  const manifestBytes = files.get("manifest.json");
  if (!manifestBytes) throw new FileError("not a MobSimLab project file (no manifest.json)");
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw new FileError("manifest.json is not valid JSON");
  }
  if (manifest?.format !== "mslab" || typeof manifest.formatVersion !== "string")
    throw new FileError("not a MobSimLab project file");
  const v = /^(\d+)\.(\d+)\.(\d+)$/.exec(manifest.formatVersion);
  if (!v) throw new FileError("its format version is not valid");
  if (Number(v[1]) !== READS[0] || Number(v[2]) > READS[1])
    throw new FileError(`saved in format ${manifest.formatVersion}; this viewer reads 1.0 to 1.${READS[1]}`);
  const listed = manifest.files && typeof manifest.files === "object" ? manifest.files : {};
  for (const [name, bytes] of files) {
    if (name === "manifest.json") continue;
    const e = Object.hasOwn(listed, name) ? listed[name] : null;
    if (!e) throw new FileError(`${name} is in the file but not in its manifest`);
    if (e.bytes !== bytes.length || createHash("sha256").update(bytes).digest("hex") !== e.sha256)
      throw new FileError(`${name} does not match its checksum; the file was changed or damaged`);
  }
  for (const name of Object.keys(listed)) if (!files.has(name)) throw new FileError(`${name} is missing`);
  let project;
  try {
    project = JSON.parse(files.get("project.json")?.toString("utf8") ?? "null");
  } catch {
    project = null;
  }
  if (!project || typeof project.id !== "string" || !UUID.test(project.id) || typeof project.name !== "string")
    throw new FileError("project.json is missing or not valid");
  const runs = [...files.keys()].filter((n) => /^runs\/[0-9a-f-]{36}\/run\.json$/.test(n)).length;
  return { files, manifest, project, runs, map: [...files.keys()].some((n) => n.startsWith("map/")) };
}

function main(argv) {
  const here = dirname(fileURLToPath(import.meta.url));
  let site = resolve(here, "..");
  const inputs = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--site") site = resolve(argv[++i] ?? ".");
    else if (argv[i] === "-h" || argv[i] === "--help") {
      console.log("Usage: node add-projects.mjs [--site <site folder>] [file.mslab …]");
      return 0;
    } else inputs.push(resolve(argv[i]));
  }
  if (!existsSync(join(site, "index.html"))) {
    console.error(`${site} is not a static viewer site (no index.html); pass --site <folder>.`);
    return 1;
  }
  const projectsDir = join(site, "projects");
  mkdirSync(projectsDir, { recursive: true });
  const sources = [
    ...readdirSync(projectsDir)
      .filter((n) => n.toLowerCase().endsWith(".mslab"))
      .sort()
      .map((n) => join(projectsDir, n)),
    ...inputs.flatMap((p) =>
      statSync(p).isDirectory()
        ? readdirSync(p)
            .filter((n) => n.toLowerCase().endsWith(".mslab"))
            .sort()
            .map((n) => join(p, n))
        : [p],
    ),
  ];

  // The folders the last run made; only those are replaced or removed.
  const indexPath = join(projectsDir, "index.json");
  let before;
  try {
    before = JSON.parse(readFileSync(indexPath, "utf8")).projects ?? [];
  } catch {
    before = [];
  }
  const entries = [];
  let failed = 0;
  const warnings = [];
  for (const src of sources) {
    let checked;
    try {
      checked = checkMslab(readFileSync(src));
    } catch (e) {
      failed++;
      console.error(`✗ ${basename(src)}: ${e instanceof FileError ? e.message : String(e)}`);
      continue;
    }
    const { files, project, runs, map } = checked;
    const dir = project.id.toLowerCase();
    if (entries.some((x) => x.dir === dir)) {
      console.error(`✗ ${basename(src)}: project ${project.id} is already in the site from another file; skipped`);
      failed++;
      continue;
    }
    const tmp = join(projectsDir, `.${dir}.tmp`);
    rmSync(tmp, { recursive: true, force: true });
    for (const [name, bytes] of files) {
      const to = join(tmp, ...name.split("/"));
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, bytes);
      if (bytes.length > CLOUDFLARE_FILE_BYTES)
        warnings.push(`${dir}/${name} is ${(bytes.length / 1024 / 1024).toFixed(1)} MB, above Cloudflare's 25 MiB limit`);
    }
    rmSync(join(projectsDir, dir), { recursive: true, force: true });
    renameSync(tmp, join(projectsDir, dir));
    if (src.startsWith(projectsDir) && statSync(src).size > CLOUDFLARE_FILE_BYTES)
      warnings.push(`${basename(src)} is above Cloudflare's 25 MiB limit; move it out of the site before uploading`);
    entries.push({
      id: project.id,
      name: project.name,
      description: typeof project.description === "string" ? project.description : "",
      areaName: typeof project.areaName === "string" ? project.areaName : null,
      modes: Array.isArray(project.modes) ? project.modes.filter((m) => typeof m === "string") : [],
      createdAt: project.createdAt ?? null,
      updatedAt: project.updatedAt ?? null,
      dir,
      map,
      runs,
    });
    console.log(`✓ ${project.name} (${basename(src)})${map ? ", with map data" : ", no map data"}, ${runs} run${runs === 1 ? "" : "s"}`);
  }
  for (const old of before)
    if (typeof old?.dir === "string" && UUID.test(old.dir) && !entries.some((e) => e.dir === old.dir))
      rmSync(join(projectsDir, old.dir), { recursive: true, force: true });
  writeFileSync(indexPath, `${JSON.stringify({ projects: entries }, null, 1)}\n`);
  for (const w of warnings) console.warn(`! ${w}`);
  console.log(`${entries.length} project${entries.length === 1 ? "" : "s"} in ${projectsDir}`);
  return failed ? 2 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
