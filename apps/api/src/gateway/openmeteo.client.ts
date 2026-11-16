import { z } from "zod";

/**
 * Open-Meteo historical weather client: a provider of the outbound gateway (ADR-0017). The project climate
 * (ADR-0020 weather day types) reads 30 years of daily air temperatures at the project's location and keeps,
 * per month, the average of the daily mean, maximum and minimum and the spread of the daily maximum and
 * minimum. The project keeps its own copy, so a run does not depend on the service.
 *
 * Licence: the data is CC BY 4.0 (credit "Weather data by Open-Meteo.com"). The free API is for
 * non-commercial use; a commercial installation sets its own endpoint and key (`MOBSIMLAB_OPENMETEO_URL`,
 * `MOBSIMLAB_OPENMETEO_APIKEY`). Same outbound rules as the other providers: https endpoint, identifying
 * User-Agent, timeout, size limit, retries with backoff on 429/5xx and timeouts. Answers are cached for a day.
 */

export const DEFAULT_OPENMETEO_URL = "https://archive-api.open-meteo.com/v1/archive";
/** The climate normal period the monthly figures cover (WMO standard normal). */
export const CLIMATE_YEARS = { from: 1991, to: 2020 } as const;
const USER_AGENT = "MobSimLab/0.1 (+https://github.com/homlo-bike/MobSimLab)";
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const DAY_MS = 24 * 3600 * 1000;

/** Settings, with defaults for production. */
export interface OpenMeteoOptions {
  endpoint: string;
  apiKey: string | null;
  timeoutMs: number;
  maxBytes: number;
  backoffMs: number[];
  cacheMs: number;
  cacheSize: number;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

/** Error with an HTTP status the API can pass on (502 upstream failure, 504 timeout, 400 bad place). */
export class OpenMeteoError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** One month's climate, °C. */
export interface MonthClimate {
  /** Average of the daily mean temperature. */
  mean_c: number;
  /** Average of the daily maximum. */
  max_c: number;
  /** Average of the daily minimum. */
  min_c: number;
  /** Standard deviation of the daily maximum (how far a hot day goes above the average). */
  max_sd_c: number;
  /** Standard deviation of the daily minimum. */
  min_sd_c: number;
}

/** The climate at a place: twelve months, January first. */
export interface Climate {
  lat: number;
  lon: number;
  from_year: number;
  to_year: number;
  months: MonthClimate[];
}

/** Purpose: the endpoint and key from `MOBSIMLAB_OPENMETEO_URL` (https only) and `MOBSIMLAB_OPENMETEO_APIKEY`. */
export function openMeteoSettings(env: NodeJS.ProcessEnv = process.env): {
  endpoint: string;
  apiKey: string | null;
} {
  const v = env.MOBSIMLAB_OPENMETEO_URL;
  const endpoint = v
    ? z
        .url({ protocol: /^https$/ })
        .parse(v)
        .replace(/\/+$/, "")
    : DEFAULT_OPENMETEO_URL;
  return { endpoint, apiKey: env.MOBSIMLAB_OPENMETEO_APIKEY?.trim() || null };
}

const series = z.array(z.number().nullable()).max(20_000);
const answer = z.object({
  daily: z.object({
    time: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(20_000),
    temperature_2m_mean: series,
    temperature_2m_max: series,
    temperature_2m_min: series,
  }),
});

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Purpose: the monthly climate from daily temperatures.
 * Inputs: dates (YYYY-MM-DD) and the daily mean, maximum and minimum (null where missing).
 * Output: twelve months; a month without data throws.
 */
export function monthlyClimate(
  time: string[],
  mean: (number | null)[],
  max: (number | null)[],
  min: (number | null)[],
): MonthClimate[] {
  const acc = Array.from({ length: 12 }, () => ({ n: 0, mean: 0, max: 0, min: 0, max2: 0, min2: 0 }));
  time.forEach((d, i) => {
    const a = mean[i];
    const hi = max[i];
    const lo = min[i];
    if (a == null || hi == null || lo == null) return;
    const m = acc[Number(d.slice(5, 7)) - 1]!;
    m.n += 1;
    m.mean += a;
    m.max += hi;
    m.min += lo;
    m.max2 += hi * hi;
    m.min2 += lo * lo;
  });
  return acc.map((m, i) => {
    if (m.n < 2) throw new OpenMeteoError(`Open-Meteo has no temperatures for month ${i + 1}`, 502);
    const sd = (sum: number, sum2: number) => Math.sqrt(Math.max(0, (sum2 - (sum * sum) / m.n) / (m.n - 1)));
    return {
      mean_c: round1(m.mean / m.n),
      max_c: round1(m.max / m.n),
      min_c: round1(m.min / m.n),
      max_sd_c: round1(sd(m.max, m.max2)),
      min_sd_c: round1(sd(m.min, m.min2)),
    };
  });
}

export class OpenMeteoClient {
  private readonly o: OpenMeteoOptions;
  private readonly cache = new Map<string, { at: number; value: Promise<Climate> }>();

