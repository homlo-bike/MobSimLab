import { z } from "zod";

/**
 * Open-Elevation (06-gis §4 and §5): the fallback for heights when the Copernicus GLO-30 bucket cannot be read
 * and the project has no imported elevation. Any server with the Open-Elevation lookup API works, including a
 * self-hosted one (`MOBSIMLAB_OPEN_ELEVATION_URL`). Points go in batches up to the server's limit, one request
 * at a time with a minimum interval, retried with backoff on 429/5xx and timeouts; answers are cached.
 * Set `MOBSIMLAB_ELEVATION_FALLBACK=off` to never send points to it.
 */

export const DEFAULT_OPEN_ELEVATION_URL = "https://api.open-elevation.com";
const USER_AGENT = "MobSimLab/0.1 (+https://github.com/homlo-bike/MobSimLab)";
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

/** Where the fallback heights come from, shown next to results that use them (C-09). */
export const OPEN_ELEVATION_SOURCE = {
  id: "open_elevation",
  name: "Open-Elevation (SRTM)",
  kind: "DSM",
  note: "Fallback used because the Copernicus DEM could not be read. Open-Elevation serves SRTM heights; accuracy depends on the server's dataset.",
  resolutionM: 30,
  verticalAccuracyM: 16,
  verticalAccuracyNote: "SRTM absolute vertical accuracy is specified as 16 m (90 % linear error).",
  url: "https://open-elevation.com",
  licence: "SRTM data: public domain (NASA/USGS). Open-Elevation: GPL-2.0 software.",
} as const;

export class OpenElevationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface OpenElevationOptions {
  endpoint: string;
  /** Points per request (the public server accepts about 100 to 200). */
  batchSize: number;
  minIntervalMs: number;
  timeoutMs: number;
  backoffMs: number[];
  cacheSize: number;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}

/** Purpose: the fallback settings from the environment; null when the fallback is off. */
export function openElevationSettings(env: NodeJS.ProcessEnv = process.env): Partial<OpenElevationOptions> | null {
  if ((env.MOBSIMLAB_ELEVATION_FALLBACK ?? "open-elevation") === "off") return null;
  const endpoint = env.MOBSIMLAB_OPEN_ELEVATION_URL
    ? z.url({ protocol: /^https$/ }).parse(env.MOBSIMLAB_OPEN_ELEVATION_URL).replace(/\/+$/, "")
    : DEFAULT_OPEN_ELEVATION_URL;
  const batch = z.coerce.number().int().min(1).max(10_000).default(100).parse(env.MOBSIMLAB_OPEN_ELEVATION_BATCH || undefined);
  return { endpoint, batchSize: batch };
}

export class OpenElevationClient {
  private readonly o: OpenElevationOptions;
  private readonly cache = new Map<string, number | null>();
  private queue: Promise<unknown> = Promise.resolve();
  private last = 0;

  constructor(options: Partial<OpenElevationOptions> = {}) {
    this.o = {
      endpoint: DEFAULT_OPEN_ELEVATION_URL,
      batchSize: 100,
      minIntervalMs: 1_000,
      timeoutMs: 30_000,
      backoffMs: [2_000, 4_000, 8_000],
      cacheSize: 20_000,
      fetchImpl: (...a) => fetch(...a),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      ...options,
    };
  }

  /**
   * Purpose: heights at points, in order; null where the server has none.
   * Side effects: one request per batch of uncached points, one at a time.
   */
  async elevations(points: [number, number][]): Promise<Array<number | null>> {
    const key = ([lon, lat]: [number, number]) => `${lon.toFixed(6)},${lat.toFixed(6)}`;
    const missing = [...new Map(points.filter((p) => !this.cache.has(key(p))).map((p) => [key(p), p])).values()];
    for (let i = 0; i < missing.length; i += this.o.batchSize) {
      const batch = missing.slice(i, i + this.o.batchSize);
      const zs = await this.serial(() => this.lookup(batch));
      batch.forEach((p, k) => this.remember(key(p), zs[k] ?? null));
    }
    return points.map((p) => this.cache.get(key(p)) ?? null);
  }

  private remember(k: string, v: number | null) {
    this.cache.delete(k);
    this.cache.set(k, v);
    while (this.cache.size > this.o.cacheSize) this.cache.delete(this.cache.keys().next().value as string);
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async lookup(batch: [number, number][]): Promise<Array<number | null>> {
    let lastError = new OpenElevationError("Open-Elevation request failed", 502);
    for (const backoff of [0, ...this.o.backoffMs]) {
      if (backoff) await this.o.sleep(backoff + Math.random() * (backoff / 2));
      const wait = this.last + this.o.minIntervalMs - Date.now();
      if (wait > 0) await this.o.sleep(wait);
      this.last = Date.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.o.timeoutMs);
      try {
        const res = await this.o.fetchImpl(`${this.o.endpoint}/api/v1/lookup`, {
          method: "POST",
          headers: { "User-Agent": USER_AGENT, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ locations: batch.map(([lon, lat]) => ({ latitude: lat, longitude: lon })) }),
          signal: ctrl.signal,
          redirect: "error",
        });
        if (RETRY_STATUS.has(res.status)) {
          lastError = new OpenElevationError(`Open-Elevation answered ${res.status}`, 502);
          continue;
        }
        if (!res.ok) throw new OpenElevationError(`Open-Elevation answered ${res.status}`, 502);
        const body = (await res.json()) as { results?: { elevation?: unknown }[] };
        const results = body.results ?? [];
        if (results.length !== batch.length) throw new OpenElevationError("Open-Elevation answered the wrong number of points", 502);
        return results.map((r) => (typeof r.elevation === "number" && Number.isFinite(r.elevation) ? r.elevation : null));
      } catch (e) {
        if (e instanceof OpenElevationError) throw e;
        lastError = ctrl.signal.aborted
          ? new OpenElevationError("Open-Elevation did not answer in time", 504)
          : new OpenElevationError(e instanceof Error ? e.message : String(e), 502);
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  }
}
