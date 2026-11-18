import { createContext, type ReactNode, useContext } from "react";

/**
 * The section of the Tables tab on show (for example "costs.prices"), or null outside the Tables tab, where every
 * part shows. The Tables tab lists each group's sections in its side panel and shows one at a time.
 */
export const TablesSection = createContext<string | null>(null);

/**
 * Purpose: a part of a table group that shows only while one of its sections is chosen in the Tables tab's side
 * panel. It stays drawn while hidden, so what the group works out is kept (the appraisal reads the other groups).
 * Inputs: the section id or ids the part belongs to, and its content. Output: the content, hidden when another
 * section of the Tables tab is chosen; always shown outside the Tables tab.
 */
export function TablePart({ id, children }: { id: string | readonly string[]; children: ReactNode }) {
  const current = useContext(TablesSection);
  const ids: readonly string[] = typeof id === "string" ? [id] : id;
  return <div hidden={current !== null && !ids.includes(current)}>{children}</div>;
}
