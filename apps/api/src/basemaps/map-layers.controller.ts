import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { type MslRequest, SessionService } from "../auth/session.service";
import { Requires } from "../iam/requires";
import type { ProjectActor } from "../projects/projects.service";
import { TileError, validTile } from "./esri.client";
import { MapLayersService } from "./map-layers.service";
import { isXyzTemplate, MAX_ZOOM } from "./ogc";
import { serviceUrlAllowed } from "./ogc.client";

/** A secret is one line: no line breaks or other control characters. */
const secret = z
  .string()
  .min(1, "type the password or key")
  .max(2000, "the password or key is too long")
  .regex(/^[^\p{Cc}]+$/u, "the password or key has a line break or control character");

/** Headers a key may not go in, because the request itself needs them. */
const RESERVED_HEADERS =
  /^(host|content-length|content-type|connection|transfer-encoding|user-agent|accept|cookie|te|upgrade)$/i;

const auth = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("none") }),
  z.strictObject({
    type: z.literal("basic"),
    name: z
      .string()
      .min(1, "type the user name")
      .max(200, "the user name is too long")
      .regex(/^[^:\p{Cc}]+$/u, "a user name cannot hold a colon or a line break"),
    secret,
  }),
  z.strictObject({
    type: z.literal("query"),
    name: z
      .string()
      .regex(
        /^[A-Za-z0-9_.-]{1,100}$/,
        "the parameter name may hold letters, digits, dots, dashes and underscores",
      )
      .refine(
        (n) =>
          !/^(service|request|version|layers?|bbox|crs|srs|format|width|height|styles?|tile(matrix(set)?|row|col))$/i.test(
            n,
          ),
        {
          message: "this parameter name is one of the map request's own",
        },
      ),
    secret,
  }),
  z.strictObject({
    type: z.literal("header"),
    name: z
      .string()
      .regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/, "this is not a header name")
      .refine((n) => !RESERVED_HEADERS.test(n), { message: "a key cannot go in this header" }),
    secret,
  }),
]);

const kind = z.enum(["wms", "wmts", "xyz"]);
const address = z.string().trim().max(2000, "the service address is too long").refine(serviceUrlAllowed, {
  message: "the service address must be an https address of a public server, without a user name or password",
});

/** XYZ tiles need {z}, {x} and {y} in the address. */
const xyzNeedsTemplate = (b: { kind: string; url: string }) => b.kind !== "xyz" || isXyzTemplate(b.url);
const templateMessage = { message: "an XYZ tile address needs {z}, {x} and {y}", path: ["url"] };
const maxzoom = z
  .number()
  .int()
  .min(0, "the deepest zoom is 0 to 22")
  .max(MAX_ZOOM, "the deepest zoom is 0 to 22");

const inspectBody = z
  .strictObject({ kind, url: address, auth, maxzoom: maxzoom.optional() })
  .refine(xyzNeedsTemplate, templateMessage);
const addBody = z
  .strictObject({
    kind,
    url: address,
    auth,
    name: z.string().trim().min(1, "give the layer a name").max(100, "the name is too long"),
    attribution: z
      .string()
      .trim()
      .min(1, "say who the data comes from (attribution)")
      .max(300, "the attribution is too long"),
    showAs: z.enum(["basemap", "overlay"]),
    layers: z
      .array(z.string().min(1).max(500))
      .min(1, "pick at least one layer")
      .max(20, "pick at most 20 layers")
      .refine((l) => new Set(l).size === l.length, { message: "a layer is picked twice" }),
    maxzoom: maxzoom.optional(),
  })
  .refine(xyzNeedsTemplate, templateMessage);
const uuid = z.uuid({ error: "no such service" });
const tileNumber = z.coerce.number().int();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value ?? {});
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message));
  return r.data;
}

function rethrow(e: unknown): never {
  if (e instanceof TileError) throw new HttpException(e.message, e.status);
  throw e;
}

/**
 * WMS and WMTS map layers (bundled plugin `org.mobsimlab.ogc-layers`, docs/architecture/06-gis.md §8): Admins add
 * services with their sign-in details; members' maps get the tiles here, so browsers never see those details.
 */
@Controller("api")
export class MapLayersController {
  constructor(
    private readonly layers: MapLayersService,
    private readonly sessions: SessionService,
  ) {}

  private actor(req: MslRequest): ProjectActor {
    const s = req.session;
    if (!s) throw new ForbiddenException();
    return {
      userId: s.actor.userId,
      role: s.actor.role,
      ipHash: this.sessions.ipHash(req.ip),
      requestId: req.requestId ?? null,
    };
  }

  /** Purpose: the services Admins added, with their layers; passwords and keys never come back. */
  @Get("admin/map-layers")
  @Requires("plugins.manage")
  async list() {
    return { services: await this.layers.list() };
  }

  /** Purpose: read a service's layers before adding it. Body: `{ kind, url, auth, maxzoom? }` (maxzoom for XYZ). Nothing is stored. */
  @Post("admin/map-layers/inspect")
  @HttpCode(200)
  @Requires("plugins.manage")
  async inspect(@Body() body: unknown) {
    const b = parse(inspectBody, body);
    try {
      return await this.layers.inspect(b.kind, b.url, b.auth, b.maxzoom);
    } catch (e) {
      rethrow(e);
    }
  }

  /** Purpose: add a service with the picked layers. Body: `{ kind, url, auth, name, attribution, showAs, layers, maxzoom? }`. */
  @Post("admin/map-layers")
  @Requires("plugins.manage")
  async add(@Body() body: unknown, @Req() req: MslRequest) {
    const b = parse(addBody, body);
    try {
      return { services: await this.layers.add(this.actor(req), b) };
    } catch (e) {
      rethrow(e);
    }
  }

  /** Purpose: remove a service; its layers leave the maps. */
  @Delete("admin/map-layers/:id")
  @Requires("plugins.manage")
  async remove(@Param("id") id: string, @Req() req: MslRequest) {
    return { services: await this.layers.remove(this.actor(req), parse(uuid, id)) };
  }

  /** Purpose: one tile of an added layer, fetched with the service's sign-in details and not stored. */
  @Get("map-layers/:service/:index/tiles/:z/:x/:y")
  @Requires("instance.read")
  async tile(
    @Param("service") service: string,
    @Param("index") index: string,
    @Param("z") zs: string,
    @Param("x") xs: string,
    @Param("y") ys: string,
    @Res() res: Response,
  ): Promise<void> {
    const id = parse(uuid, service);
    const [i, z, x, y] = [index, zs, xs, ys].map((v) => parse(tileNumber, v)) as [
      number,
      number,
      number,
      number,
    ];
    if (i < 0 || i >= 20 || z > MAX_ZOOM || !validTile(z, x, y))
      throw new BadRequestException("no such tile");
    try {
      const tile = await this.layers.tile(id, i, z, x, y);
      res.setHeader("Content-Type", tile.contentType);
      res.setHeader("Cache-Control", tile.maxAgeS > 0 ? `private, max-age=${tile.maxAgeS}` : "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.end(tile.body);
    } catch (e) {
      rethrow(e);
    }
  }
}
