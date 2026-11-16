import { useI18n } from "../../i18n/i18n";

/** At most this many street lines fit in a project (the drawing's limit in the API). */
export const MAX_STREET_LINES = 200;

/**
 * Purpose: pick which of the project's street lines the street line tool edits, start a new one or
 * remove the one open. Shown only when the project has more than one line or the planner may add one.
 */
export function StreetLinePicker({
  names,
  index,
  onPick,
  onNew,
  onRemove,
}: {
  names: readonly string[];
  index: number;
  onPick: (i: number) => void;
  onNew: () => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const count = Math.max(names.length, index + 1);
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2 text-sm md:px-5">
      <label className="flex min-w-0 flex-1 items-center gap-2">
        <span className="text-xs font-medium text-slate-600">{t("street.lines.pick")}</span>
        <select
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1"
          value={index}
          onChange={(e) => onPick(Number(e.target.value))}
        >
          {Array.from({ length: count }, (_, i) => (
            <option key={i} value={i}>
              {names[i] || t("street.lines.unnamed", { n: i + 1 })}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="btn min-h-8 px-2 text-xs"
        disabled={count >= MAX_STREET_LINES}
        onClick={onNew}
      >
        {t("street.lines.new")}
      </button>
      <button
        type="button"
        className="btn min-h-8 px-2 text-xs"
        disabled={names.length <= 1 && index === 0}
        onClick={onRemove}
      >
        {t("street.lines.remove")}
      </button>
    </div>
  );
}
