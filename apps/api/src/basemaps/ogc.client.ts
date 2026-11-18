import { lookup } from "node:dns/promises";
import { gbfsUrlAllowed, publicAddress } from "../gateway/gbfs.client";
import {
  type Capabilities,
  capabilitiesUrl,
  type OgcServiceKind,
  fillXyz,
  isXyzTemplate,
  MAX_ZOOM,
  readCapabilities,
  CapabilitiesError,
  serviceBase,
} from "./ogc";
import { maxAgeOf, type Tile, TileError } from "./esri.client";

/**
 * Reads WMS and WMTS services for the map layers an Admin adds (bundled plugin `org.mobsimlab.ogc-layers`): their
 * capabilities, and each map tile, which the API passes on without storing it. A provider of the outbound
 * gateway (ADR-0017) with its rules: https addresses of public servers only (checked again after every name
 * lookup, so a service cannot point the API inside its own network), no redirects, a timeout and a size limit.
 * Credentials go only to the host the Admin typed, and never into an error message.
 */

const USER_AGENT = "MobSimLab/0.1 (+https://github.com/homlo-bike/MobSimLab)";

/** How a service wants to be signed in to. The secret stays on the server. */
export type OgcAuth =
  | { type: "none" }
  /** HTTP Basic: user name and password. */
  | { type: "basic"; name: string; secret: string }
  /** A key as a query parameter of every request (such as `token` or `apikey`). */
  | { type: "query"; name: string; secret: string }
  /** A key in a request header (such as `X-API-Key`, or `Authorization` with `Bearer …`). */
  | { type: "header"; name: string; secret: string };

export interface OgcOptions {
  timeoutMs: number;
  maxCapabilitiesBytes: number;
  maxTileBytes: number;
  fetchImpl: typeof fetch;
  /** Every address a host name resolves to (injectable for tests). */
  resolveImpl: (host: string) => Promise<string[]>;
}

/** Error with a status the API can pass on and a message an Admin can act on; never holds a URL or secret. */
export class OgcError extends TileError {}

/** How long a host's checked addresses are trusted before they are looked up again. */
const RESOLVE_CACHE_MS = 5 * 60_000;

/**
 * Purpose: whether an address an Admin typed may be read: https, a public host name, no user name or password in
 * it (those go in the sign-in fields, where they are kept secret).
 */
export function serviceUrlAllowed(raw: string): boolean {
  // XYZ templates: judge the address of a real tile.
  return gbfsUrlAllowed(fillXyz(raw.trim(), 0, 0, 0));
}

/**
 * Purpose: the address to request, from one the service's capabilities name. On the service's own host it is
 * moved to https (services often name their http address behind a proxy) and gets the query parameters of the
 * address the Admin typed that it lacks (a map name or key). Output: the address and whether it is on the
 * service's host (only then are credentials sent), or null when it may not be read.
 */
export function requestUrl(service: string, raw: string): { url: URL; ownHost: boolean } | null {
  let u: URL;
  let base: URL;
  try {
    base = serviceBase(fillXyz(service, 0, 0, 0));
    u = new URL(raw, base);
  } catch {
    return null;
  }
  const ownHost = u.hostname.toLowerCase() === base.hostname.toLowerCase();
  if (ownHost) {
    u.protocol = "https:";
    u.port = base.port;
    for (const [k, v] of base.searchParams)
      if (![...u.searchParams.keys()].some((x) => x.toLowerCase() === k.toLowerCase()))
        u.searchParams.set(k, v);
  }
  if (u.username || u.password || !gbfsUrlAllowed(u.toString())) return null;
  return { url: u, ownHost };
}

/** Purpose: the request with the service's credentials added (only for its own host). */
export function signed(
  url: URL,
  auth: OgcAuth,
  ownHost: boolean,
): { url: URL; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const out = new URL(url);
  if (!ownHost || auth.type === "none") return { url: out, headers };
  if (auth.type === "basic")
    headers.Authorization = `Basic ${Buffer.from(`${auth.name}:${auth.secret}`, "utf8").toString("base64")}`;
  else if (auth.type === "header") headers[auth.name] = auth.secret;
  else out.searchParams.set(auth.name, auth.secret);
  return { url: out, headers };
}

