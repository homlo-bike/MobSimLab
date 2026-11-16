import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * Large files of the outbound gateway (ADR-0017) kept on the data volume: population grids from WorldPop and
 * GHSL. A file is downloaded once into its provider's folder and read from there; least recently used files
 * (by modification time, which readers touch) are deleted beyond the folder's size. Same outbound rules as the
 * other clients: https only, identifying User-Agent, timeouts, size limits, retries with backoff on 429/5xx and
 * timeouts, no redirects.
 */

const USER_AGENT = "MobSimLab/0.1 (+https://github.com/homlo-bike/MobSimLab)";
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

/** Settings of one provider's download folder. */
export interface DownloadCacheOptions {
  /** Provider name in error messages ("WorldPop", "GHSL"). */
  label: string;
  cacheDir: string;
  /** Largest file downloaded, bytes. */
  maxFileBytes: number;
  /** Disk kept for downloaded files, bytes. */
  maxCacheBytes: number;
  timeoutMs: number;
  downloadTimeoutMs: number;
  backoffMs: number[];
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  /** Builds the error thrown, with an HTTP status the API can pass on (502 upstream failure, 504 timeout). */
  error: (message: string, status: number) => Error;
  /** Called with a file's name when it is deleted to make room. */
  onEvict?: (name: string) => void;
}

/** A GET answered with something other than 200; `status` is the provider's answer. */
export class UpstreamStatus extends Error {
  constructor(readonly upstream: number) {
    super(`answered ${upstream}`);
  }
}

/** Purpose: a safe file name for a URL's last path segment. */
export function fileNameOf(url: string): string {
  return url.slice(url.lastIndexOf("/") + 1).replace(/[^A-Za-z0-9._-]/g, "_");
}

export class DownloadCache {
  /** Bytes received of the downloads under way, by URL, so a waiting request can show how far it is. */
  private readonly downloads = new Map<string, { receivedBytes: number; totalBytes: number | null }>();

  constructor(readonly o: DownloadCacheOptions) {}

  /**
   * Purpose: GET with retries. Output: the 200 response and `finish`, which ends its timeout; call it once the
   * body is read (the timeout covers reading the body too). `missing` lists statuses returned as
   * `UpstreamStatus` instead of a provider error (for example 404 for a tile that does not exist).
   */
  async request(
    url: string,
    timeoutMs: number,
    missing: number[] = [],
  ): Promise<{ res: Response; finish: () => void }> {
    const label = this.o.label;
    let lastError = this.o.error(`${label} request failed`, 502);
    for (const backoff of [0, ...this.o.backoffMs]) {
      if (backoff) await this.o.sleep(backoff + Math.random() * (backoff / 2));
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const finish = () => clearTimeout(timer);
      try {
        const res = await this.o.fetchImpl(url, {
          headers: { "User-Agent": USER_AGENT },
          signal: ctrl.signal,
          redirect: "error",
        });
        if (RETRY_STATUS.has(res.status)) {
          finish();
          lastError = this.o.error(`${label} answered ${res.status}`, 502);
          continue;
        }
        if (missing.includes(res.status)) {
          finish();
          await res.body?.cancel();
          throw new UpstreamStatus(res.status);
        }
        if (res.status !== 200) throw this.o.error(`${label} answered ${res.status}`, 502);
        return { res, finish };
      } catch (e) {
        finish();
        if (e instanceof UpstreamStatus) throw e;
        if (e instanceof Error && "status" in e && !ctrl.signal.aborted) throw e;
        lastError = ctrl.signal.aborted
          ? this.o.error(`${label} request timed out`, 504)
          : this.o.error(e instanceof Error ? e.message : String(e), 502);
      }
    }
    throw lastError;
  }

  /** Purpose: the path a URL's file has in the folder, and whether it is there already. */
  async cached(url: string): Promise<{ path: string; present: boolean }> {
    const path = join(this.o.cacheDir, fileNameOf(url));
    return { path, present: !!(await stat(path).catch(() => null)) };
  }

