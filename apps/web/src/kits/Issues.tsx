import { useEngineText } from "../i18n/engine";
import { useI18n } from "../i18n/i18n";
import { usePublishChecks } from "../shell/checks";
import type { Issue } from "./types";

const STYLE: Record<Issue["level"], string> = {
  error: "border-red-300 bg-red-50 text-red-900",
  warning: "border-amber-300 bg-amber-50 text-amber-950",
  info: "border-slate-200 bg-slate-50 text-slate-700",
};

/**
 * Purpose: the kit's live checks. In a project they go to the notifications button in the top bar (under the
 * tool's name); on its own the editor lists them here, errors first.
 */
export function Issues({
  issues,
  where,
  source,
  label,
  onShow,
}: {
  issues: Issue[];
  where: (i: Issue) => string | null;
  /** Shows the station or section a check is about, when it names one (from the notifications list). */
  onShow?: (i: Issue) => (() => void) | null;
  /** The tool's id and name, for the notifications list. */
  source: string;
  label: string;
}) {
  const { t } = useI18n();
  const engineText = useEngineText();
  const text = (i: Issue) => engineText({ text: i.message, msg: i.msg });
  const elsewhere = usePublishChecks(
    source,
    label,
    issues.map((i) => ({
      severity: i.level,
      text: where(i) ? `${where(i)}: ${text(i)}` : text(i),
      ...(i.parameter ? { detail: t("kit.parameter", { name: i.parameter }) } : {}),
      ...(onShow?.(i) ? { onShow: onShow(i)! } : {}),
    })),
  );
  if (elsewhere || !issues.length) return null;
  const order = { error: 0, warning: 1, info: 2 };
  const sorted = [...issues].sort((a, b) => order[a.level] - order[b.level]);
  return (
    <ul className="mt-2 flex flex-col gap-1.5" aria-label={t("kit.checks")}>
      {sorted.map((i, k) => (
        <li key={k} className={`rounded-lg border px-2.5 py-1.5 text-xs ${STYLE[i.level]}`}>
          <span className="font-semibold">
            {where(i)
              ? t("kit.issueWhere", { level: t(`severity.${i.level}`), where: where(i)! })
              : t("kit.issue", { level: t(`severity.${i.level}`) })}
          </span>{" "}
          {text(i)}
          {i.parameter && (
            <span className="block text-[11px] opacity-75">{t("kit.parameter", { name: i.parameter })}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Purpose: one figure of a summary grid. */
export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2.5 py-1.5">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="font-semibold text-slate-900">{value}</div>
    </div>
  );
}
