import { useI18n } from "../../i18n/i18n";

interface Props {
  /** Names of the project's saved lines, in order. */
  names: string[];
  /** The line being edited; `names.length` for a new line not drawn yet. */
  current: number;
  onSelect: (index: number) => void;
  onNew: () => void;
  onDelete: (index: number) => void;
}

/**
 * Purpose: the project's street lines at the top of the street line panel: pick the one to edit, start a new
 * one, or delete the one being edited (after asking).
 */
export function LineList({ names, current, onSelect, onNew, onDelete }: Props) {
  const { t } = useI18n();
  const isNew = current >= names.length;
  const name = isNew ? null : names[current] || t("street.untitled");
  return (
    <div className="flex flex-col gap-1 rounded-md bg-slate-50 p-2">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-slate-600">{t("street.lines", { n: names.length })}</span>
        <select
          value={current}
          onChange={(e) => onSelect(Number(e.target.value))}
          className="rounded border border-slate-300 bg-white p-1"
        >
          {names.map((n, i) => (
            <option key={i} value={i}>
              {n || t("street.untitled")}
            </option>
          ))}
          {isNew && <option value={names.length}>{t("street.newLineDraft")}</option>}
        </select>
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded border border-slate-300 bg-white px-2 py-1 hover:bg-slate-100 disabled:opacity-40"
          disabled={isNew}
          onClick={onNew}
        >
          {t("street.newLine")}
        </button>
        <button
          type="button"
          className="rounded border border-slate-300 bg-white px-2 py-1 text-red-700 hover:bg-red-50 disabled:opacity-40"
          disabled={isNew}
          onClick={() => {
            if (name !== null && window.confirm(t("street.deleteConfirm", { name }))) onDelete(current);
          }}
        >
          {t("street.deleteLine")}
        </button>
      </div>
    </div>
  );
}
