import { type Dispatch, type MutableRefObject, type SetStateAction, useEffect } from "react";
import { deleteElement, kindOf, update, updateSignal } from "./doc";
import { type Cursor, draftLevel, type LatestRef, type Selection, sigs } from "./editorState";
import { shiftLevel } from "./modes";
import type { NewTrackOpts, RailTool } from "./railPanelTypes";
import type { Anchor, Network, Track } from "./types";

/**
 * Purpose: the editor's keyboard shortcuts: tools, levels and points while drawing, flipping a signal,
 * deleting the selection. Side effects: listens to key presses on the window while mounted.
 */
export function useEditorKeys({
  latest,
  setDoc,
  setSel,
  setDraft,
  setCursor,
  setTrackOpts,
  finishDraft,
  finishLine,
  anchorAt,
  toolChange,
}: {
  latest: LatestRef;
  setDoc: Dispatch<SetStateAction<Network | null>>;
  setSel: Dispatch<SetStateAction<Selection | null>>;
  setDraft: Dispatch<SetStateAction<Track | null>>;
  setCursor: Dispatch<SetStateAction<Cursor | null>>;
  setTrackOpts: Dispatch<SetStateAction<NewTrackOpts>>;
  finishDraft: (end: Anchor | null) => void;
  finishLine: () => void;
  anchorAt: (a: Anchor) => [number, number] | null;
  toolChange: MutableRefObject<(t: RailTool) => void>;
}) {
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const s = latest.current;
      const k = ev.key.toLowerCase();
      if (s.draft) {
        if (ev.key === "+" || ev.key === "=" || ev.key === "-" || ev.key === "_") {
          const up = ev.key === "+" || ev.key === "=";
          setDraft({
            ...s.draft,
            level: shiftLevel(draftLevel(s.draft), up ? 1 : -1),
            points: s.draft.points,
          });
          setTrackOpts((o) => ({ ...o, level: shiftLevel(draftLevel(s.draft!), up ? 1 : -1) }));
          ev.preventDefault();
          return;
        }
        if (ev.key === "Backspace" || ev.key === "Delete") {
          setDraft({ ...s.draft, points: s.draft.points.slice(0, -1) });
          ev.preventDefault();
          return;
        }
        if (ev.key === "Enter") return finishDraft(null);
        if (ev.key === "Escape") {
          setDraft(null);
          setCursor(null);
          return;
        }
      }
      if (s.tool === "line" && (ev.key === "Enter" || ev.key === "Escape")) return finishLine();
      if (ev.key === "Escape") return setSel(null);
      if (k === "f" && s.sel && s.doc && kindOf(s.doc, s.sel.id, sigs(s.view)) === "signal") {
        setDoc(
          updateSignal(s.doc, s.sel.id, (x) => ({ ...x, facing: x.facing === 1 ? -1 : 1 }), sigs(s.view)),
        );
        return;
      }
      // [ and ] turn the selected station by 5° (Shift: 15°).
      if ((ev.key === "[" || ev.key === "]" || ev.key === "{" || ev.key === "}") && s.sel && s.doc) {
        const st = s.doc.stations.find((x) => x.id === s.sel!.id);
        if (st) {
          const step = (ev.key === "]" || ev.key === "}" ? 1 : -1) * (ev.shiftKey ? 15 : 5);
          const deg = (((Math.round(st.rotation_deg) + step) % 360) + 360) % 360;
          setDoc(update(s.doc, "stations", st.id, (x) => ({ ...x, rotation_deg: deg })));
          ev.preventDefault();
          return;
        }
      }
      if ((ev.key === "Delete" || ev.key === "Backspace") && s.sel && s.doc) {
        ev.preventDefault();
        if (s.sel.pi !== undefined) {
          const { id, pi } = s.sel;
          setDoc(update(s.doc, "tracks", id, (t) => ({ ...t, points: t.points.filter((_, i) => i !== pi) })));
          setSel({ id });
        } else {
          setDoc(deleteElement(s.doc, s.sel.id, anchorAt, sigs(s.view)));
          setSel(null);
        }
        return;
      }
      const tools: Record<string, RailTool> = {
        v: "select",
        s: "station",
        t: "track",
        b: "turnout",
        x: "crossover",
        g: "signal",
        h: "pan",
        l: "line",
      };
      if (tools[k]) toolChange.current(tools[k]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finishDraft]);
}
