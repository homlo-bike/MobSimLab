import { hashText } from "../../projects/inputKey";

/**
 * The calls of the rail-design WebAssembly engine (`RailDesigner`) whose answers are kept, and those that
 * change what it builds. Answers are JSON text.
 */
export interface Designer {
  build(doc: string, draft: number): string;
  publish_lines(lines: string, serviceId: string): string;
  publish_lines_with(lines: string, serviceId: string, options: string): string;
  missing_terrain_tiles(): string;
  topology(): string;
}

/** Most characters of answers kept (about 128 MB in the browser's UTF-16 strings). */
const MAX_CHARS = 64_000_000;

/** Kept answers by the fingerprint of everything that led to them, least recently used first. */
const kept = new Map<string, string>();
let keptChars = 0;

function recall(key: string): string | undefined {
  const v = kept.get(key);
  if (v !== undefined) {
    kept.delete(key);
    kept.set(key, v);
  }
  return v;
}

function remember(key: string, value: string) {
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

/** Purpose: what a publication's kept answer is found by, besides the build it was planned on. */
function publishToken(lines: string, serviceId: string, options?: string) {
  return `publish\u0000${serviceId}\u0000${options ?? ""}\u0000${lines}`;
}

/** Purpose: forget every kept answer (tests). */
export function forgetDesignerAnswers() {
  kept.clear();
  keptChars = 0;
}

/**
 * Purpose: one engine's calls, answering a build, a publication or the missing terrain tiles from the answers
 * kept for the page when the engine got exactly the same inputs before. A build depends on the document and
 * on what the engine was given (tiles, settings) in order; a publication and the missing tiles depend on the
 * last build only (the engine's `publish_lines` and `missing_terrain_tiles` do not change it). Building and
 * publishing a large railway take seconds each, and the Schematic, the Tables and their parts each build and
 * publish the same railway (the Damascus network took 30–60 s to become usable).
 * A build answered from memory is not run until the engine is asked something it has no kept answer for:
 * then the skipped calls are run in their order first, so the engine is in the state it would have been in.
 * Side effects: keeps answers in memory for the page (at most `MAX_CHARS` characters, least recently used out).
 */
export class CachedDesigner<D extends Designer> {
  /** Fingerprint of the calls so far that change what a build gives (tiles, settings). */
  private inputs = "";
  /** Fingerprint of the last build ("" before the first). */
  private built = "";
  /** Calls skipped (builds answered from memory, and changes after them), in order. */
  private behind: (() => void)[] = [];

  constructor(readonly engine: D) {}

  /** Purpose: run the skipped calls, so the engine is where its callers think it is. */
  catchUp(): D {
    const calls = this.behind;
    this.behind = [];
    for (const c of calls) c();
    return this.engine;
  }

  /** Purpose: a call that changes what the engine builds (tiles, settings): run in order, remembered. */
  change(token: string, run: (d: D) => void) {
    this.inputs = hashText(`${this.inputs}\u0000${token}`);
    if (this.behind.length) this.behind.push(() => run(this.engine));
    else run(this.engine);
  }

  build(doc: string, draft: number): string {
    const key = hashText(`${this.inputs}\u0000build\u0000${draft}\u0000${doc}`);
    const v = recall(key);
    if (v !== undefined) {
      this.behind.push(() => this.engine.build(doc, draft));
      this.built = key;
      return v;
    }
    const out = this.catchUp().build(doc, draft);
    this.built = key;
    remember(key, out);
    return out;
  }

  /** Purpose: an answer that depends on the last build only. */
  private fromBuild(token: string, run: (d: D) => string): string {
    const key = hashText(`${this.built}\u0000${token}`);
    const v = this.built ? recall(key) : undefined;
    if (v !== undefined) return v;
    const out = run(this.catchUp());
    if (this.built) remember(key, out);
    return out;
  }

  publishLines(lines: string, serviceId: string, options?: string): string {
    return this.fromBuild(publishToken(lines, serviceId, options), (d) =>
      options === undefined
        ? d.publish_lines(lines, serviceId)
        : d.publish_lines_with(lines, serviceId, options),
    );
  }

  /**
   * Purpose: `publishLines` planned elsewhere (a Web Worker) on the last build's topology, so the page stays
   * responsive while it plans. The answer is kept as one from the engine is, for the same build and inputs.
   * Inputs: the lines, day type and options as for `publishLines`, and the planner, given the topology.
   */
  async publishLinesAway(
    lines: string,
    serviceId: string,
    options: string | undefined,
    plan: (topology: string) => Promise<string>,
  ): Promise<string> {
    const built = this.built;
    const key = hashText(`${built}\u0000${publishToken(lines, serviceId, options)}`);
    const v = built ? recall(key) : undefined;
    if (v !== undefined) return v;
    const out = await plan(this.catchUp().topology());
    if (built) remember(key, out);
    return out;
  }

  missingTerrainTiles(): string {
    return this.fromBuild("missing-terrain", (d) => d.missing_terrain_tiles());
  }
}
