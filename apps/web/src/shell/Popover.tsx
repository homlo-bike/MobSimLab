import { type ReactNode, useEffect, useRef } from "react";

/**
 * A menu that floats next to its button, or at a point (right-click). Closes on Escape, outside click and
 * scroll; arrow keys move between items. Positioned `fixed` and kept inside the viewport.
 */
export function Popover({
  at,
  onClose,
  label,
  children,
  align = "left",
}: {
  /** Anchor: a button's bounding box, or a pointer position. */
  at: { x: number; y: number; w?: number; h?: number };
  onClose: () => void;
  label: string;
  children: ReactNode;
  align?: "left" | "right";
}) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const before = document.activeElement as HTMLElement | null;
    // Keep inside the viewport.
    const r = el.getBoundingClientRect();
    const top = at.y + (at.h ?? 0) + 4;
    let left = align === "right" ? at.x + (at.w ?? 0) - r.width : at.x;
    left = Math.max(8, Math.min(left, window.innerWidth - r.width - 8));
    el.style.left = `${left}px`;
    el.style.top = `${top + r.height > window.innerHeight - 8 ? Math.max(8, at.y - r.height - 4) : top}px`;
    el.style.visibility = "visible";
    const items = () => [...el.querySelectorAll<HTMLElement>('[role="menuitem"],[role="menuitemradio"]')];
    items()[0]?.focus();

    const onDown = (e: PointerEvent) => {
      if (!el.contains(e.target as Node)) close.current();
    };
    const onKey = (e: KeyboardEvent) => {
      const list = items();
      const i = list.indexOf(document.activeElement as HTMLElement);
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
        before?.focus?.();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        list[(i + 1) % list.length]?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        list[(i - 1 + list.length) % list.length]?.focus();
      } else if (e.key === "Tab") {
        close.current();
      }
    };
    const onScroll = () => close.current();
    document.addEventListener("pointerdown", onDown, true);
    el.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      el.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScroll);
    };
  }, [at.x, at.y, at.w, at.h, align]);

  return (
    <div
      ref={box}
      role="menu"
      aria-label={label}
      className="menu fixed"
      style={{ visibility: "hidden", left: 0, top: 0 }}
    >
      {children}
    </div>
  );
}

/** Purpose: the anchor box of an element, for `Popover`. */
export function anchorOf(el: Element): { x: number; y: number; w: number; h: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}
