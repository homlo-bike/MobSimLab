import { useState } from "react";
import { useI18n } from "../i18n/i18n";
import { HelpIcon, PlayIcon } from "./icons";
import { anchorOf, Popover } from "./Popover";

/** The Help (?) button in a project's top bar and its menu: the guided tour. */
export function HelpMenu({ onTour }: { onTour: () => void }) {
  const { t } = useI18n();
  const [at, setAt] = useState<ReturnType<typeof anchorOf> | null>(null);
  return (
    <>
      <button
        type="button"
        className="icon-btn"
        aria-label={t("help.menu")}
        title={t("help.menu")}
        aria-haspopup="menu"
        aria-expanded={Boolean(at)}
        data-tour="help"
        onClick={(e) => setAt(at ? null : anchorOf(e.currentTarget))}
      >
        <HelpIcon />
      </button>
      {at && (
        <Popover at={at} align="right" label={t("help.menu")} onClose={() => setAt(null)}>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setAt(null);
              onTour();
            }}
          >
            <PlayIcon />
            <span>
              {t("help.tour")}
              <span className="block text-xs font-normal text-slate-500">{t("help.tourHint")}</span>
            </span>
          </button>
        </Popover>
      )}
    </>
  );
}
