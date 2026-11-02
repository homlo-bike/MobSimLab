import type { ReactNode } from "react";
import { useI18n } from "../i18n/i18n";
import { InfoIcon } from "./icons";

/**
 * The top bar on every signed-in page: the instance name (back to the projects home), whatever the page puts in
 * the middle (project name and tabs), the About (!) button and the account menu.
 */
export function TopBar({
  brand,
  onHome,
  onAbout,
  account,
  children,
}: {
  brand: string;
  onHome: () => void;
  onAbout: () => void;
  account: ReactNode;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <header className="flex h-14 shrink-0 items-center gap-1 border-b border-slate-200 bg-white px-2 md:gap-2 md:px-3">
      <a
        href="/"
        className={`${children ? "hidden md:block" : ""} mr-1 shrink-0 truncate rounded-lg px-2 py-2 text-[15px] font-bold text-slate-900 no-underline hover:bg-slate-100 md:mr-2`}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          onHome();
        }}
      >
        {brand}
      </a>
      {children}
      <span className="flex-1" />
      <button
        type="button"
        className="icon-btn"
        aria-label={t("about.title")}
        aria-haspopup="dialog"
        onClick={onAbout}
      >
        <InfoIcon />
      </button>
      {account}
    </header>
  );
}
