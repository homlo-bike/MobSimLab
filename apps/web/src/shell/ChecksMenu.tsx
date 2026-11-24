import { useState } from "react";
import type { CommentObjectType } from "../features/comments/api";
import type { CommentNotice, CommentNotices } from "../features/comments/notices";
import { useI18n } from "../i18n/i18n";
import type { MessageKey } from "../i18n/messages";
import { type CheckSeverity, useCheckGroups, useReopenCheck } from "./checks";
import { BellIcon } from "./icons";
import { anchorOf, Popover } from "./Popover";

const DOT: Record<CheckSeverity, string> = {
  error: "bg-red-600",
  warning: "bg-amber-500",
  info: "bg-slate-400",
  ok: "bg-emerald-600",
};
const RANK: Record<CheckSeverity, number> = { error: 0, warning: 1, info: 2, ok: 3 };

/** The name of one object of a kind, for a notice whose object is not in the open project. */
export const COMMENT_KIND: Record<CommentObjectType, MessageKey> = {
  station: "comments.kind.station",
  track: "comments.kind.track",
  switch: "comments.kind.switch",
  signal: "comments.kind.signal",
  "service-line": "comments.kind.service-line",
  "street-line": "comments.kind.street-line",
  depot: "comments.kind.depot",
};

/**
 * The notifications (bell) button in a project's top bar: new comments and replies on the person's projects
 * (`notices`), newest first, each opening its object's comments; then the live checks of every drawing tool
 * (street lines, railway, depots and the plugins' tools), grouped by tool, errors first. The badge counts errors,
 * warnings and new comments.
 * Inputs: `notices` and `onOpenNotice` (left out: checks only); `objectLabel` names an object of the open project.
 */
export function ChecksMenu({
  notices,
  onOpenNotice,
  objectLabel,
}: {
  notices?: CommentNotices;
  onOpenNotice?: (n: CommentNotice) => void;
  objectLabel?: (n: CommentNotice) => string | null;
} = {}) {
  const { t, tn, language } = useI18n();
  const [at, setAt] = useState<ReturnType<typeof anchorOf> | null>(null);
  const groups = useCheckGroups().filter((g) => g.items.length > 0);
  const reopen = useReopenCheck();
  const errors = groups.reduce((n, g) => n + g.items.filter((i) => i.severity === "error").length, 0);
  const warnings = groups.reduce((n, g) => n + g.items.filter((i) => i.severity === "warning").length, 0);
  const fresh = notices?.total ?? 0;
  const count = errors + warnings + fresh;
  const checksLabel = errors + warnings > 0 ? t("checks.menuCount", { errors, warnings }) : t("checks.menu");
  const label = fresh > 0 ? `${checksLabel} · ${tn("comments.newCount", fresh)}` : checksLabel;
  const when = (iso: string) =>
    new Date(iso).toLocaleString(language, {
      dateStyle: "medium",
      timeStyle: "short",
      numberingSystem: "latn",
    });
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
            className={`absolute top-1 end-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white ${errors > 0 ? "bg-red-600" : warnings > 0 ? "bg-amber-500" : "bg-blue-600"}`}
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
      {at && (
        <Popover at={at} align="right" label={t("checks.menu")} onClose={() => setAt(null)}>
          <div className="max-h-[70vh] w-[min(26rem,calc(100vw-2rem))] overflow-auto overscroll-contain">
            {notices && notices.comments.length > 0 && (
              <section aria-label={t("comments.notices")} className="border-b border-slate-200 pb-2">
                <div className="flex items-center gap-2 px-3 pt-2 pb-1">
                  <span className="flex-1 font-semibold">
                    {t("comments.notices")} · {fresh > 99 ? "99+" : fresh}
                  </span>
                  <button
                    type="button"
                    className="rounded px-1.5 py-0.5 text-xs text-blue-700 hover:bg-slate-100"
                    onClick={() => notices.markRead({ all: true })}
                  >
                    {t("comments.markAllRead")}
                  </button>
                </div>
                <ul className="m-0 flex list-none flex-col p-0" aria-label={t("comments.notices")}>
                  {notices.comments.map((n) => {
                    const name = n.author?.displayName || t("comments.someone");
                    const object = objectLabel?.(n) ?? t(COMMENT_KIND[n.objectType]);
                    return (
                      <li key={n.id}>
                        <button
                          type="button"
                          role="menuitem"
                          className="menu-item min-h-0 items-start py-1.5"
                          onClick={() => {
                            setAt(null);
                            onOpenNotice?.(n);
                          }}
                        >
                          <span
                            className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-600"
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1 text-sm font-normal break-words">
                            {t(n.parentId ? "comments.noticeReply" : "comments.noticeComment", {
                              name,
                              object,
                            })}
                            <span className="block text-xs text-slate-500">
                              {n.projectName} · <time dateTime={n.createdAt}>{when(n.createdAt)}</time>
                            </span>
                            <span className="block text-xs text-slate-600 line-clamp-2">{n.body}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
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
                      // A live check shows its element; any other opens its tool, which then shows it.
                      const show = i.onShow ?? (reopen ? () => reopen(g, i) : null);
                      return (
                        <li key={k}>
                          {show ? (
                            <button
                              type="button"
                              role="menuitem"
                              className="menu-item min-h-0 items-start py-1.5"
                              onClick={() => {
                                setAt(null);
                                show();
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
