import { z } from "zod";

/**
 * Photon geocoder client (OpenStreetMap place names, by komoot): a provider of the outbound gateway
 * (ADR-0017) behind the map's place search. Same outbound rules as the other providers: https endpoint,
 * identifying User-Agent, timeout, size limit, one retry with backoff on 429/5xx. Answers are cached for an
 * hour so repeated searches do not reach the public service again; an instance with heavy use points
 * `MOBSIMLAB_GEOCODER_URL` at its own Photon.
 */

export const DEFAULT_GEOCODER_URL = "https://photon.komoot.io";
const USER_AGENT = "MobSimLab/0.1 (+https://github.com/homlo-bike/MobSimLab)";
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const HOUR_MS = 3600 * 1000;
/** Languages the public Photon names places in; others get the local name. */
const PHOTON_LANGUAGES = new Set(["en", "de", "fr", "it"]);

export interface PhotonOptions {
  endpoint: string;
  timeoutMs: number;
  maxBytes: number;
  backoffMs: number[];
  cacheMs: number;
  cacheSize: number;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

/** Error with an HTTP status the API can pass on (502 upstream failure, 504 timeout). */
export class GeocoderError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** One place found: its name, what lies round it (street, city, country) and where it is. */
export interface Place {
  name: string;
  /** Street, city, region and country, as far as OpenStreetMap knows them, joined with ", ". */
  context: string;
  /** OpenStreetMap key and value, such as "railway" / "station". */
  kind: string;
  lonLat: [number, number];
  /** [west, south, east, north] for areas (cities, districts); null for points. */
  bbox: [number, number, number, number] | null;
}

/** Purpose: read the endpoint from `MOBSIMLAB_GEOCODER_URL`; only https URLs are accepted. */
export function geocoderEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  const v = env.MOBSIMLAB_GEOCODER_URL;
  if (!v) return DEFAULT_GEOCODER_URL;
  return z
    .url({ protocol: /^https$/ })
    .parse(v)
    .replace(/\/+$/, "");
}

const feature = z.object({
  geometry: z.object({ type: z.literal("Point"), coordinates: z.tuple([z.number(), z.number()]) }),
  properties: z.looseObject({
    name: z.string().optional(),
    street: z.string().optional(),
    housenumber: z.string().optional(),
    district: z.string().optional(),
    city: z.string().optional(),
    county: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    osm_key: z.string().optional(),
    osm_value: z.string().optional(),
    extent: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  }),
});
const collection = z.object({ features: z.array(z.unknown()) });

/** Purpose: a Photon feature as a place, or null when it has nothing to show. */
export function toPlace(f: unknown): Place | null {
  const r = feature.safeParse(f);
  if (!r.success) return null;
  const p = r.data.properties;
  const street = p.street ? [p.street, p.housenumber].filter(Boolean).join(" ") : undefined;
  const name = p.name ?? street;
  if (!name) return null;
  const parts = [street, p.district, p.city, p.state ?? p.county, p.country].filter(
    (x): x is string => !!x && x !== name,
  );
  const e = p.extent;
  // Photon's extent is [west, north, east, south].
  const bbox: Place["bbox"] = e ? [e[0], Math.min(e[1], e[3]), e[2], Math.max(e[1], e[3])] : null;
  return {
    name,
    context: [...new Set(parts)].join(", "),
    kind: [p.osm_key, p.osm_value].filter(Boolean).join("/"),
    lonLat: r.data.geometry.coordinates,
    bbox,
  };
}

export class PhotonClient {
  private readonly o: PhotonOptions;
  private readonly cache = new Map<string, { at: number; value: Promise<Place[]> }>();

  constructor(options: Partial<PhotonOptions> = {}) {
    this.o = {
      endpoint: geocoderEndpoint(),
      timeoutMs: 10_000,
      maxBytes: 1024 * 1024,
      backoffMs: [1_000],
      cacheMs: HOUR_MS,
      cacheSize: 1_000,
      fetchImpl: (...a) => fetch(...a),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => Date.now(),
      ...options,
    };
  }

  /**
   * Purpose: places matching a text, best first.
   * Inputs: the text, the reader's language (names in it where Photon has them), the map centre to
   * prefer nearby places, and how many to return.
   */
  search(q: string, opts: { lang?: string; near?: [number, number]; limit?: number } = {}): Promise<Place[]> {
    const text = q.trim().slice(0, 200);
    if (!text) return Promise.resolve([]);
    const params = new URLSearchParams({ q: text, limit: String(opts.limit ?? 6) });
    const lang = opts.lang?.toLowerCase().split("-")[0];
    if (lang && PHOTON_LANGUAGES.has(lang)) params.set("lang", lang);
    if (opts.near) {
      params.set("lon", opts.near[0].toFixed(3));
      params.set("lat", opts.near[1].toFixed(3));
    }
    const url = `${this.o.endpoint}/api/?${params}`;
    const hit = this.cache.get(url);
    if (hit && this.o.now() - hit.at < this.o.cacheMs) return hit.value;
    const value = this.attempts(url).then((body) => {
      const parsed = collection.safeParse(body);
      if (!parsed.success) throw new GeocoderError("The geocoder answered an unexpected document", 502);
      return parsed.data.features.map(toPlace).filter((p): p is Place => p !== null);
    });
    value.catch(() => this.cache.delete(url));
    if (this.cache.size >= this.o.cacheSize) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(url, { at: this.o.now(), value });
    return value;
  }

  private async attempts(url: string): Promise<unknown> {
    let lastError = new GeocoderError("The geocoder request failed", 502);
    for (const backoff of [0, ...this.o.backoffMs]) {
      if (backoff) await this.o.sleep(backoff);
      try {
        return await this.once(url);
      } catch (e) {
        lastError = e instanceof GeocoderError ? e : new GeocoderError(String(e), 502);
        if (!(lastError.status === 504 || lastError.message.startsWith("retry"))) throw lastError;
      }
    }
    throw lastError;
  }

  private async once(url: string): Promise<unknown> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.o.timeoutMs);
    try {
      const res = await this.o.fetchImpl(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: ctrl.signal,
        redirect: "error",
      });
      if (RETRY_STATUS.has(res.status))
        throw new GeocoderError(`retry: the geocoder answered ${res.status}`, 502);
      if (!res.ok) throw new GeocoderError(`The geocoder answered ${res.status}`, 502);
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > this.o.maxBytes) throw new GeocoderError("The geocoder's answer is too large", 502);
      const text = await res.text();
      if (text.length > this.o.maxBytes) throw new GeocoderError("The geocoder's answer is too large", 502);
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new GeocoderError("The geocoder answered something other than JSON", 502);
      }
    } catch (e) {
      if (e instanceof GeocoderError) throw e;
      if (ctrl.signal.aborted) throw new GeocoderError("The geocoder did not answer in time", 504);
      throw new GeocoderError(`retry: ${e instanceof Error ? e.message : String(e)}`, 502);
    } finally {
      clearTimeout(timer);
    }
  }
}