  constructor(options: Partial<OpenMeteoOptions> = {}) {
    this.o = {
      ...openMeteoSettings(),
      timeoutMs: 30_000,
      maxBytes: 4 * 1024 * 1024,
      backoffMs: [1_000, 3_000],
      cacheMs: DAY_MS,
      cacheSize: 200,
      fetchImpl: (...a) => fetch(...a),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => Date.now(),
      ...options,
    };
  }

  /**
   * Purpose: the monthly climate of 1991–2020 at a place.
   * Inputs: latitude and longitude in degrees; rounded to 0.1° (about the weather model's grid), which
   * also keeps the project's exact location out of the request.
   */
  climate(lat: number, lon: number): Promise<Climate> {
    if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180)
      throw new OpenMeteoError("not a place", 400);
    const la = Math.round(lat * 10) / 10;
    const lo = Math.round(lon * 10) / 10;
    const key = `${la}/${lo}`;
    const hit = this.cache.get(key);
    if (hit && this.o.now() - hit.at < this.o.cacheMs) return hit.value;
    const q = new URLSearchParams({
      latitude: String(la),
      longitude: String(lo),
      start_date: `${CLIMATE_YEARS.from}-01-01`,
      end_date: `${CLIMATE_YEARS.to}-12-31`,
      daily: "temperature_2m_mean,temperature_2m_max,temperature_2m_min",
      timezone: "auto",
    });
    if (this.o.apiKey) q.set("apikey", this.o.apiKey);
    const value = this.attempts(`${this.o.endpoint}?${q}`).then((body) => {
      const parsed = answer.safeParse(body);
      if (!parsed.success) throw new OpenMeteoError("Open-Meteo answered an unexpected document", 502);
      const d = parsed.data.daily;
      return {
        lat: la,
        lon: lo,
        from_year: CLIMATE_YEARS.from,
        to_year: CLIMATE_YEARS.to,
        months: monthlyClimate(d.time, d.temperature_2m_mean, d.temperature_2m_max, d.temperature_2m_min),
      };
    });
    value.catch(() => this.cache.delete(key));
    if (this.cache.size >= this.o.cacheSize) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { at: this.o.now(), value });
    return value;
  }

  private async attempts(url: string): Promise<unknown> {
    let lastError = new OpenMeteoError("Open-Meteo request failed", 502);
    for (const backoff of [0, ...this.o.backoffMs]) {
      if (backoff) await this.o.sleep(backoff + Math.random() * (backoff / 2));
      try {
        return await this.once(url);
      } catch (e) {
        lastError = e instanceof OpenMeteoError ? e : new OpenMeteoError(String(e), 502);
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
        throw new OpenMeteoError(`retry: Open-Meteo answered ${res.status}`, 502);
      if (res.status === 400) throw new OpenMeteoError("Open-Meteo has no weather for this place", 400);
      if (!res.ok) throw new OpenMeteoError(`Open-Meteo answered ${res.status}`, 502);
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > this.o.maxBytes) throw new OpenMeteoError("Open-Meteo response too large", 502);
      const text = await res.text();
      if (text.length > this.o.maxBytes) throw new OpenMeteoError("Open-Meteo response too large", 502);
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new OpenMeteoError("Open-Meteo answered something other than JSON", 502);
      }
    } catch (e) {
      if (e instanceof OpenMeteoError) throw e;
      if (ctrl.signal.aborted) throw new OpenMeteoError("Open-Meteo request timed out", 504);
      throw new OpenMeteoError(`retry: ${e instanceof Error ? e.message : String(e)}`, 502);
    } finally {
      clearTimeout(timer);
    }
  }
}
