import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { type MslRequest, SessionService } from "../auth/session.service";
import { Public, Requires } from "../iam/requires";
import { PluginCodeService, safePath } from "./code/code.service";
import { type PluginActor, PluginsService } from "./plugins.service";

const uuid = z.uuid();
const pluginId = z
  .string()
  .max(200)
  .regex(/^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*){2,}$/, "not a plugin id");
const version = z
  .string()
  .max(64)
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/, "not a version");
const uninstallBody = z.strictObject({ force: z.boolean().optional() });
const keyBody = z.strictObject({
  name: z.string().trim().min(1, "give the key a name").max(200),
  publicKey: z.string().min(1).max(4000),
});
const settingsBody = z.strictObject({ allowUnsigned: z.boolean() });
const onBody = z.strictObject({ enabled: z.boolean() });
const limitsBody = z.strictObject({
  memoryMb: z.number().int().min(16, "at least 16 MB").max(2048, "at most 2048 MB"),
  timeS: z.number().int().min(1, "at least 1 second").max(600, "at most 600 seconds"),
});
const sha = z.string().regex(/^[0-9a-f]{64}$/, "not a package hash");

/** Purpose: a wildcard route parameter (Express 5 gives its segments) as one path. */
const joined = (p: string | string[]) => (Array.isArray(p) ? p.join("/") : p);

/**
 * Headers of a tab page's files (ADR-0036 §6): the page runs sandboxed with an opaque origin even when opened on
 * its own (CSP `sandbox allow-scripts`), loads only the plugin's own files, connects nowhere, and may be framed
 * only by MobSimLab.
 */
const UI_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "sandbox allow-scripts; default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    "font-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "private, max-age=3600",
  "X-Frame-Options": "SAMEORIGIN",
};
const projectBody = z.strictObject({ enabled: z.boolean(), version: version.optional() });

/** Purpose: parse input with a zod schema; 400 with the issue messages on failure. */
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value ?? {});
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message));
  return r.data;
}

/** Purpose: the uploaded package, sent as `application/octet-stream` (parsed in app.setup.ts). */
function packageBody(body: unknown): Buffer {
  if (!Buffer.isBuffer(body) || body.length === 0)
    throw new BadRequestException("send the .msplugin file as application/octet-stream");
  return body;
}

/**
 * Plugins API (ADR-0036 §9). Admins and Owners install and remove plugin packages and manage trusted publisher
 * keys; any project member sees a project's plugins and the project's Owner turns them on or off.
 */
@Controller("api")
export class PluginsController {
  constructor(
    private readonly plugins: PluginsService,
    private readonly code: PluginCodeService,
    private readonly sessions: SessionService,
  ) {}

  private actor(req: MslRequest): PluginActor {
    const s = req.session;
    if (!s) throw new ForbiddenException();
    return {
      userId: s.actor.userId,
      role: s.actor.role,
      ipHash: this.sessions.ipHash(req.ip),
      requestId: req.requestId ?? null,
    };
  }

  /** Purpose: bundled and installed plugins, trusted keys and whether unsigned plugins are allowed. */
  @Get("admin/plugins")
  @Requires("plugins.manage")
  async list() {
    return this.plugins.adminList();
  }

  /** Purpose: check a `.msplugin` package without installing it. Body: the file (application/octet-stream). */
  @Post("admin/plugins/inspect")
  @HttpCode(200)
  @Requires("plugins.manage")
  async inspect(@Body() body: unknown, @Req() req: MslRequest) {
    return { inspection: await this.plugins.inspect(this.actor(req), packageBody(body)) };
  }

  /** Purpose: install a `.msplugin` package. Body: the file. 400 `{ problems }` when it cannot be installed. */
  @Post("admin/plugins")
  @Requires("plugins.manage")
  async install(@Body() body: unknown, @Req() req: MslRequest) {
    return { plugin: await this.plugins.install(this.actor(req), packageBody(body)) };
  }

  /** Purpose: remove an installed version. Body: `{ force? }`; 409 `{ projects }` when projects use it. */
  @Delete("admin/plugins/:id/:version")
  @Requires("plugins.manage")
  async uninstall(
    @Param("id") id: string,
    @Param("version") v: string,
    @Body() body: unknown,
    @Req() req: MslRequest,
  ) {
    const { force } = parse(uninstallBody, body);
    await this.plugins.uninstall(this.actor(req), parse(pluginId, id), parse(version, v), force ?? false);
    return { ok: true };
  }

