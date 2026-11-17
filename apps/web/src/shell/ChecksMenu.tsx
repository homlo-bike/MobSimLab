import { useState } from "react";
import { useI18n } from "../i18n/i18n";
import { type CheckSeverity, useCheckGroups } from "./checks";
import { BellIcon } from "./icons";
import { anchorOf, Popover } from "./Popover";

const DOT: Record<CheckSeverity, string> = {
  error: "bg-red-600",
  warning: "bg-amber-500",
  info: "bg-slate-400",
  ok: "bg-emerald-600",
};
const RANK: Record<CheckSeverity, number> = { error: 0, warning: 1, info: 2, ok: 3 };

/**
 * The notifications (bell) button in a project's top bar: the live checks of every drawing tool (street lines,
 * railway, depots and the plugins' tools), grouped by tool, errors first. The badge counts errors and warnings.
 */
export function ChecksMenu() {
  const { t } = useI18n();
  const [at, setAt] = useState<ReturnType<typeof anchorOf> | null>(null);
  const groups = useCheckGroups().filter((g) => g.items.length > 0);
  const errors = groups.reduce((n, g) => n + g.items.filter((i) => i.severity === "error").length, 0);
  const warnings = groups.reduce((n, g) => n + g.items.filter((i) => i.severity === "warning").length, 0);
  const count = errors + warnings;
  const label = count > 0 ? t("checks.menuCount", { errors, warnings }) : t("checks.menu");
  return (
    <>
      <button
        type="button"
        className="icon-btn relative"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={Boolean(at)}
        data-tour="checks"
        onClick={(e) => setAt(at ? null : anchorOf(e.currentTarget))}
      >
        <BellIcon />
        {count > 0 && (
          <span
            aria-hidden="true"
            className={`absolute top-1 end-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white ${errors > 0 ? "bg-red-600" : "bg-amber-500"}`}
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
      {at && (
        <Popover at={at} align="right" label={t("checks.menu")} onClose={() => setAt(null)}>
          <div className="max-h-[70vh] w-[min(26rem,calc(100vw-2rem))] overflow-auto overscroll-contain">
            <div className="px-3 pt-2 pb-1 font-semibold">{t("checks.title")}</div>
            {groups.length === 0 && <p className="px-3 pb-3 text-sm text-slate-500">{t("checks.none")}</p>}
            {groups.map((g) => (
              <section key={g.source} aria-label={g.label} className="pb-1">
                <h3 className="caps px-3 pt-3 pb-1">
                  {g.label}
                  {!g.live && <span className="ms-1 normal-case">· {t("checks.lastOpened")}</span>}
                </h3>
                <ul className="m-0 flex list-none flex-col p-0" aria-label={g.label}>
                  {[...g.items]
                    .sort((x, y) => RANK[x.severity] - RANK[y.severity])
                    .map((i, k) => {
                      const content = (
                        <>
                          <span
                            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[i.severity]}`}
                            aria-label={t(`severity.${i.severity}`)}
                          />
                          <span className="min-w-0 flex-1 text-sm font-normal break-words">
                            {i.text}
                            {i.detail && <span className="block text-xs text-slate-500">{i.detail}</span>}
                          </span>
                        </>
                      );
                      return (
                        <li key={k}>
                          {i.onShow ? (
                            <button
                              type="button"
                              role="menuitem"
                              className="menu-item min-h-0 items-start py-1.5"
                              onClick={() => {
                                setAt(null);
                                i.onShow?.();
                              }}
                            >
                              {content}
                            </button>
                          ) : (
                            <div className="flex items-start gap-2.5 px-3 py-1.5">{content}</div>
                          )}
                        </li>
                      );
                    })}
                </ul>
              </section>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}
