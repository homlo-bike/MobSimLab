#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Build the static viewer site and its ZIP for Cloudflare Pages (docs/user/static-viewer.md).
 *
 *   pnpm build:static                          site with the .mslab files of ./static-projects (if any)
 *   pnpm build:static --projects <folder>      site with the .mslab files of another folder
 *   pnpm build:static --skip-app               reuse the app already built in apps/web/dist-static
 *
 * Output: apps/web/dist-static/ (the site: the app, tools/add-projects.mjs and projects/ with the unpacked
 * projects and their index) and apps/web/mobsimlab-static.zip (the same, ready to upload).
 * The WebAssembly engines must be built first (tools/wasm/build-*.sh), as for `pnpm build`.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const web = join(root, "apps", "web");
const site = join(web, "dist-static");
const zipPath = join(web, "mobsimlab-static.zip");

/** The engines the viewer runs in the browser (tools/wasm). */
const WASM = [
  "cargo-bike",
  "depot-layout",
  "energy",
  "gtfs",
  "journey-planner",
  "mode-kits",
  "noise",
  "rail-design",
  "rail-sim",
  "street-routing",
];

/** Cloudflare Pages `_headers`: every path gets these. Keep the CSP in step with apps/api/src/app.setup.ts. */
const MAP_ORIGINS = "https://tiles.openfreemap.org https://tiles.maps.eox.at https://gibs.earthdata.nasa.gov";
const HEADERS = `/*
  Content-Security-Policy: default-src 'self'; img-src 'self' data: blob: ${MAP_ORIGINS}; connect-src 'self' data: ${MAP_ORIGINS}; worker-src 'self' blob:; style-src 'self'; script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Cross-Origin-Opener-Policy: same-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), interest-cohort=()
`;

function args(argv) {
  const out = { projects: join(root, "static-projects"), skipApp: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--") continue;
    if (argv[i] === "--projects") out.projects = resolve(argv[++i] ?? ".");
    else if (argv[i] === "--skip-app") out.skipApp = true;
    else throw new Error(`unknown option ${argv[i]}`);
  }
  return out;
}

/** Purpose: every file under a folder, as paths relative to it with forward slashes, sorted. */
function walk(dir, base = dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p, base) : [relative(base, p).split("\\").join("/")];
    });
}

/** Purpose: a ZIP of files (deflated, UTF-8 names, no ZIP64). */
function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of files) {
    const body = deflateRawSync(data);
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data) >>> 0;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x800, 6);
    head.writeUInt16LE(8, 8);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    parts.push(head, nameBuf, body);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);
    offset += head.length + nameBuf.length + body.length;
  }
  if (files.length > 65535) throw new Error("too many files for a ZIP without ZIP64");
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

function main() {
  const opt = args(process.argv.slice(2));
  if (!opt.skipApp) {
    const missing = WASM.filter((w) => !existsSync(join(web, "src", "wasm", w)));
    if (missing.length) {
      console.error(`Build the WebAssembly engines first: ${missing.map((w) => `tools/wasm/build-${w}.sh`).join(", ")}`);
      process.exit(1);
    }
    rmSync(site, { recursive: true, force: true });
    execFileSync("pnpm", ["exec", "vite", "build", "--mode", "static", "--outDir", "dist-static", "--emptyOutDir"], {
      cwd: web,
      stdio: "inherit",
    });
  } else if (!existsSync(join(site, "index.html"))) {
    console.error("apps/web/dist-static has no app yet; run without --skip-app.");
    process.exit(1);
  }

  // Security headers for Cloudflare Pages (security review): the same policy the MobSimLab server sends
  // (apps/api/src/app.setup.ts), so the viewer loads only its own files and the basemap tiles.
  writeFileSync(join(site, "_headers"), HEADERS);

  // The script that adds projects travels with the site, so new projects can be added without this repository.
  mkdirSync(join(site, "tools"), { recursive: true });
  copyFileSync(join(root, "tools", "static-site", "add-projects.mjs"), join(site, "tools", "add-projects.mjs"));
  const projects = join(site, "projects");
  mkdirSync(projects, { recursive: true });
  if (existsSync(opt.projects))
    for (const n of readdirSync(opt.projects))
      if (n.toLowerCase().endsWith(".mslab")) copyFileSync(join(opt.projects, n), join(projects, n));
  execFileSync(process.execPath, [join(site, "tools", "add-projects.mjs"), "--site", site], { stdio: "inherit" });

  const files = walk(site).map((n) => [n, readFileSync(join(site, n))]);
  writeFileSync(zipPath, zip(files));
  console.log(`Site: ${relative(root, site)}/  ZIP: ${relative(root, zipPath)} (${files.length} files)`);
}

main();
