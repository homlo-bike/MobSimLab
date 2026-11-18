import { lookup } from "node:dns/promises";
import { gbfsUrlAllowed, publicAddress } from "../gateway/gbfs.client";

/**
 * Outbound requests of the street photo sources (bundled plugins `org.mobsimlab.panoramax` and, later,
 * `org.mobsimlab.mapillary`): a provider of the outbound gateway (ADR-0017) with its rules. Only https addresses of
 * public hosts (checked after every name lookup, so a photo address cannot point the API inside its own network),
 * a few redirects at most, each checked the same way, an identifying User-Agent, a timeout and a size limit.
 * Error messages never hold a URL, because a keyed source's URL holds its key.
 */

export const USER_AGENT = "MobSimLab/0.1 (+https://github.com/homlo-bike/MobSimLab)";

/** Error with an HTTP status the API passes on (404 nothing there, 502 upstream failure, 504 timeout). */
export class PhotoError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface OutboundOptions {
  timeoutMs: number;
  fetchImpl: typeof fetch;
  /** Every address a host name resolves to (injectable for tests). */
  resolveImpl: (host: string) => Promise<string[]>;
}

export const defaultOutbound = (): OutboundOptions => ({
  timeoutMs: 10_000,
  fetchImpl: fetch,
  resolveImpl: async (host) => (await lookup(host, { all: true })).map((a) => a.address),
});

/** How many redirects a photo address may take (picture servers send the browser on to their storage). */
const MAX_REDIRECTS = 3;
/** How long a host's checked addresses are trusted before they are looked up again. */
const RESOLVE_CACHE_MS = 5 * 60_000;

/** An answer that has been read in full, within its size limit. */
export interface Fetched {
  status: number;
  contentType: string;
  cacheControl: string | null;
  body: Buffer;
}

export class Outbound {
  private readonly checked = new Map<string, number>();

  constructor(
    private readonly o: OutboundOptions,
    /** Who answers, for error messages ("Panoramax"). */
    private readonly name: string,
  ) {}

  /**
   * Purpose: GET an https address of a public host, following up to three redirects that are checked the same
   * way. Inputs: the address, the Accept header and the largest body to read. Output: the answer, read in full.
   * Throws PhotoError: 400 for an address that may not be read, 502 when the host fails or the body is too
   * large, 504 on timeout. Answers other than 2xx are returned, so callers decide what a 404 means.
   */
  async get(raw: string, accept: string, maxBytes: number): Promise<Fetched> {
    let url = raw;
    for (let hop = 0; ; hop++) {
      if (!gbfsUrlAllowed(url))
        throw new PhotoError(`${this.name} named an address MobSimLab may not read`, 502);
      await this.checkHost(new URL(url).hostname);
      let res: Response;
      try {
        res = await this.o.fetchImpl(url, {
          headers: { "User-Agent": USER_AGENT, Accept: accept },
          redirect: "manual",
          signal: AbortSignal.timeout(this.o.timeoutMs),
        });
      } catch (e) {
        const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        throw new PhotoError(
          timeout ? `${this.name} did not answer in time` : `${this.name} could not be reached`,
          timeout ? 504 : 502,
        );
      }
      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel().catch(() => undefined);
        const next = res.headers.get("location");
        if (!next || hop >= MAX_REDIRECTS) throw new PhotoError(`${this.name} sent too many redirects`, 502);
        url = new URL(next, url).toString();
        continue;
      }
      return {
        status: res.status,
        contentType: (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase(),
        cacheControl: res.headers.get("cache-control"),
        body: await this.limited(res, maxBytes),
      };
    }
  }

  /** Purpose: GET JSON; throws PhotoError 502 on an answer other than 2xx JSON. */
  async json(url: string, maxBytes: number): Promise<unknown> {
    const r = await this.get(url, "application/json", maxBytes);
    if (r.status === 404) throw new PhotoError(`${this.name} has nothing there`, 404);
    if (r.status < 200 || r.status >= 300) throw new PhotoError(`${this.name} answered ${r.status}`, 502);
    try {
      return JSON.parse(r.body.toString("utf8"));
    } catch {
      throw new PhotoError(`${this.name} did not answer with JSON`, 502);
    }
  }

  /** Purpose: refuse hosts that resolve inside a private network (SSRF), remembering good hosts for a while. */
  private async checkHost(host: string): Promise<void> {
    const at = this.checked.get(host);
    if (at !== undefined && Date.now() - at < RESOLVE_CACHE_MS) return;
    let addresses: string[];
    try {
      addresses = await this.o.resolveImpl(host);
    } catch {
      throw new PhotoError(`${this.name} could not be reached`, 502);
    }
    if (addresses.length === 0 || !addresses.every(publicAddress))
      throw new PhotoError(`${this.name} named an address MobSimLab may not read`, 502);
    if (this.checked.size > 1000) this.checked.clear();
    this.checked.set(host, Date.now());
  }

  /** Purpose: the body, stopping as soon as it passes `max` bytes (a huge answer is never held in full). */
  private async limited(res: Response, max: number): Promise<Buffer> {
    const length = Number(res.headers.get("content-length") ?? "0");
    if (length > max) {
      await res.body?.cancel().catch(() => undefined);
      throw new PhotoError(`${this.name}'s answer is too large`, 502);
    }
    if (!res.body) return Buffer.alloc(0);
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel().catch(() => undefined);
        throw new PhotoError(`${this.name}'s answer is too large`, 502);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }
}
