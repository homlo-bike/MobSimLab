/**
 * The drawing the tabs' long calculations were last worked out from. The tabs that show results of a drawing
 * (Tables, Costs, Timetables and Schematic for the railway) calculate from this copy, not from the drawing as it
 * is now: after a change they open at once with the last results, marked out of date, and work them out again
 * only when the planner asks (Recalculate). The copy is kept with the project's kept answers
 * (projects/keptAnswers.ts), so it is saved with the project and travels in its `.mslab` file next to the answers
 * worked out from it.
 */
import { useCallback, useEffect, useState } from "react";
import { answersReady, recallAnswer, rememberAnswer } from "./keptAnswers";

/** What the tabs calculate from, and whether the drawing has changed since. */
export interface CalculatedDoc<T> {
  /** The drawing the results are worked out from: the drawing as it is, or as it was at the last calculation. */
  doc: T | null;
  /** The drawing has changed since the results were worked out. */
  stale: boolean;
  /** False until the project's saved answers were read: nothing should be calculated before. */
  ready: boolean;
  /** Works the results out from the drawing as it is now. */
  recalculate: () => void;
}

/** Purpose: what a project's last calculated drawing is kept by, among its kept answers. */
export function calculatedKey(projectId: string, name: string): string {
  return `calculated\u0000${projectId}\u0000${name}`;
}

/**
 * Purpose: the drawing the tabs calculate from. The first time (nothing kept, or nothing drawn when it was kept)
 * it is the drawing as it is; from then on it stays as it was at the last calculation until `recalculate`.
 * Inputs: the project id; a name for the drawing; the drawing as it is now (null: none); whether the drawings were
 * loaded; whether a drawing holds nothing to calculate from; and whether a tab that calculates from it shows (the
 * project's saved answers are read only then).
 * Output: see `CalculatedDoc`. Side effects: keeps the calculated drawing with the project's kept answers.
 */
export function useCalculatedDoc<T>(
  projectId: string,
  name: string,
  live: T | null,
  loaded: boolean,
  isEmpty: (doc: T | null) => boolean,
  wanted = true,
): CalculatedDoc<T> {
  const key = calculatedKey(projectId, name);
  // The project whose saved answers were read (they are read when a tab that calculates first shows).
  const [read, setRead] = useState<string | null>(null);
  useEffect(() => {
    if (!wanted || read === projectId) return;
    let on = true;
    void answersReady().then(() => on && setRead(projectId));
    return () => {
      on = false;
    };
  }, [wanted, projectId, read]);
  const ready = read === projectId && loaded;
  const liveJson = JSON.stringify(live ?? null);
  // The JSON of the calculated drawing; undefined until read from the kept answers.
  const [kept, setKept] = useState<{ key: string; json: string } | undefined>(undefined);
  useEffect(() => {
    if (!ready || kept?.key === key) return;
    const saved = recallAnswer(key);
    setKept({ key, json: saved ?? liveJson });
    if (saved === undefined && !isEmpty(live)) rememberAnswer(key, liveJson);
    // Read once per project, when its drawings and answers are there.
  }, [ready, key]);
  const current = kept?.key === key ? kept.json : undefined;
  let keptDoc: T | null = null;
  if (current !== undefined && current !== liveJson) {
    try {
      keptDoc = JSON.parse(current) as T | null;
    } catch {
      keptDoc = null;
    }
  }
  // Nothing was calculated from an empty drawing: the first thing drawn is worked out without asking.
  const follow = current !== undefined && current !== liveJson && isEmpty(keptDoc);
  useEffect(() => {
    if (!follow) return;
    setKept({ key, json: liveJson });
    if (!isEmpty(live)) rememberAnswer(key, liveJson);
  }, [follow, key, liveJson]);
  const recalculate = useCallback(() => {
    setKept({ key, json: liveJson });
    rememberAnswer(key, liveJson);
  }, [key, liveJson]);
  if (current === undefined || current === liveJson || follow)
    return { doc: live, stale: false, ready: ready && current !== undefined, recalculate };
  return { doc: keptDoc, stale: true, ready: true, recalculate };
}
