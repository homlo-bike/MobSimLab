/**
 * Selecting several things on the map: a click selects only that thing; with Shift (or Ctrl/Cmd) held, a click
 * adds it to the selection or takes it out again.
 */

/** Purpose: whether a click adds to the selection (Shift, Ctrl or Cmd held). */
export function addsToSelection(
  ev: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } | undefined,
): boolean {
  return !!(ev?.shiftKey || ev?.ctrlKey || ev?.metaKey);
}

/**
 * Purpose: the selection after a tap on `item`: only it, or (`additive`) the selection with it added, or
 * taken out when it was already in.
 */
export function toggleSelection<T>(
  list: readonly T[],
  item: T,
  keyOf: (x: T) => string | number,
  additive: boolean,
): T[] {
  const k = keyOf(item);
  if (!additive) return [item];
  return list.some((x) => keyOf(x) === k) ? list.filter((x) => keyOf(x) !== k) : [...list, item];
}
