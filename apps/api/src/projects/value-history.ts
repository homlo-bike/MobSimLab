/**
 * Change history of project values (09 §1.5, ADR-0018): each value a save of the preferences drawing changes is
 * recorded in the project's audit chain with who, when, the old and new value and the optional reason.
 */

/** Audit action of a value the project set, changed or reset to the library's. */
export const VALUE_CHANGED = "project.value_changed";
/** Audit action of a reason given or changed for a value whose number stayed the same. */
export const VALUE_REASON = "project.value_reason";
/** Audit object type of both actions; the object id is the assumption id. */
export const VALUE_OBJECT = "assumption_value";

/** Longest reason accepted, in characters. */
export const MAX_REASON = 500;

/** One value as it was or is: the project's number (null: the library's applies) and its reason. */
export interface ValueState {
  value: number | null;
  reason: string | null;
}

/** One change a save makes to a value. */
export interface ValueChange {
  action: typeof VALUE_CHANGED | typeof VALUE_REASON;
  id: string;
  before: ValueState;
  after: ValueState;
}

const record = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * Purpose: the value changes between two preferences documents (`before` null when none was saved yet).
 * Output: one change per assumption id whose number changed (`project.value_changed`, with the new reason),
 * or whose number stayed but a new reason was given (`project.value_reason`), sorted by id.
 */
export function valueChanges(before: unknown, after: unknown): ValueChange[] {
  const bv = record(record(before).values);
  const av = record(record(after).values);
  const br = record(record(before).reasons);
  const ar = record(record(after).reasons);
  const ids = [...new Set([...Object.keys(bv), ...Object.keys(av), ...Object.keys(ar)])].sort();
  const out: ValueChange[] = [];
  for (const id of ids) {
    const b = { value: num(bv[id]), reason: text(br[id]) };
    const a = { value: num(av[id]), reason: text(ar[id]) };
    if (b.value !== a.value) out.push({ action: VALUE_CHANGED, id, before: b, after: a });
    else if (a.reason !== null && a.reason !== b.reason)
      out.push({ action: VALUE_REASON, id, before: b, after: a });
  }
  return out;
}