  /**
   * Purpose: how far the download of a URL is, or null when none is under way (not started, finished or
   * failed). `totalBytes` is null when the provider does not say the size.
   */
  progress(url: string): { receivedBytes: number; totalBytes: number | null } | null {
    const d = this.downloads.get(url);
    return d ? { ...d } : null;
  }

  /**
   * Purpose: download a URL to `path` through a temporary name, within the size limit, making room first.
   * `missing` statuses throw `UpstreamStatus` (see `request`).
   */
  async download(url: string, path: string, missing: number[] = []): Promise<void> {
    await mkdir(this.o.cacheDir, { recursive: true });
    this.downloads.set(url, { receivedBytes: 0, totalBytes: null });
    try {
      const { res, finish } = await this.request(url, this.o.downloadTimeoutMs, missing);
      try {
        await this.save(res, path, url);
      } finally {
        finish();
      }
    } finally {
      this.downloads.delete(url);
    }
  }

  private async save(res: Response, path: string, url: string): Promise<void> {
    const label = this.o.label;
    const declared = Number(res.headers.get("content-length") ?? 0);
    const progress = this.downloads.get(url);
    if (progress) progress.totalBytes = declared || null;
    if (declared > this.o.maxFileBytes) {
      await res.body?.cancel();
      throw this.o.error(
        `The ${label} file is ${Math.round(declared / 1e6)} MB, above the ${Math.round(this.o.maxFileBytes / 1e6)} MB limit`,
        502,
      );
    }
    await this.makeRoom(declared);
    if (!res.body) throw this.o.error(`${label} answered without a body`, 502);
    const tmp = `${path}.part-${process.pid}-${Date.now()}`;
    let got = 0;
    const max = this.o.maxFileBytes;
    const tooBig = this.o.error(`The ${label} file is above the size limit`, 502);
    const limit = new Transform({
      transform(chunk: Buffer, _enc, done) {
        got += chunk.length;
        if (progress) progress.receivedBytes = got;
        if (got > max) done(tooBig);
        else done(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(res.body as never), limit, createWriteStream(tmp));
      if (declared && got !== declared) throw this.o.error(`The ${label} download was cut short`, 502);
      await rename(tmp, path);
    } catch (e) {
      await rm(tmp, { force: true });
      if (e instanceof Error && "status" in e) throw e;
      if (e instanceof Error && e.name === "AbortError")
        throw this.o.error(`The ${label} download timed out`, 504);
      throw this.o.error(`The ${label} download failed: ${e instanceof Error ? e.message : String(e)}`, 502);
    }
  }

  /** Purpose: delete the least recently used files until `incoming` more bytes fit the folder. */
  async makeRoom(incoming: number): Promise<void> {
    const dir = this.o.cacheDir;
    const names = await readdir(dir).catch(() => [] as string[]);
    const files = (
      await Promise.all(
        names.map(async (n) => {
          const p = join(dir, n);
          const s = await stat(p).catch(() => null);
          return s?.isFile() ? { p, size: s.size, used: s.mtimeMs, part: n.includes(".part-") } : null;
        }),
      )
    ).filter((f): f is NonNullable<typeof f> => !!f);
    // Left-over partial downloads older than the download timeout go first.
    const stale = Date.now() - this.o.downloadTimeoutMs;
    for (const f of files.filter((f) => f.part && f.used < stale)) await rm(f.p, { force: true });
    const kept = files.filter((f) => !f.part).sort((a, b) => a.used - b.used);
    let total = kept.reduce((s, f) => s + f.size, 0) + incoming;
    for (const f of kept) {
      if (total <= this.o.maxCacheBytes) break;
      await rm(f.p, { force: true });
      total -= f.size;
      this.o.onEvict?.(basename(f.p));
    }
  }
}
