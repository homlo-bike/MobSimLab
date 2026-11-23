import { z } from "zod";

/**
 * GEBCO water depths (ADR-0036 §6): the ferry route checks ask for the depth at points on open sea. GEBCO is a
 * global bathymetry grid of 15 arc-seconds (about 450 m); it is read through an Open Topo Data server, the
 * public one by default or a self-hosted one with the GEBCO dataset (`MOBSIMLAB_GEBCO_URL`, the dataset's URL
 * such as `https://api.opentopodata.org/v1/gebco2020`). Points go in batches of up to 100, one request at a
 * time with a minimum interval, retried with backoff on 429/5xx and timeouts; answers are cached. Set
 * `MOBSIMLAB_GEBCO=off` to never send points to it.
 */

export const DEFAULT_GEBCO_URL = "https://api.opentopodata.org/v1/gebco2020";
const USER_AGENT = "MobSimLab/0.1 (+https://github.com/homlo-bike/MobSimLab)";
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

/** Where the depths come from, shown next to the depth check. */
export const GEBCO_SOURCE = {
  id: "gebco",
  name: "GEBCO grid",
  kind: "bathymetry",
  note: "Water depth from the GEBCO global grid (15 arc-seconds, about 450 m), read through Open Topo Data. Too coarse for harbours and rivers, which are not checked.",
  resolutionM: 450,
  url: "https://www.gebco.net/data-products/gridded-bathymetry-data",
  licence:
    "GEBCO grid: public domain, attribution requested (GEBCO Compilation Group). Open Topo Data: MIT software.",
} as const;

export class GebcoError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface GebcoOptions {
  endpoint: string;
  /** Points per request (Open Topo Data takes up to 100). */
  batchSize: number;
  minIntervalMs: number;
  timeoutMs: number;
  backoffMs: number[];
  cacheSize: number;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}

/** Purpose: the GEBCO settings from the environment; null when depths are off. */
export function gebcoSettings(env: NodeJS.ProcessEnv = process.env): Partial<GebcoOptions> | null {
  if ((env.MOBSIMLAB_GEBCO ?? "on") === "off") return null;
  const endpoint = env.MOBSIMLAB_GEBCO_URL
    ? z
        .url({ protocol: /^https$/ })
        .parse(env.MOBSIMLAB_GEBCO_URL)
        .replace(/\/+$/, "")
    : DEFAULT_GEBCO_URL;
  return { endpoint };
}

export class GebcoClient {
  private readonly o: GebcoOptions;
  private readonly cache = new Map<string, number | null>();
  private queue: Promise<unknown> = Promise.resolve();
  private last = 0;

  constructor(options: Partial<GebcoOptions> = {}) {
    this.o = {
      endpoint: DEFAULT_GEBCO_URL,
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
   * Purpose: water depths at points, in order: metres below sea level (land is negative); null where the grid
   * has none. Side effects: one request per batch of uncached points, one at a time.
   */
  async depths(points: [number, number][]): Promise<Array<number | null>> {
    const key = ([lon, lat]: [number, number]) => `${lon.toFixed(5)},${lat.toFixed(5)}`;
    const missing = [
      ...new Map(points.filter((p) => !this.cache.has(key(p))).map((p) => [key(p), p])).values(),
    ];
    for (let i = 0; i < missing.length; i += this.o.batchSize) {
      const batch = missing.slice(i, i + this.o.batchSize);
      const zs = await this.serial(() => this.lookup(batch));
      batch.forEach((p, k) => {
        const z = zs[k];
        this.remember(key(p), typeof z === "number" ? -z : null);
      });
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

  /** Purpose: the grid's elevations (metres, negative below sea level) at a batch of points. */
  private async lookup(batch: [number, number][]): Promise<Array<number | null>> {
    let lastError = new GebcoError("GEBCO request failed", 502);
    const locations = batch.map(([lon, lat]) => `${lat.toFixed(5)},${lon.toFixed(5)}`).join("|");
    for (const backoff of [0, ...this.o.backoffMs]) {
      if (backoff) await this.o.sleep(backoff + Math.random() * (backoff / 2));
      const wait = this.last + this.o.minIntervalMs - Date.now();
      if (wait > 0) await this.o.sleep(wait);
      this.last = Date.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.o.timeoutMs);
      try {
        const res = await this.o.fetchImpl(this.o.endpoint, {
          method: "POST",
          headers: {
            "User-Agent": USER_AGENT,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ locations, interpolation: "bilinear" }),
          signal: ctrl.signal,
          redirect: "error",
        });
        if (RETRY_STATUS.has(res.status)) {
          lastError = new GebcoError(`GEBCO server answered ${res.status}`, 502);
          continue;
        }
        if (!res.ok) throw new GebcoError(`GEBCO server answered ${res.status}`, 502);
        const body = (await res.json()) as { results?: { elevation?: unknown }[] };
        const results = body.results ?? [];
        if (results.length !== batch.length)
          throw new GebcoError("GEBCO server answered the wrong number of points", 502);
        return results.map((r) =>
          typeof r.elevation === "number" && Number.isFinite(r.elevation) ? r.elevation : null,
        );
      } catch (e) {
        if (e instanceof GebcoError) throw e;
        lastError = ctrl.signal.aborted
          ? new GebcoError("GEBCO server did not answer in time", 504)
          : new GebcoError(e instanceof Error ? e.message : String(e), 502);
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  }
}
