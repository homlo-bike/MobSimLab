/**
 * Notes and problems of a road run in the app language. The worker (worker/src/mobsim_worker/jobs/road/
 * messages.py) sends each one as its English text and a message: a key of the road simulation's messages
 * (i18n/road) with its values, which are text, numbers, or messages of their own for parts of the sentence.
 * Runs saved before messages have plain English text, shown as it is.
 */
import { formatInt, hasMessage, type Translate } from "../../i18n/i18n";

/** A message of the worker: a key of the road messages and the values for its placeholders. */
export interface RoadMsg {
  key: string;
  args?: Record<string, string | number | RoadMsg>;
}

/** A note of a road run: English text alone (runs saved before messages), or text with its message. */
export type RoadNote = string | { text: string; msg?: RoadMsg | null };

/** Purpose: a worker message in the app language. Output: null when a key, or a part's key, is unknown. */
export function roadMsgText(t: Translate, m: RoadMsg): string | null {
  if (!hasMessage(m.key)) return null;
  const vars: Record<string, string> = {};
  for (const [name, v] of Object.entries(m.args ?? {})) {
    if (typeof v === "number") vars[name] = Number.isInteger(v) ? formatInt(v) : String(v);
    else if (typeof v === "string") vars[name] = v;
    else {
      const part = roadMsgText(t, v);
      if (part === null) return null;
      vars[name] = part;
    }
  }
  return t(m.key, vars);
}

/** Purpose: a road run's note in the app language, else its English text. */
export function roadNoteText(t: Translate, note: RoadNote): string {
  if (typeof note === "string") return note;
  return (note.msg ? roadMsgText(t, note.msg) : null) ?? note.text;
}

/** Purpose: why a line cannot run, in the app language, else in English. */
export function roadProblemText(
  t: Translate,
  line: { problem: string | null; problem_msg?: RoadMsg | null },
): string {
  const shown = line.problem_msg ? roadMsgText(t, line.problem_msg) : null;
  return shown ?? line.problem ?? "";
}
