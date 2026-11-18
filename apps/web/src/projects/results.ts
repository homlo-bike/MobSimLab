/**
 * Results the project's tools worked out, saved with the project (`/api/projects/<id>/results/<kind>`,
 * apps/api/src/projects/results.ts): one of each kind, with the fingerprint of what it was worked out from, so a
 * tool shows it again on opening without working it out once more, and says when it is out of date.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { csrfHeader } from "../session/csrf";
import type { ResultState } from "./SavedResultNotice";

/** Kinds of result a project keeps (apps/api/src/projects/results.ts `RESULT_KINDS`). */
export type ResultKind =
  | "noise"
  | "walk-coverage"
  | "stop-spacing"
  | "benefit-access"
  | "cost-quantities"
  | "scenario-measures"
  | "capacity-test";

/** Format of a saved result's JSON; a newer app reads older ones, a result in an unknown one is worked out again. */
const VERSION = 1;

/** A result read back from the project. */
export interface SavedResult<T> {
  value: T;
  /** Fingerprint of what it was worked out from (inputKey.ts). */
  inputs: string;
  /** When it was worked out (ISO time), when known. */
  computedAt: string | null;
}

/** Reading and replacing the project's saved results. */
export interface ResultsApi {
  /** The saved result of a kind, or null when the project has none (or one this app cannot read). */
  load<T>(kind: ResultKind): Promise<SavedResult<T> | null>;
  /** Keep a newly worked out result, replacing the one before; resolves to when it was saved. */
  save(kind: ResultKind, value: unknown, inputs: string): Promise<string | null>;
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

/** Purpose: a result as JSON text, with typed arrays (pictures, grids) as tagged base64. */
export function resultToJson(value: unknown): string {
  return JSON.stringify({ version: VERSION, value }, (_k, v: unknown) => {
    if (v instanceof Float32Array)
      return { $f32: toBase64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    if (v instanceof Float64Array)
      return { $f64: toBase64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    if (v instanceof Uint8Array || v instanceof Uint8ClampedArray)
      return {
        [v instanceof Uint8ClampedArray ? "$u8c" : "$u8"]: toBase64(
          new Uint8Array(v.buffer, v.byteOffset, v.byteLength),
        ),
      };
    if (v instanceof Map) return { $map: [...v.entries()] };
    return v;
  });
}

/** Purpose: the result from `resultToJson` text; undefined for another format. */
export function resultFromJson<T>(text: string): T | undefined {
  const doc = JSON.parse(text, (_k, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      if (typeof o.$u8 === "string") return fromBase64(o.$u8);
      if (typeof o.$u8c === "string") {
        const b = fromBase64(o.$u8c);
        return new Uint8ClampedArray(b.buffer, b.byteOffset, b.byteLength);
      }
      if (typeof o.$f32 === "string") {
        const b = fromBase64(o.$f32);
        return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
      }
      if (typeof o.$f64 === "string") {
        const b = fromBase64(o.$f64);
        return new Float64Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
      }
      if (Array.isArray(o.$map)) return new Map(o.$map as [unknown, unknown][]);
    }
    return v;
  }) as { version?: unknown; value?: T };
  return doc.version === VERSION ? doc.value : undefined;
}

async function gzip(text: string): Promise<Blob> {
  const stream = new Response(text).body!.pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).blob();
}

/** Purpose: the text of a saved body: gzip as the API keeps it, or plain JSON as the static viewer serves it. */
async function bodyText(bytes: ArrayBuffer): Promise<string> {
  const head = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  if (head[0] !== 0x1f || head[1] !== 0x8b) return new TextDecoder().decode(bytes);
  const stream = new Response(bytes).body!.pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

/**
 * Purpose: the saved results of a project through the API.
 * Side effects: network requests.
 */
export function projectResults(
  projectId: string,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): ResultsApi {
  const url = (kind: ResultKind) =>
    `/api/projects/${encodeURIComponent(projectId)}/results/${encodeURIComponent(kind)}`;
  return {
    async load<T>(kind: ResultKind) {
      const res = await fetchImpl(url(kind), { credentials: "same-origin" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Loading the saved result failed (${res.status})`);
      const value = resultFromJson<T>(await bodyText(await res.arrayBuffer()));
      if (value === undefined) return null;
      return {
        value,
        inputs: res.headers.get("X-Inputs") ?? "",
        computedAt: res.headers.get("X-Computed-At"),
      };
    },
    async save(kind, value, inputs) {
      const res = await fetchImpl(`${url(kind)}?inputs=${encodeURIComponent(inputs)}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/octet-stream", ...csrfHeader() },
        body: await gzip(resultToJson(value)),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(json.message ?? `Saving the result failed (${res.status})`);
      }
      return ((await res.json()) as { computedAt?: string }).computedAt ?? null;
    },
  };
}

/** What `useSavedResult` gives a tool. */
export interface SavedResultHandle<T> {
  /** The result saved with the project, once loaded; null when there is none. */
  saved: SavedResult<T> | null;
  /** Whether the saved result has been looked up (or there is nowhere to look). */
  loaded: boolean;
  /** Whether the saved result matches `inputs` now; null without a saved result. */
  state: ResultState | null;
  /** Keep a newly worked out result for `inputs` (only when the planner may change the project). */
  save(value: T, inputs: string): void;
  /** Why the last save failed. */
  error: string | null;
}

/**
 * Purpose: a tool's saved result of one kind: loaded once, compared with the fingerprint of its inputs now, and
 * replaced by the tool's newly worked out results.
 * Inputs: the project's results (null: none to read, as in tests), the kind, the inputs' fingerprint now, and
 * whether the planner may save.
 */
export function useSavedResult<T>(
  api: ResultsApi | null | undefined,
  kind: ResultKind,
  inputs: string | null,
  canSave: boolean,
): SavedResultHandle<T> {
  const [saved, setSaved] = useState<SavedResult<T> | null>(null);
  const [loaded, setLoaded] = useState(!api);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!api) {
      setLoaded(true);
      return;
    }
    let live = true;
    setLoaded(false);
    api.load<T>(kind).then(
      (r) => {
        if (!live) return;
        setSaved(r);
        setLoaded(true);
      },
      () => live && setLoaded(true),
    );
    return () => {
      live = false;
    };
  }, [api, kind]);
  const save = useCallback(
    (value: T, keyNow: string) => {
      if (!api || !canSave) return;
      setSaved({ value, inputs: keyNow, computedAt: new Date().toISOString() });
      setError(null);
      api.save(kind, value, keyNow).then(
        (at) => at && setSaved((s) => (s && s.inputs === keyNow ? { ...s, computedAt: at } : s)),
        (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
      );
    },
    [api, kind, canSave],
  );
  const state: ResultState | null = saved
    ? inputs !== null && saved.inputs === inputs
      ? "current"
      : "stale"
    : null;
  return { saved, loaded, state, save, error };
}

/**
 * Purpose: a result that follows its inputs by itself (a fast calculation): the saved one while it matches the
 * inputs' fingerprint, else worked out with `compute` and saved. Output: the result (null until there is one)
 * and why working it out failed.
 * Inputs: the project's results, the kind, the inputs' fingerprint now (null: nothing to work out), whether the
 * planner may save, and the calculation for those inputs (read when the fingerprint changes).
 */
export function useLiveResult<T>(
  api: ResultsApi | null | undefined,
  kind: ResultKind,
  inputs: string | null,
  canSave: boolean,
  compute: () => Promise<T>,
): { value: T | null; error: string | null } {
  const kept = useSavedResult<T>(api, kind, inputs, canSave);
  const [value, setValue] = useState<{ inputs: string; value: T } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const work = useRef(compute);
  work.current = compute;
  const save = kept.save;
  const saved = kept.saved;
  useEffect(() => {
    if (inputs === null || !kept.loaded) return;
    if (saved && saved.inputs === inputs) {
      setValue({ inputs, value: saved.value });
      return;
    }
    let live = true;
    setError(null);
    work.current().then(
      (v) => {
        if (!live) return;
        setValue({ inputs, value: v });
        save(v, inputs);
      },
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
    // The saved result is read when the inputs change or once it has loaded, not when this saves a new one.
  }, [inputs, kept.loaded]);
  return { value: inputs === null ? null : (value?.value ?? null), error };
}
