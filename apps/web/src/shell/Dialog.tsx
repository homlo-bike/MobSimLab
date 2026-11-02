import { type ReactNode, useEffect, useId, useRef } from "react";
import { useI18n } from "../i18n/i18n";
import { CloseIcon } from "./icons";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog: centred card on wider screens, bottom sheet on phones. Escape and the scrim close it,
 * focus moves in on open, stays inside while open, and returns to where it was on close.
 */
export function Dialog({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = "max-w-xl",
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const { t } = useI18n();
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const el = box.current;
    const first =
      el?.querySelector<HTMLElement>("[data-autofocus]") ?? el?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
      } else if (e.key === "Tab" && el) {
        const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
        const [a, z] = [items[0], items[items.length - 1]];
        if (!a || !z) return;
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          z.focus();
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    el?.addEventListener("keydown", onKey);
    return () => {
      el?.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-start md:p-6 md:pt-[8vh]">
      <div className="absolute inset-0 bg-slate-900/45" onClick={onClose} aria-hidden="true" />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        className={`relative flex max-h-[92vh] w-full ${width} flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl md:rounded-2xl`}
      >
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-slate-300 md:hidden" aria-hidden="true" />
        <div className="flex items-start gap-3 px-5 pt-4 md:px-7 md:pt-6">
          <div className="min-w-0 flex-1">
            <h2 id={`${id}-t`} className="text-xl font-semibold tracking-tight">
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            className="icon-btn -mt-1 -mr-2"
            aria-label={t("common.close")}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-5 md:px-7">{children}</div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-3 md:px-7">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
