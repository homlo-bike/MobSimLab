import { z } from "zod";

/**
 * World Bank Indicators API client (World Development Indicators): a provider of the outbound gateway
 * (ADR-0017). The cost tables (ADR-0039) read price levels and exchange rates from it. Same outbound
 * rules as the other providers: https endpoint, identifying User-Agent, timeout, size limit, retries with
 * backoff on 429/5xx and timeouts. Answers are cached for a day; the indicators change once a year.
 */

export const DEFAULT_WORLDBANK_URL = "https://api.worldbank.org/v2";
const USER_AGENT = "MobSimLab/0.1 (+https://github.com/homlo-bike/MobSimLab)";
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const DAY_MS = 24 * 3600 * 1000;

/** Settings, with defaults for production. */
export interface WorldBankOptions {
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
export class WorldBankError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** One yearly value of an indicator. */
export interface IndicatorValue {
  year: number;
  value: number;
}

/** A country (not an aggregate such as a region or income group) of the World Bank's list. */
export interface WbCountry {
  iso3: string;
  iso2: string;
  name: string;
}

/** Purpose: read the endpoint from `MOBSIMLAB_WORLDBANK_URL`; only https URLs are accepted. */
export function worldBankEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  const v = env.MOBSIMLAB_WORLDBANK_URL;
  if (!v) return DEFAULT_WORLDBANK_URL;
  return z
    .url({ protocol: /^https$/ })
    .parse(v)
    .replace(/\/+$/, "");
}

const observation = z.object({
  date: z.string(),
  value: z.number().nullable(),
  countryiso3code: z.string().optional(),
  country: z.object({ id: z.string(), value: z.string() }).optional(),
});
const page = z.tuple([z.looseObject({ page: z.number().optional() }), z.array(observation).nullable()]);
const countryRow = z.object({
  id: z.string(),
  iso2Code: z.string(),
  name: z.string(),
  region: z.object({ id: z.string(), value: z.string() }),
});
const countryPage = z.tuple([z.looseObject({}), z.array(countryRow).nullable()]);

/** Purpose: a country code the API accepts (ISO 3166-1 alpha-2 or alpha-3), upper case; throws otherwise. */
export function countryCode(code: string): string {
  const c = code.trim().toUpperCase();
  if (!/^[A-Z]{2,3}$/.test(c)) throw new WorldBankError(`not a country code: "${code.slice(0, 10)}"`, 400);
  return c;
}

/** Purpose: an indicator code such as PA.NUS.PPP; throws otherwise. */
function indicatorCode(code: string): string {
  if (!/^[A-Z0-9]+(\.[A-Z0-9]+)+$/.test(code)) throw new WorldBankError(`not an indicator: ${code}`, 400);
  return code;
}

export class WorldBankClient {
  private readonly o: WorldBankOptions;
  private readonly cache = new Map<string, { at: number; value: Promise<unknown> }>();

  constructor(options: Partial<WorldBankOptions> = {}) {
    this.o = {
      endpoint: worldBankEndpoint(),
      timeoutMs: 20_000,
      maxBytes: 4 * 1024 * 1024,
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
   * Purpose: the latest non-empty yearly value of an indicator for a country, or null when the World
   * Bank has none. Inputs: ISO country code (2 or 3 letters), indicator code.
   */
  async latest(country: string, indicator: string): Promise<IndicatorValue | null> {
    const c = countryCode(country);
    const rows = await this.series(`country/${c}/indicator/${indicatorCode(indicator)}?format=json&mrnev=1`);
    return rows[0] ?? null;
  }

  /**
   * Purpose: the yearly values of an indicator for a country between two years (inclusive), oldest
   * first, without empty years.
   */
  async range(country: string, indicator: string, from: number, to: number): Promise<IndicatorValue[]> {
    const c = countryCode(country);
    const a = Math.trunc(from);
    const b = Math.trunc(to);
    const rows = await this.series(
      `country/${c}/indicator/${indicatorCode(indicator)}?format=json&date=${a}:${b}&per_page=100`,
    );
    return rows.sort((x, y) => x.year - y.year);
  }

  /** Purpose: every country of the World Bank's list (aggregates left out), sorted by name. */
  countries(): Promise<WbCountry[]> {
    return this.cached("countries", async () => {
      const body = await this.attempts(`${this.o.endpoint}/country?format=json&per_page=400`);
      const parsed = countryPage.safeParse(body);
      if (!parsed.success) throw new WorldBankError("World Bank answered an unexpected country list", 502);
      return (parsed.data[1] ?? [])
        .filter((r) => r.region.id !== "NA" && r.region.value !== "Aggregates")
        .map((r) => ({ iso3: r.id, iso2: r.iso2Code, name: r.name }))
        .sort((x, y) => x.name.localeCompare(y.name));
    });
  }

  private series(path: string): Promise<IndicatorValue[]> {
    return this.cached(path, async () => {
      const body = await this.attempts(`${this.o.endpoint}/${path}`);
      // An unknown country or indicator answers [{"message": [...]}].
      if (
        Array.isArray(body) &&
        body.length === 1 &&
        body[0] &&
        typeof body[0] === "object" &&
        "message" in body[0]
      )
        throw new WorldBankError("World Bank does not know this country or indicator", 404);
      const parsed = page.safeParse(body);
      if (!parsed.success) throw new WorldBankError("World Bank answered an unexpected document", 502);
      return (parsed.data[1] ?? [])
        .filter((r) => r.value !== null && /^\d{4}$/.test(r.date))
        .map((r) => ({ year: Number(r.date), value: r.value as number }));
    });
  }

  private cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && this.o.now() - hit.at < this.o.cacheMs) return hit.value as Promise<T>;
    const value = fn();
    value.catch(() => this.cache.delete(key));
    if (this.cache.size >= this.o.cacheSize) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { at: this.o.now(), value });
    return value;
  }

  private async attempts(url: string): Promise<unknown> {
    let lastError = new WorldBankError("World Bank request failed", 502);
    for (const backoff of [0, ...this.o.backoffMs]) {
      if (backoff) await this.o.sleep(backoff + Math.random() * (backoff / 2));
      try {
        return await this.once(url);
      } catch (e) {
        lastError = e instanceof WorldBankError ? e : new WorldBankError(String(e), 502);
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
        throw new WorldBankError(`retry: World Bank answered ${res.status}`, 502);
      if (!res.ok) throw new WorldBankError(`World Bank answered ${res.status}`, 502);
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > this.o.maxBytes) throw new WorldBankError("World Bank response too large", 502);
      const text = await res.text();
      if (text.length > this.o.maxBytes) throw new WorldBankError("World Bank response too large", 502);
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new WorldBankError("World Bank answered something other than JSON", 502);
      }
    } catch (e) {
      if (e instanceof WorldBankError) throw e;
      if (ctrl.signal.aborted) throw new WorldBankError("World Bank request timed out", 504);
      throw new WorldBankError(`retry: ${e instanceof Error ? e.message : String(e)}`, 502);
    } finally {
      clearTimeout(timer);
    }
  }
}