export class OgcClient {
  private readonly o: OgcOptions;
  private readonly checked = new Map<string, number>();

  constructor(options: Partial<OgcOptions> = {}) {
    this.o = {
      timeoutMs: 15_000,
      maxCapabilitiesBytes: 10 * 1024 * 1024,
      maxTileBytes: 5 * 1024 * 1024,
      fetchImpl: (...a) => fetch(...a),
      resolveImpl: async (host) => (await lookup(host, { all: true })).map((a) => a.address),
      ...options,
    };
  }

  /**
   * Purpose: read a service's capabilities. Inputs: the kind, the address the Admin typed, the credentials.
   * Output: its title, attribution and layers. Throws OgcError (400 for a refused address or a document that is
   * not capabilities, 502 when the service fails or refuses the credentials, 504 on timeout).
   */
  async capabilities(kind: OgcServiceKind, service: string, auth: OgcAuth): Promise<Capabilities> {
    if (!serviceUrlAllowed(service))
      throw new OgcError("the service address must be an https address of a public server", 400);
    const url = capabilitiesUrl(kind, serviceBase(service));
    const res = await this.get(url, auth, true, "application/xml, text/xml, */*");
    if (res.status === 401 || res.status === 403)
      throw new OgcError("the service refused access: check the sign-in details", 502);
    if (!res.ok) {
      const why = await this.reason(res, auth);
      throw new OgcError(`the service answered ${res.status}${why ? `: ${why}` : ""}`, 502);
    }
    const text = (await this.limited(res, this.o.maxCapabilitiesBytes, "capabilities document")).toString(
      "utf8",
    );
    try {
      return readCapabilities(kind, text);
    } catch (e) {
      if (e instanceof CapabilitiesError) throw new OgcError(e.message, 400);
      throw e;
    }
  }

  /**
   * Purpose: check an XYZ tile address by fetching its world tile (0/0/0) with the credentials. Inputs: the
   * template, the credentials and the deepest zoom the Admin gave. Output: its one layer, titled by its host.
   * A missing world tile is fine (some services start deeper); a refusal or an answer that is not an image is not.
   */
  async xyz(template: string, auth: OgcAuth, maxzoom: number): Promise<Capabilities> {
    if (!isXyzTemplate(template))
      throw new OgcError(
        "the tile address needs {z}, {x} and {y}, such as https://tile.example.org/{z}/{x}/{y}.png",
        400,
      );
    if (!serviceUrlAllowed(fillXyz(template, 0, 0, 0)))
      throw new OgcError("the service address must be an https address of a public server", 400);
    try {
      await this.tile(template, new URL(fillXyz(template, 0, 0, 0)), auth);
    } catch (e) {
      if (!(e instanceof OgcError) || e.status !== 404) throw e;
    }
    const host = new URL(fillXyz(template, 0, 0, 0)).hostname;
    const z = Math.max(0, Math.min(MAX_ZOOM, Math.round(maxzoom)));
    return {
      kind: "xyz",
      version: "",
      title: host,
      attribution: "",
      layers: [
        {
          id: "tiles",
          title: host,
          layer: { id: "tiles", title: host, tileSize: 256, minzoom: 0, maxzoom: z, xyz: { template } },
        },
      ],
    };
  }

