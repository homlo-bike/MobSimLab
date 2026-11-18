/**
 * The project's noise map saved with the project (GIS tab, Map data): the finished result as gzip-compressed
 * JSON, its pictures and grid levels as base64, so it shows again on opening without working it out once more.
 */
import type { Done } from "./result";

/** Format of the saved result; a newer app reads older ones, an unknown one is worked out again. */
const VERSION = 1;

/** A noise map read back from the project: the result and when it was worked out. */
export interface SavedNoise {
  result: Done;
  computedAt: string | null;
}

/** Reading and replacing the project's saved noise map. */
export interface NoiseResultApi {
  /** The saved noise map, or null when the project has none (or one this app cannot read). */
  load(): Promise<SavedNoise | null>;
  /** Keep a newly worked out noise map; resolves to when it was saved. */
  save(result: Done): Promise<string | null>;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + 0x8000)));
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Purpose: the result as JSON text, with its typed arrays as tagged base64. */
export function noiseToJson(result: Done): string {
  return JSON.stringify({ version: VERSION, result }, (_k, v: unknown) => {
    if (v instanceof Float32Array)
      return { $f32: toBase64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    if (v instanceof Uint8Array) return { $u8: toBase64(v) };
    return v;
  });
}

/** Purpose: the result from `noiseToJson` text; null for another format. */
export function noiseFromJson(text: string): Done | null {
  const doc = JSON.parse(text, (_k, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      if (typeof o.$u8 === "string") return fromBase64(o.$u8);
      if (typeof o.$f32 === "string") {
        const b = fromBase64(o.$f32);
        return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
      }
    }
    return v;
  }) as { version?: unknown; result?: Done };
  return doc.version === VERSION && doc.result?.kind === "done" ? doc.result : null;
}

async function gzip(text: string): Promise<Blob> {
  const stream = new Response(text).body!.pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).blob();
}

async function gunzip(bytes: ArrayBuffer): Promise<string> {
  const stream = new Response(bytes).body!.pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

/**
 * Purpose: the saved noise map of a project through the API (`/api/projects/<id>/noise-result`).
 * Side effects: network requests.
 */
export function noiseResultApi(projectId: string, csrf: string): NoiseResultApi {
  const url = `/api/projects/${encodeURIComponent(projectId)}/noise-result`;
  return {
    async load() {
      const res = await fetch(url, { credentials: "same-origin" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Loading the saved noise map failed (${res.status})`);
      const result = noiseFromJson(await gunzip(await res.arrayBuffer()));
      return result ? { result, computedAt: res.headers.get("X-Computed-At") } : null;
    },
    async save(result) {
      const res = await fetch(url, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/octet-stream", "X-CSRF-Token": csrf },
        body: await gzip(noiseToJson(result)),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(json.message ?? `Saving the noise map failed (${res.status})`);
      }
      return ((await res.json()) as { computedAt?: string }).computedAt ?? null;
    },
  };
}
