import { useI18n } from "../../i18n/i18n";
import { DAY_TYPES, type DayTypeId } from "../../workspace/calendar";
import { useDayTypeLabel } from "../../workspace/dayTypeLabel";

/**
 * Purpose: which day type a line's times and headways below apply to, and whether that day runs as on a
 * weekday. Used by the street line tool and the railway tool's service lines.
 */
export function DayTypeChoice({
  day,
  onDay,
  own,
  onOwn,
  editable = true,
}: {
  day: DayTypeId;
  onDay: (d: DayTypeId) => void;
  /** Whether the line has its own service on this day type. */
  own: boolean;
  /** Start this day's own service from the weekday's (true) or go back to the weekday's (false). */
  onOwn: (own: boolean) => void;
  editable?: boolean;
}) {
  const { t } = useI18n();
  const dayLabel = useDayTypeLabel();
  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center justify-between gap-2">
        <span>{t("tt.dayType")}</span>
        <select
          aria-label={t("tt.dayType")}
          value={day}
          onChange={(e) => onDay(e.target.value as DayTypeId)}
          className="rounded border border-slate-300 p-0.5"
        >
          {DAY_TYPES.map((d) => (
            <option key={d} value={d}>
              {dayLabel(d)}
            </option>
          ))}
        </select>
      </label>
      {day !== "weekday" && (
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={!own}
            disabled={!editable}
            onChange={(e) => onOwn(!e.target.checked)}
          />
          {t("tt.sameAsWeekday")}
        </label>
      )}
    </div>
  );
}
