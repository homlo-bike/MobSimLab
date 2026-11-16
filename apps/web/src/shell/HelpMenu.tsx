import { useState } from "react";
import { useI18n } from "../i18n/i18n";
import { BusIcon, HelpIcon, PlayIcon } from "./icons";
import { anchorOf, Popover } from "./Popover";

/**
 * The Help (?) button in a project's top bar and its menu: the guided tour and, for those who may create
 * projects, the example project (made as a new project of their own and opened).
 */
export function HelpMenu({ onTour, onExample }: { onTour: () => void; onExample?: () => Promise<void> }) {
  const { t } = useI18n();
  const [at, setAt] = useState<ReturnType<typeof anchorOf> | null>(null);
  const [example, setExample] = useState<
    { kind: "idle" } | { kind: "making" } | { kind: "failed"; text: string }
  >({ kind: "idle" });
  const openExample = () => {
    if (!onExample || example.kind === "making") return;
    setExample({ kind: "making" });
    onExample().then(
      () => {
        setExample({ kind: "idle" });
        setAt(null);
      },
      (e) => setExample({ kind: "failed", text: e instanceof Error ? e.message : String(e) }),
    );
  };
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
          {onExample && (
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              disabled={example.kind === "making"}
              aria-busy={example.kind === "making"}
              onClick={openExample}
            >
              <BusIcon />
              <span>
                {example.kind === "making" ? t("help.exampleMaking") : t("help.example")}
                <span className="block text-xs font-normal text-slate-500">{t("help.exampleHint")}</span>
              </span>
            </button>
          )}
          {example.kind === "failed" && (
            <p role="alert" className="mx-2 mb-2 max-w-64 rounded bg-red-50 px-2 py-1.5 text-xs text-red-700">
              {t("help.exampleFailed", { error: example.text })}
            </p>
          )}
        </Popover>
      )}
    </>
  );
}
