import { z } from "zod";

/**
 * WorldPop statistics API client: total population inside a polygon from the WorldPop Global 100 m
 * population grid (dataset `wpgppop`, 2000–2020, CC BY 4.0). A provider of the outbound gateway
 * (ADR-0017) for the benefit tables (ADR-0040). Same outbound rules as the other providers: https
 * endpoint, identifying User-Agent, timeout, size limit, retries with backoff on 429/5xx and timeouts,
 * at most a few requests at a time. Answers are cached for a week: the grid does not change.
 *
 * The API answers at once (`runasync=false`) for small polygons; otherwise it gives a task id that is
 * polled until it is finished.
 */

export const DEFAULT_WORLDPOP_URL = "https://api.worldpop.org/v1";
const USER_AGENT = "MobSimLab/0.1 (+https://github.com/homlo-bike/MobSimLab)";
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const WEEK_MS = 7 * 24 * 3600 * 1000;
/** The latest year of the WorldPop Global 100 m unconstrained population counts. */
export const WORLDPOP_YEAR = 2020;

export const WORLDPOP_SOURCE = {
  name: "WorldPop Global 100 m population counts (unconstrained), via the WorldPop statistics API",
  licence: "CC BY 4.0",
  url: "https://www.worldpop.org/",
} as const;

/** Settings, with defaults for production. */
export interface WorldPopOptions {
  endpoint: string;
  timeoutMs: number;
  maxBytes: number;
  backoffMs: number[];
  pollMs: number;
  maxPolls: number;
  parallel: number;
  cacheMs: number;
  cacheSize: number;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

/** Error with an HTTP status the API can pass on (502 upstream failure, 504 timeout). */
export class WorldPopError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Purpose: read the endpoint from `MOBSIMLAB_WORLDPOP_URL`; only https URLs are accepted. */
export function worldPopEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  const v = env.MOBSIMLAB_WORLDPOP_URL;
  if (!v) return DEFAULT_WORLDPOP_URL;
  return z
    .url({ protocol: /^https$/ })
    .parse(v)
    .replace(/\/+$/, "");
}

const answer = z.looseObject({
  status: z.string().optional(),
  error: z.boolean().optional(),
  error_message: z.string().nullable().optional(),
  taskid: z.string().optional(),
  data: z.looseObject({ total_population: z.number().optional() }).nullable().optional(),
});

/** Purpose: a closed ring `[lon, lat]` as a GeoJSON FeatureCollection, coordinates to 5 decimals (~1 m). */
export function ringGeoJson(ring: [number, number][]): string {
  const r5 = (v: number) => Math.round(v * 1e5) / 1e5;
  const pts = ring.map(([x, y]) => [r5(x), r5(y)]);
  const [a, b] = [pts[0], pts[pts.length - 1]];
  if (a && b && (a[0] !== b[0] || a[1] !== b[1])) pts.push(a);
  return JSON.stringify({
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [pts] } }],
  });
}

export class WorldPopClient {
  private readonly o: WorldPopOptions;
  private readonly cache = new Map<string, { at: number; value: Promise<number> }>();
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(options: Partial<WorldPopOptions> = {}) {
    this.o = {
      endpoint: worldPopEndpoint(),
      timeoutMs: 30_000,
      maxBytes: 1024 * 1024,
      backoffMs: [2_000, 5_000],
      pollMs: 1_500,
      maxPolls: 40,
      parallel: 4,
      cacheMs: WEEK_MS,
      cacheSize: 2_000,
      fetchImpl: (...a) => fetch(...a),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => Date.now(),
      ...options,
    };
  }

  /**
   * Purpose: the WorldPop population inside a polygon (ring of `[lon, lat]`) in `WORLDPOP_YEAR`.
   * Output: people (not rounded). Throws WorldPopError after the last retry.
   */
  population(ring: [number, number][]): Promise<number> {
    const geojson = ringGeoJson(ring);
    const key = geojson;
    const hit = this.cache.get(key);
    if (hit && this.o.now() - hit.at < this.o.cacheMs) return hit.value;
    const value = this.limited(() => this.ask(geojson));
    value.catch(() => this.cache.delete(key));
    if (this.cache.size >= this.o.cacheSize) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { at: this.o.now(), value });
    return value;
  }

  private async limited<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.o.parallel) await new Promise<void>((r) => this.waiting.push(r));
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      this.waiting.shift()?.();
    }
  }

  private async ask(geojson: string): Promise<number> {
    const q = new URLSearchParams({
      dataset: "wpgppop",
      year: String(WORLDPOP_YEAR),
      geojson,
      runasync: "false",
    });
    let doc = await this.attempts(`${this.o.endpoint}/services/stats?${q.toString()}`);
    for (let i = 0; doc.status !== "finished" && !doc.error; i++) {
      if (!doc.taskid) throw new WorldPopError("WorldPop answered without a result or a task", 502);
      if (i >= this.o.maxPolls) throw new WorldPopError("WorldPop did not finish in time", 504);
      await this.o.sleep(this.o.pollMs);
      doc = await this.attempts(`${this.o.endpoint}/tasks/${encodeURIComponent(doc.taskid)}`);
    }
    if (doc.error) throw new WorldPopError(`WorldPop: ${doc.error_message ?? "error"}`, 502);
    const total = doc.data?.total_population;
    if (typeof total !== "number" || !Number.isFinite(total) || total < 0)
      throw new WorldPopError("WorldPop answered without a population", 502);
    return total;
  }

  private async attempts(url: string): Promise<z.infer<typeof answer>> {
    let lastError = new WorldPopError("WorldPop request failed", 502);
    for (const backoff of [0, ...this.o.backoffMs]) {
      if (backoff) await this.o.sleep(backoff + Math.random() * (backoff / 2));
      try {
        const body = await this.once(url);
        const parsed = answer.safeParse(body);
        if (!parsed.success) throw new WorldPopError("WorldPop answered an unexpected document", 502);
        return parsed.data;
      } catch (e) {
        lastError = e instanceof WorldPopError ? e : new WorldPopError(String(e), 502);
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
        throw new WorldPopError(`retry: WorldPop answered ${res.status}`, 502);
      if (!res.ok) throw new WorldPopError(`WorldPop answered ${res.status}`, 502);
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > this.o.maxBytes) throw new WorldPopError("WorldPop response too large", 502);
      const text = await res.text();
      if (text.length > this.o.maxBytes) throw new WorldPopError("WorldPop response too large", 502);
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new WorldPopError("WorldPop answered something other than JSON", 502);
      }
    } catch (e) {
      if (e instanceof WorldPopError) throw e;
      if (ctrl.signal.aborted) throw new WorldPopError("WorldPop request timed out", 504);
      throw new WorldPopError(`retry: ${e instanceof Error ? e.message : String(e)}`, 502);
    } finally {
      clearTimeout(timer);
    }
  }
}
