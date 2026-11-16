import { isIP } from "node:net";

/**
 * GBFS reader (General Bikeshare Feed Specification, versions 1 to 3): the stations of a shared-bike scheme, for
 * the demand model (ADR-0019). The planner enters the feed's URL, either its auto-discovery file (`gbfs.json`)
 * or its `station_information.json`. Only https URLs of named hosts are read, without redirects, with a
 * timeout and a size limit, and at most two files per feed.
 */

const USER_AGENT = "MobSimLab/0.1 (+https://github.com/homlo-bike/MobSimLab)";

export class GbfsError extends Error {}

export interface GbfsOptions {
  timeoutMs: number;
  maxBytes: number;
  fetchImpl: typeof fetch;
}

/** Purpose: whether a URL may be read: https, a host name (no IP address, no local or internal name). */
export function gbfsUrlAllowed(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    u.protocol === "https:" &&
    !u.username &&
    !u.password &&
    !isIP(host) &&
    host.includes(".") &&
    !/(^|\.)(localhost|local|internal|intranet|lan|home|corp)$/.test(host)
  );
}

/** Purpose: the stations of a GBFS `station_information` file as `[lon, lat]`. */
export function gbfsStations(json: unknown): [number, number][] {
  const stations = (json as { data?: { stations?: unknown } } | null)?.data?.stations;
  if (!Array.isArray(stations)) throw new GbfsError("the feed has no station list");
  const out: [number, number][] = [];
  for (const s of stations as { lon?: unknown; lat?: unknown }[]) {
    const lon = Number(s?.lon);
    const lat = Number(s?.lat);
    if (Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90)
      out.push([Math.round(lon * 1e7) / 1e7, Math.round(lat * 1e7) / 1e7]);
  }
  return out;
}

/** Purpose: the `station_information` URL listed in a GBFS auto-discovery file, any version or language. */
export function stationInformationUrl(json: unknown): string | null {
  const data = (json as { data?: unknown } | null)?.data as Record<string, unknown> | undefined;
  if (!data) return null;
  const lists: unknown[] = [];
  if (Array.isArray(data.feeds)) lists.push(data.feeds);
  for (const v of Object.values(data)) {
    const f = (v as { feeds?: unknown } | null)?.feeds;
    if (Array.isArray(f)) lists.push(f);
  }
  for (const feeds of lists)
    for (const f of feeds as { name?: unknown; url?: unknown }[])
      if (f?.name === "station_information" && typeof f.url === "string") return f.url;
  return null;
}

export class GbfsClient {
  private readonly o: GbfsOptions;

  constructor(options: Partial<GbfsOptions> = {}) {
    this.o = {
      timeoutMs: 15_000,
      maxBytes: 8 * 1024 * 1024,
      fetchImpl: (...a) => fetch(...a),
      ...options,
    };
  }

  /**
   * Purpose: the stations of the shared-bike scheme a GBFS URL names.
   * Side effects: one or two https requests. Throws `GbfsError` with a reason the planner can act on.
   */
  async stations(url: string): Promise<[number, number][]> {
    const first = await this.json(url);
    const info = (first as { data?: { stations?: unknown } } | null)?.data?.stations
      ? null
      : stationInformationUrl(first);
    if (info === null) return gbfsStations(first);
    return gbfsStations(await this.json(info));
  }

  private async json(url: string): Promise<unknown> {
    if (!gbfsUrlAllowed(url))
      throw new GbfsError("the GBFS feed must be an https address of a public server");
    let res: Response;
    try {
      res = await this.o.fetchImpl(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(this.o.timeoutMs),
      });
    } catch {
      throw new GbfsError("the GBFS feed could not be reached");
    }
    if (!res.ok) throw new GbfsError(`the GBFS feed answered ${res.status}`);
    const text = await res.text();
    if (text.length > this.o.maxBytes) throw new GbfsError("the GBFS feed is too large");
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new GbfsError("the GBFS feed is not JSON");
    }
  }
}
