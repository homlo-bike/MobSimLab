import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/i18n";
import type { MessageKey } from "../i18n/messages";
import type { Tab } from "./route";

/** One stop of the tour: the part of the page it points at (`data-tour`), its text, and the tab it needs. */
export interface TourStep {
  target: string;
  title: MessageKey;
  body: MessageKey;
  tab?: Tab;
}

/** The project tour: the tabs, drawing, the map's own buttons, the other tabs, the checks and help. */
export const PROJECT_TOUR: readonly TourStep[] = [
  { target: "tabs", title: "tour.tabs.title", body: "tour.tabs.body" },
  { target: "panel", title: "tour.create.title", body: "tour.create.body", tab: "create" },
  { target: "map-search", title: "tour.search.title", body: "tour.search.body", tab: "create" },
  { target: "map-layers", title: "tour.layers.title", body: "tour.layers.body", tab: "create" },
  { target: "tab-simulator", title: "tour.simulator.title", body: "tour.simulator.body" },
  { target: "tab-gis", title: "tour.gis.title", body: "tour.gis.body" },
  { target: "tab-tables", title: "tour.tables.title", body: "tour.tables.body" },
  { target: "save", title: "tour.save.title", body: "tour.save.body" },
  { target: "checks", title: "tour.checks.title", body: "tour.checks.body" },
  { target: "help", title: "tour.help.title", body: "tour.help.body" },
];

/** Purpose: the first element on screen marked `data-tour=name` (the top tabs or the phone's bottom tabs). */
function visibleTarget(name: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

const PAD = 6;
const CARD_W = 320;

/**
 * Purpose: a guided tour over the page: each step darkens the page round one part and explains it in a
 * card beside it, with Back, Next and Close. Steps whose part is not on screen (a view-only project has no
 * save status) are passed over. Escape closes; the arrow keys step.
 * Side effects: switches to the tab a step needs through `onTab`.
 */
export function Tour({
  steps,
  onTab,
  onClose,
}: {
  steps: readonly TourStep[];
  onTab: (t: Tab) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [i, setI] = useState(0);
  const [box, setBox] = useState<DOMRect | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const dir = useRef(1);
  const step = steps[i]!;

  useEffect(() => {
    if (step.tab) onTab(step.tab);
    // Only when the step changes.
  }, [i]);

  // Find the step's part once the tab has drawn, or pass over the step when it is not there.
  const measure = useCallback(() => {
    const el = visibleTarget(step.target);
    setBox(el ? el.getBoundingClientRect() : null);
    return el;
  }, [step.target]);
  useLayoutEffect(() => {
    let tries = 0;
    let frame = 0;
    const look = () => {
      if (measure()) return;
      if (++tries < 10) frame = requestAnimationFrame(look);
      else {
        const next = i + dir.current;
        if (next >= 0 && next < steps.length) setI(next);
        else onClose();
      }
    };
    look();
    return () => cancelAnimationFrame(frame);
  }, [i, measure, steps.length, onClose]);
  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  const go = (d: number) => {
    const next = i + d;
    if (next < 0) return;
    if (next >= steps.length) return onClose();
    dir.current = d;
    setI(next);
  };

  useEffect(() => {
    card.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  // The card goes below the part, else above it, kept inside the window.
  const vw = typeof window === "undefined" ? 1024 : window.innerWidth;
  const vh = typeof window === "undefined" ? 768 : window.innerHeight;
  const w = Math.min(CARD_W, vw - 24);
  let left = 12;
  let top = vh / 2 - 90;
  if (box) {
    left = Math.max(12, Math.min(box.left + box.width / 2 - w / 2, vw - w - 12));
    const below = box.bottom + PAD + 10;
    top = below + 190 < vh ? below : Math.max(12, box.top - PAD - 10 - 190);
  }

  return (
    <div className="fixed inset-0 z-[60]" role="presentation">
      {box ? (
        <div
          className="tour-spot pointer-events-none fixed rounded-xl"
          style={{
            left: box.left - PAD,
            top: box.top - PAD,
            width: box.width + 2 * PAD,
            height: box.height + 2 * PAD,
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-slate-900/55" />
      )}
      <div
        ref={card}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t(step.title)}
        className="fixed flex flex-col gap-2 rounded-2xl bg-white p-4 shadow-2xl outline-none"
        style={{ left, top, width: w }}
      >
        <p className="text-xs text-slate-500">{t("tour.stepOf", { step: i + 1, steps: steps.length })}</p>
        <h2 className="text-base font-semibold">{t(step.title)}</h2>
        <p className="text-sm text-slate-700">{t(step.body)}</p>
        <div className="mt-1 flex items-center gap-2">
          <button type="button" className="btn-ghost btn min-h-10 px-2" onClick={onClose}>
            {t("tour.close")}
          </button>
          <span className="flex-1" />
          {i > 0 && (
            <button type="button" className="btn min-h-10" onClick={() => go(-1)}>
              {t("tour.back")}
            </button>
          )}
          <button type="button" className="btn btn-pri min-h-10" onClick={() => go(1)}>
            {i === steps.length - 1 ? t("tour.done") : t("tour.next")}
          </button>
        </div>
      </div>
    </div>
  );
}
