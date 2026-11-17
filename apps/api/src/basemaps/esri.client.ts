/**
 * Esri World Imagery tiles (ArcGIS Location Platform basemap service): a provider of the outbound gateway
 * (ADR-0017) behind the bundled `org.mobsimlab.esri-imagery` plugin. The API fetches each tile with the ArcGIS key
 * an Admin saved, so browsers never see the key, and passes it on without storing it (Esri's terms do not allow
 * keeping tiles). Same outbound rules as the other providers: https endpoint, identifying User-Agent, timeout and
 * size limit. Errors never include the key or the URL that holds it.
 */

export const ESRI_IMAGERY_ENDPOINT =
  "https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile";
const USER_AGENT = "MobSimLab/0.1 (+https://github.com/homlo-bike/MobSimLab)";
/** Deepest zoom the API asks Esri for; the map enlarges tiles beyond it. */
export const ESRI_MAX_ZOOM = 23;

export interface EsriOptions {
  endpoint: string;
  timeoutMs: number;
  maxBytes: number;
  fetchImpl: typeof fetch;
}

/** A tile, as the API sends it on. */
export interface Tile {
  body: Buffer;
  contentType: string;
  /** Esri's own max-age, so the browser keeps the tile no longer than Esri allows. */
  maxAgeS: number;
}

/** Error with an HTTP status the API can pass on (404 no tile, 502 upstream failure, 504 timeout). */
export class TileError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Purpose: whether z/x/y name a tile of the Web Mercator pyramid that Esri serves. */
export function validTile(z: number, x: number, y: number): boolean {
  if (![z, x, y].every(Number.isInteger)) return false;
  if (z < 0 || z > ESRI_MAX_ZOOM) return false;
  const n = 2 ** z;
  return x >= 0 && x < n && y >= 0 && y < n;
}

/** Purpose: Esri's max-age from a Cache-Control header, capped at a day; 0 when there is none. */
export function maxAgeOf(cacheControl: string | null): number {
  const m = /(?:^|,)\s*max-age=(\d+)/i.exec(cacheControl ?? "");
  if (!m || /no-store|no-cache/i.test(cacheControl ?? "")) return 0;
  return Math.min(Number(m[1]), 86_400);
}

export class EsriImageryClient {
  private readonly o: EsriOptions;

  constructor(options: Partial<EsriOptions> = {}) {
    this.o = {
      endpoint: ESRI_IMAGERY_ENDPOINT,
      timeoutMs: 10_000,
      maxBytes: 2 * 1024 * 1024,
      fetchImpl: fetch,
      ...options,
    };
  }

  /**
   * Purpose: one imagery tile. Inputs: the ArcGIS key and a valid z/x/y. Output: the image.
   * Throws TileError: 404 when Esri has no tile there, 502 when Esri refuses the key or answers with something
   * other than an image, 504 on timeout.
   */
  async tile(apiKey: string, z: number, x: number, y: number): Promise<Tile> {
    const url = `${this.o.endpoint}/${z}/${y}/${x}?token=${encodeURIComponent(apiKey)}`;
    let res: Response;
    try {
      res = await this.o.fetchImpl(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "image/*" },
        redirect: "error",
        signal: AbortSignal.timeout(this.o.timeoutMs),
      });
    } catch (e) {
      const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      throw new TileError(
        timeout ? "Esri did not answer in time" : "Esri could not be reached",
        timeout ? 504 : 502,
      );
    }
    if (res.status === 404) throw new TileError("Esri has no imagery tile here", 404);
    if (res.status === 401 || res.status === 403)
      throw new TileError("Esri refused the ArcGIS API key; an Admin should check it", 502);
    if (!res.ok) throw new TileError(`Esri answered ${res.status}`, 502);
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    // Esri answers a bad key with JSON and status 200, so only images are passed on.
    if (!/^image\/(jpeg|png|webp)$/.test(contentType))
      throw new TileError("Esri did not answer with an image; an Admin should check the ArcGIS API key", 502);
    const length = Number(res.headers.get("content-length") ?? "0");
    if (length > this.o.maxBytes) throw new TileError("Esri's tile is too large", 502);
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > this.o.maxBytes) throw new TileError("Esri's tile is too large", 502);
    return { body, contentType, maxAgeS: maxAgeOf(res.headers.get("cache-control")) };
  }
}
