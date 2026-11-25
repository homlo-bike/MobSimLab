/**
 * Answers of the long calculations the browser makes from a project (the railway built and its timetables
 * planned, the schematic laid out), kept by the fingerprint of everything they were worked out from, and saved
 * with the project (saved result `kept-answers`). A page opened again, or opened by another member, reads them
 * back instead of working them out again: Tables, Timetables and Schematic took a minute or more on the Damascus
 * network on every visit (bug 14). A calculation whose inputs changed has another fingerprint and is worked out
 * again (then kept and saved for the next time).
 */
import { useEffect, useState } from "react";
import type { ResultsApi } from "./results";

/** Most characters of answers kept in memory (about 128 MB in the browser's UTF-16 strings). */
const MAX_CHARS = 64_000_000;
/** Most characters of answers saved with the project (most recently used first; gzip makes it far smaller). */
const SAVE_MAX_CHARS = 40_000_000;
/** Wait after the last new answer before saving, so a run of answers is saved once. */
const SAVE_AFTER_MS = 5_000;
/** Format of the saved answers; another one is not read. */
const FORMAT = "answers-1";

/** Kept answers by fingerprint, least recently used first. */
const kept = new Map<string, string>();
let keptChars = 0;

/** A project whose answers are read and saved. */
interface OpenProject {
  id: string;
  api: ResultsApi;
  canSave: boolean;
  /** Fingerprints of this project's answers (read back or worked out while it is open). */
  keys: Set<string>;
  /** Resolves once its saved answers were read (or could not be); null until a calculation first asks. */
  ready: Promise<void> | null;
  /** Whether they were read. */
  done: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

/** The open project. */
let open: OpenProject | null = null;

/** Purpose: a kept answer, marked as just used; undefined when there is none. */
export function recallAnswer(key: string): string | undefined {
  const v = kept.get(key);
  if (v !== undefined) {
    kept.delete(key);
    kept.set(key, v);
    open?.keys.add(key);
  }
  return v;
}

function put(key: string, value: string) {
  const old = kept.get(key);
  if (old !== undefined) {
    kept.delete(key);
    keptChars -= old.length;
  }
  if (value.length > MAX_CHARS) return;
  kept.set(key, value);
  keptChars += value.length;
  for (const [k, v] of kept) {
    if (keptChars <= MAX_CHARS) break;
    kept.delete(k);
    keptChars -= v.length;
  }
}

/**
 * Purpose: keep a newly worked out answer; with an open project the planner may change, it is saved with the
 * project a few seconds after the last new answer. Side effects: may save the project's answers.
 */
export function rememberAnswer(key: string, value: string) {
  put(key, value);
  if (!open) return;
  open.keys.add(key);
  if (!open.canSave) return;
  const p = open;
  if (p.timer) clearTimeout(p.timer);
  p.timer = setTimeout(() => {
    p.timer = null;
    if (open === p) void saveAnswers(p);
  }, SAVE_AFTER_MS);
}

/** Purpose: save the open project's kept answers, most recently used first, up to `SAVE_MAX_CHARS`. */
async function saveAnswers(p: OpenProject) {
  const out: [string, string][] = [];
  let chars = 0;
  for (const [k, v] of [...kept].reverse()) {
    if (!p.keys.has(k)) continue;
    if (chars + v.length > SAVE_MAX_CHARS) continue;
    out.push([k, v]);
    chars += v.length;
  }
  // Oldest first, so reading them back keeps the order of use.
  out.reverse();
  try {
    await p.api.save("kept-answers", out, FORMAT);
  } catch {
    // Not saved (offline, no right to change the project): worked out again next time.
  }
}

/**
 * Purpose: read and save the answers of the open project (null: none open). The same project again changes
 * nothing. Side effects: reads the project's saved answers.
 */
export function keepAnswersFor(id: string | null, api: ResultsApi | null, canSave: boolean) {
  if (open && open.id === id && open.api === api) {
    open.canSave = canSave;
    return;
  }
  if (open?.timer) {
    clearTimeout(open.timer);
    if (open.canSave) void saveAnswers(open);
  }
  open = null;
  if (!id || !api) return;
  const p: OpenProject = {
    id,
    api,
    canSave,
    keys: new Set(),
    ready: null,
    done: false,
    timer: null,
  };
  open = p;
}

/** Purpose: stop reading and saving the answers of a project that closed (saving the last ones first). */
export function closeAnswers(id: string) {
  if (open?.id === id) keepAnswersFor(null, null, false);
}

/**
 * Purpose: wait until the open project's saved answers were read, so a calculation can use them. The first call
 * reads them. Side effects: reads the project's saved answers once.
 */
export function answersReady(): Promise<void> {
  const p = open;
  if (!p) return Promise.resolve();
  p.ready ??= p.api
    .load<[string, string][]>("kept-answers")
    .then(
      (r) => {
        if (!r || r.inputs !== FORMAT || !Array.isArray(r.value)) return;
        for (const e of r.value) {
          if (!Array.isArray(e) || typeof e[0] !== "string" || typeof e[1] !== "string") continue;
          if (!kept.has(e[0])) put(e[0], e[1]);
          p.keys.add(e[0]);
        }
      },
      () => undefined,
    )
    .then(() => {
      p.done = true;
    });
  return p.ready;
}

/** Purpose: whether the open project's saved answers were read (they are read when first asked for). */
export function useAnswersReady(): boolean {
  const [ready, setReady] = useState(() => !open || open.done);
  useEffect(() => {
    if (ready) return;
    let live = true;
    void answersReady().then(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, []);
  return ready;
}

/** Purpose: forget every kept answer and the open project (tests). */
export function forgetAnswers() {
  if (open?.timer) clearTimeout(open.timer);
  open = null;
  kept.clear();
  keptChars = 0;
}

/**
 * Purpose: a fingerprint part that changes with the code that works an answer out: the module's own address,
 * which a production build names by its content. A development page keeps answers for itself only.
 * Inputs: `import.meta.url` of the module (or the address of its WebAssembly file).
 */
export function codeVersion(url: string): string {
  return import.meta.env.DEV ? `${url}#${PAGE}` : url;
}
const PAGE = `${Date.now()}-${Math.random()}`;
