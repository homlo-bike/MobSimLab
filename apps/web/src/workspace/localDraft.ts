import type { DrawingKind } from "../projects/drawings";

/** An unsaved drawing kept on this device, with the server version it was based on. */
export interface LocalDraft {
  kind: DrawingKind;
  doc: unknown;
  /** The version the change started from; null for a drawing the server does not have yet. */
  baseVersion: number | null;
  /** When it was written, ms since the epoch. */
  at: number;
}

/** Where unsaved drawings wait on this device until the server has them. */
export interface DraftStore {
  /** Every draft of a project. */
  list(projectId: string): Promise<LocalDraft[]>;
  put(projectId: string, draft: LocalDraft): Promise<void>;
  remove(projectId: string, kind: DrawingKind): Promise<void>;
}

const DB = "mobsimlab-drafts";
const STORE = "drafts";
/** Drafts older than this are dropped rather than restored, ms (30 days). */
export const DRAFT_MAX_AGE_MS = 30 * 24 * 3600 * 1000;

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((ok, fail) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error ?? new Error("IndexedDB request failed"));
  });

/**
 * Purpose: drafts in the browser's IndexedDB (one record per project and drawing kind), or null when the browser
 * has none (private windows in some browsers, tests). Errors are swallowed by the caller: a draft is a safety net.
 */
export function indexedDbDrafts(): DraftStore | null {
  const idb = typeof indexedDB === "undefined" ? null : indexedDB;
  if (!idb) return null;
  let db: Promise<IDBDatabase> | null = null;
  const open = () =>
    (db ??= new Promise<IDBDatabase>((ok, fail) => {
      const r = idb.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fail(r.error ?? new Error("IndexedDB did not open"));
    }));
  const store = async (mode: IDBTransactionMode) =>
    (await open()).transaction(STORE, mode).objectStore(STORE);
  const key = (projectId: string, kind: string) => `${projectId}/${kind}`;
  return {
    async list(projectId) {
      const s = await store("readonly");
      const range = IDBKeyRange.bound(`${projectId}/`, `${projectId}/￿`);
      return (await req(s.getAll(range))) as LocalDraft[];
    },
    async put(projectId, draft) {
      await req((await store("readwrite")).put(draft, key(projectId, draft.kind)));
    },
    async remove(projectId, kind) {
      await req((await store("readwrite")).delete(key(projectId, kind)));
    },
  };
}

/** Purpose: drafts in memory, for tests. */
export function memoryDrafts(): DraftStore & { all: Map<string, LocalDraft> } {
  const all = new Map<string, LocalDraft>();
  return {
    all,
    list: async (p) => [...all.entries()].filter(([k]) => k.startsWith(`${p}/`)).map(([, d]) => d),
    put: async (p, d) => void all.set(`${p}/${d.kind}`, d),
    remove: async (p, k) => void all.delete(`${p}/${k}`),
  };
}