  /**
   * Purpose: one map tile. Inputs: the service address the Admin typed, the tile's address from the layer, the
   * credentials. Output: the image with the service's max-age (at most a day). Throws OgcError: 404 when there is
   * no tile, 502 when the service fails or answers with something other than an image, 504 on timeout.
   */
  async tile(service: string, address: URL, auth: OgcAuth): Promise<Tile> {
    const target = requestUrl(service, address.toString());
    if (!target) throw new OgcError("the layer's tile address may not be read", 502);
    const res = await this.get(target.url, auth, target.ownHost, "image/*");
    // WMTS answers tiles outside the layer with 400 or 404: no tile there.
    if (res.status === 404 || res.status === 400 || res.status === 204)
      throw new OgcError("the service has no tile here", 404);
    if (res.status === 401 || res.status === 403)
      throw new OgcError("the service refused access; an Admin should check the sign-in details", 502);
    if (!res.ok) throw new OgcError(`the service answered ${res.status}`, 502);
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    // WMS answers a failed GetMap with an XML exception and status 200, so only images are passed on.
    if (!/^image\/(png|jpeg|webp|gif)$/.test(contentType)) {
      await res.body?.cancel().catch(() => undefined);
      throw new OgcError("the service did not answer with an image", 502);
    }
    const body = await this.limited(res, this.o.maxTileBytes, "tile");
    return { body, contentType, maxAgeS: maxAgeOf(res.headers.get("cache-control")) };
  }

  private async get(url: URL, auth: OgcAuth, ownHost: boolean, accept: string): Promise<Response> {
    await this.checkHost(url.hostname);
    const req = signed(url, auth, ownHost);
    try {
      return await this.o.fetchImpl(req.url, {
        headers: { "User-Agent": USER_AGENT, Accept: accept, ...req.headers },
        redirect: "error",
        signal: AbortSignal.timeout(this.o.timeoutMs),
      });
    } catch (e) {
      const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      throw new OgcError(
        timeout ? "the service did not answer in time" : "the service could not be reached",
        timeout ? 504 : 502,
      );
    }
  }

  /**
   * Purpose: the service's own short reason for a failed answer (a JSON `message`, an OGC exception text or plain
   * text), so the Admin sees why. At most 200 characters, one line, and never the password or key.
   */
  private async reason(res: Response, auth: OgcAuth): Promise<string> {
    let text: string;
    try {
      text = (await this.limited(res, 16 * 1024, "error")).toString("utf8");
    } catch {
      return "";
    }
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    let why = "";
    if (type.includes("json")) {
      try {
        const m = (JSON.parse(text) as { message?: unknown; error?: unknown }) ?? {};
        why = typeof m.message === "string" ? m.message : typeof m.error === "string" ? m.error : "";
      } catch {
        why = "";
      }
    } else if (type.includes("xml")) {
      why = /<(?:\w+:)?(?:ServiceException|ExceptionText)\b[^>]*>([^<]*)</.exec(text)?.[1] ?? "";
    } else if (type.startsWith("text/plain")) why = text;
    why = why.replace(/[\p{Cc}\s]+/gu, " ").trim();
    if (auth.type !== "none" && auth.secret) why = why.split(auth.secret).join("…");
    return why.length > 200 ? `${why.slice(0, 199)}…` : why;
  }

  /** Purpose: refuse hosts that resolve inside a private network (SSRF), remembering good hosts for a while. */
  private async checkHost(host: string): Promise<void> {
    const at = this.checked.get(host);
    if (at !== undefined && Date.now() - at < RESOLVE_CACHE_MS) return;
    let addresses: string[];
    try {
      addresses = await this.o.resolveImpl(host);
    } catch {
      throw new OgcError("the service could not be reached", 502);
    }
    if (addresses.length === 0 || !addresses.every(publicAddress))
      throw new OgcError("the service address must be an https address of a public server", 400);
    if (this.checked.size > 1000) this.checked.clear();
    this.checked.set(host, Date.now());
  }

  /** Purpose: the body, stopping as soon as it passes `max` bytes (a huge answer is never held in full). */
  private async limited(res: Response, max: number, what: string): Promise<Buffer> {
    const length = Number(res.headers.get("content-length") ?? "0");
    if (length > max) {
      await res.body?.cancel().catch(() => undefined);
      throw new OgcError(`the service's ${what} is too large`, 502);
    }
    if (!res.body) return Buffer.alloc(0);
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel().catch(() => undefined);
        throw new OgcError(`the service's ${what} is too large`, 502);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }
}