  /** Purpose: turn a plugin on or off for the whole instance. Body: `{ enabled }`. Output: `{ off }`. */
  @Put("admin/plugins/:id/enabled")
  @Requires("plugins.manage")
  async setOn(@Param("id") id: string, @Body() body: unknown, @Req() req: MslRequest) {
    const { enabled } = parse(onBody, body);
    return { off: await this.plugins.setOnForInstance(this.actor(req), parse(pluginId, id), enabled) };
  }

  /** Purpose: trust a publisher's public key. Body: `{ name, publicKey }` (PEM, ECDSA P-256 or Ed25519). */
  @Post("admin/plugin-keys")
  @Requires("plugins.manage")
  async addKey(@Body() body: unknown, @Req() req: MslRequest) {
    const b = parse(keyBody, body);
    return { key: await this.plugins.addKey(this.actor(req), b.name, b.publicKey) };
  }

  /** Purpose: stop trusting a key. */
  @Delete("admin/plugin-keys/:id")
  @Requires("plugins.manage")
  async removeKey(@Param("id") id: string, @Req() req: MslRequest) {
    await this.plugins.removeKey(this.actor(req), parse(uuid, id));
    return { ok: true };
  }

  /** Purpose: allow unsigned plugins (Owners, development mode only). Body: `{ allowUnsigned }`. */
  @Put("admin/plugin-settings")
  @Requires("plugins.manage")
  async settings(@Body() body: unknown, @Req() req: MslRequest) {
    await this.plugins.setAllowUnsigned(this.actor(req), parse(settingsBody, body).allowUnsigned);
    return { ok: true };
  }

  /** Purpose: set the memory and time limits of plugin code. Body: `{ memoryMb, timeS }`. */
  @Put("admin/plugin-limits")
  @Requires("plugins.manage")
  async setLimits(@Body() body: unknown, @Req() req: MslRequest) {
    return { limits: await this.plugins.setLimits(this.actor(req), parse(limitsBody, body)) };
  }

  /**
   * Purpose: the plugins a project can use, with whether each is on and its version, and the limits the browser
   * runs plugin code with.
   */
  @Get("projects/:id/plugins")
  @Requires("projects.read")
  async forProject(@Param("id") id: string, @Req() req: MslRequest) {
    const [plugins, limits] = await Promise.all([
      this.plugins.forProject(this.actor(req), parse(uuid, id)),
      this.code.limits(),
    ]);
    return { plugins, limits };
  }

  /**
   * Purpose: a compiled file of an enabled plugin's component, for the browser's plugin host:
   * `…/code/<component path>/glue.js` or `…/glue.core.wasm`. Project members.
   */
  @Get("projects/:id/plugins/:pluginId/code/*path")
  @Requires("projects.read")
  async codeFile(
    @Param("id") id: string,
    @Param("pluginId") plugin: string,
    @Param("path") path: string | string[],
    @Req() req: MslRequest,
    @Res() res: Response,
  ): Promise<void> {
    const full = safePath(joined(path));
    const cut = full.lastIndexOf("/");
    const f = await this.code.codeFile(
      this.actor(req),
      parse(uuid, id),
      parse(pluginId, plugin),
      full.slice(0, cut),
      full.slice(cut + 1),
    );
    res.setHeader("Content-Type", f.mediaType);
    res.setHeader("Cache-Control", "private, no-cache");
    res.setHeader("ETag", `"${f.sha256}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(f.data);
  }

  /** Purpose: a file of an installed plugin's tab page, by package hash (see PluginCodeService.uiFile). */
  @Get("plugin-ui/:sha/*path")
  @Public()
  async uiFile(
    @Param("sha") hash: string,
    @Param("path") path: string | string[],
    @Res() res: Response,
  ): Promise<void> {
    const f = await this.code.uiFile(parse(sha, hash), safePath(joined(path)));
    for (const [k, v] of Object.entries(UI_HEADERS)) res.setHeader(k, v);
    res.setHeader("Content-Type", f.mediaType);
    res.end(f.data);
  }

  /** Purpose: turn a plugin on or off for a project (project Owners). Body: `{ enabled, version? }`. */
  @Put("projects/:id/plugins/:pluginId")
  @Requires("projects.read")
  async setForProject(
    @Param("id") id: string,
    @Param("pluginId") plugin: string,
    @Body() body: unknown,
    @Req() req: MslRequest,
  ) {
    const b = parse(projectBody, body);
    return {
      plugins: await this.plugins.setForProject(
        this.actor(req),
        parse(uuid, id),
        parse(pluginId, plugin),
        b.enabled,
        b.version,
      ),
    };
  }
}
