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
} from "@nestjs/common";
import { z } from "zod";
import { type MslRequest, SessionService } from "../auth/session.service";
import { Requires } from "../iam/requires";
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

  /** Purpose: the plugins a project can use, with whether each is on and its version. */
  @Get("projects/:id/plugins")
  @Requires("projects.read")
  async forProject(@Param("id") id: string, @Req() req: MslRequest) {
    return { plugins: await this.plugins.forProject(this.actor(req), parse(uuid, id)) };
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
