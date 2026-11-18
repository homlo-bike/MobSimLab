import { z } from "zod";

/**
 * Overpass API client: the first provider of the outbound gateway (ADR-0017).
 * Rules from 06-gis §2.3: configurable HTTPS endpoint, identifying User-Agent, one request at a
 * time with a minimum interval (a query backing off before a retry lets the others go first), retries with backoff and jitter on 429/502/503/504 and timeouts,
 * a timeout and a response size limit. Read-only queries only.
 * Private-range blocking, per-provider health and the admin UI arrive with the full gateway module.
 */

export const DEFAULT_OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const USER_AGENT = "MobSimLab/0.1 (+https://github.com/homlo-bike/MobSimLab)";
const RETRY_STATUS = new Set([429, 502, 503, 504]);

/** Settings, with defaults for production. */
export interface OverpassOptions {
  endpoint: string;
  timeoutMs: number;
  maxBytes: number;
  minIntervalMs: number;
  backoffMs: number[];
  /** Retry a query that timed out. Imports turn this off and split the area instead. */
  retryTimeouts: boolean;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}

/** Error with an HTTP status the API can pass on (502 upstream failure, 504 timeout). */
export class OverpassError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Purpose: read the endpoint from `MOBSIMLAB_OVERPASS_URL`; only https URLs are accepted. */
export function overpassEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  const v = env.MOBSIMLAB_OVERPASS_URL;
  if (!v) return DEFAULT_OVERPASS_URL;
  return z.url({ protocol: /^https$/ }).parse(v);
}

export class OverpassClient {
  private readonly o: OverpassOptions;
  private queue: Promise<unknown> = Promise.resolve();
  private last = 0;

  constructor(options: Partial<OverpassOptions> = {}) {
    this.o = {
      endpoint: overpassEndpoint(),
      timeoutMs: 90_000,
      maxBytes: 64 * 1024 * 1024,
      minIntervalMs: 1_000,
      backoffMs: [2_000, 4_000, 8_000],
      retryTimeouts: true,
      fetchImpl: (...a) => fetch(...a),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      ...options,
    };
  }

  /**
   * Purpose: run one Overpass QL query.
   * Output: the response body. Throws OverpassError after the last retry.
   * Side effects: one outbound HTTPS request at a time, spaced by `minIntervalMs`. A query waiting to retry
   * gives up its turn while it backs off, so the next queries are not held up behind it. An aborted `signal`
   * stops the request under way and any retry (an import cancelled by the planner).
   */
  run(query: string, signal?: AbortSignal): Promise<string> {
    return this.attempts(query, signal);
  }

  /** Purpose: run `f` when no other request is under way, at least `minIntervalMs` after the last one. */
  private inTurn<T>(f: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      const wait = this.last + this.o.minIntervalMs - Date.now();
      if (wait > 0) await this.o.sleep(wait);
      this.last = Date.now();
      return f();
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async attempts(query: string, signal?: AbortSignal): Promise<string> {
    let lastError = new OverpassError("Overpass request failed", 502);
    for (const backoff of [0, ...this.o.backoffMs]) {
      if (signal?.aborted) throw new OverpassError("Overpass request cancelled", 499);
      if (backoff) await this.o.sleep(backoff + Math.random() * (backoff / 2));
      if (signal?.aborted) throw new OverpassError("Overpass request cancelled", 499);
      try {
        return await this.inTurn(() => {
          if (signal?.aborted) throw new OverpassError("Overpass request cancelled", 499);
          return this.once(query, signal);
        });
      } catch (e) {
        lastError = e instanceof OverpassError ? e : new OverpassError(String(e), 502);
        if (lastError.status === 499) throw lastError;
        const timedOut = lastError.status === 504 && this.o.retryTimeouts;
        if (!(timedOut || lastError.message.startsWith("retry"))) throw lastError;
      }
    }
    // After the last retry: say what happened in words, and that it is usually temporary.
    const why = lastError.message.replace(/^retry: /, "");
    throw new OverpassError(
      `OpenStreetMap's Overpass service is busy or cannot be reached (${why}). This is usually temporary: ` +
        "try again in a few minutes, or import the area's OpenStreetMap data into the project (Map data) so it is " +
        "read from there.",
      lastError.status,
    );
  }

  private async once(query: string, signal?: AbortSignal): Promise<string> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.o.timeoutMs);
    const stop = () => ctrl.abort();
    signal?.addEventListener("abort", stop, { once: true });
    try {
      const res = await this.o.fetchImpl(this.o.endpoint, {
        method: "POST",
        headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: query }).toString(),
        signal: ctrl.signal,
        redirect: "error",
      });
      if (RETRY_STATUS.has(res.status))
        throw new OverpassError(`retry: Overpass answered ${res.status}`, 502);
      if (!res.ok) throw new OverpassError(`Overpass answered ${res.status}`, 502);
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > this.o.maxBytes) throw new OverpassError("Overpass response too large", 502);
      const body = await res.text();
      if (body.length > this.o.maxBytes) throw new OverpassError("Overpass response too large", 502);
      return body;
    } catch (e) {
      if (e instanceof OverpassError) throw e;
      if (signal?.aborted) throw new OverpassError("Overpass request cancelled", 499);
      if (ctrl.signal.aborted) throw new OverpassError("Overpass request timed out", 504);
      throw new OverpassError(`retry: ${e instanceof Error ? e.message : String(e)}`, 502);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
    }
  }
}
