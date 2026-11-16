import { z } from "zod";

/**
 * Nager.Date public holidays API client: a provider of the outbound gateway (ADR-0017). The project calendar
 * (ADR-0020) reads each year's public holidays of the project's country from it; the project keeps its own copy,
 * so a run does not depend on the service. Same outbound rules as the other providers: https endpoint,
 * identifying User-Agent, timeout, size limit, retries with backoff on 429/5xx and timeouts. Answers are cached
 * for a day.
 */

export const DEFAULT_NAGER_URL = "https://date.nager.at/api/v3";
const USER_AGENT = "MobSimLab/0.1 (+https://github.com/homlo-bike/MobSimLab)";
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const DAY_MS = 24 * 3600 * 1000;

/** Settings, with defaults for production. */
export interface NagerOptions {
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

/** Error with an HTTP status the API can pass on (502 upstream failure, 504 timeout, 404 unknown country). */
export class NagerError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** One public holiday. */
export interface PublicHoliday {
  /** YYYY-MM-DD. */
  date: string;
  /** Name in the country's language. */
  localName: string;
  /** English name. */
  name: string;
  /** Regions (ISO 3166-2, such as DE-BY) the holiday is limited to; null when it applies to the whole country. */
  regions: string[] | null;
}

/** Purpose: read the endpoint from `MOBSIMLAB_NAGER_URL`; only https URLs are accepted. */
export function nagerEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  const v = env.MOBSIMLAB_NAGER_URL;
  if (!v) return DEFAULT_NAGER_URL;
  return z
    .url({ protocol: /^https$/ })
    .parse(v)
    .replace(/\/+$/, "");
}

const row = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  localName: z.string().max(200),
  name: z.string().max(200),
  global: z.boolean().optional(),
  counties: z.array(z.string().max(20)).nullable().optional(),
  types: z.array(z.string()).nullable().optional(),
});
const list = z.array(row).max(400);

export class NagerClient {
  private readonly o: NagerOptions;
  private readonly cache = new Map<string, { at: number; value: Promise<PublicHoliday[]> }>();

  constructor(options: Partial<NagerOptions> = {}) {
    this.o = {
      endpoint: nagerEndpoint(),
      timeoutMs: 15_000,
      maxBytes: 512 * 1024,
      backoffMs: [1_000, 3_000],
      cacheMs: DAY_MS,
      cacheSize: 500,
      fetchImpl: (...a) => fetch(...a),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => Date.now(),
      ...options,
    };
  }

  /**
   * Purpose: the public holidays of a country in a year, by date. Only days off for the public count
   * (Nager.Date type "Public"); bank, school and optional holidays are left out.
   * Inputs: ISO 3166-1 alpha-2 country code, year (1900–2200).
   */
  holidays(country: string, year: number): Promise<PublicHoliday[]> {
    const c = country.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(c)) throw new NagerError(`not a country code: "${country.slice(0, 10)}"`, 400);
    if (!Number.isInteger(year) || year < 1900 || year > 2200) throw new NagerError("not a year", 400);
    const key = `${c}/${year}`;
    const hit = this.cache.get(key);
    if (hit && this.o.now() - hit.at < this.o.cacheMs) return hit.value;
    const value = this.attempts(`${this.o.endpoint}/PublicHolidays/${year}/${c}`).then((body) => {
      const parsed = list.safeParse(body);
      if (!parsed.success) throw new NagerError("Nager.Date answered an unexpected document", 502);
      return parsed.data
        .filter((h) => !h.types || h.types.length === 0 || h.types.includes("Public"))
        .map((h) => ({
          date: h.date,
          localName: h.localName,
          name: h.name,
          regions: h.global === false && h.counties?.length ? h.counties : null,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
    });
    value.catch(() => this.cache.delete(key));
    if (this.cache.size >= this.o.cacheSize) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { at: this.o.now(), value });
    return value;
  }

  private async attempts(url: string): Promise<unknown> {
    let lastError = new NagerError("Nager.Date request failed", 502);
    for (const backoff of [0, ...this.o.backoffMs]) {
      if (backoff) await this.o.sleep(backoff + Math.random() * (backoff / 2));
      try {
        return await this.once(url);
      } catch (e) {
        lastError = e instanceof NagerError ? e : new NagerError(String(e), 502);
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
      if (res.status === 404) throw new NagerError("Nager.Date has no holidays for this country", 404);
      if (RETRY_STATUS.has(res.status)) throw new NagerError(`retry: Nager.Date answered ${res.status}`, 502);
      if (!res.ok) throw new NagerError(`Nager.Date answered ${res.status}`, 502);
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > this.o.maxBytes) throw new NagerError("Nager.Date response too large", 502);
      const text = await res.text();
      if (text.length > this.o.maxBytes) throw new NagerError("Nager.Date response too large", 502);
      // An unknown country answers 204 with no body.
      if (res.status === 204 || text.trim() === "")
        throw new NagerError("Nager.Date has no holidays for this country", 404);
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new NagerError("Nager.Date answered something other than JSON", 502);
      }
    } catch (e) {
      if (e instanceof NagerError) throw e;
      if (ctrl.signal.aborted) throw new NagerError("Nager.Date request timed out", 504);
      throw new NagerError(`retry: ${e instanceof Error ? e.message : String(e)}`, 502);
    } finally {
      clearTimeout(timer);
    }
  }
}
