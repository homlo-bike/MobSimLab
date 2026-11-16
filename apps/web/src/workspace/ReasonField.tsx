import { useId, useState } from "react";
import { useI18n } from "../i18n/i18n";
import { MAX_REASON, type PreferencesDoc, prefValue, reasonOf, withReason } from "./preferences";

/**
 * Purpose: the optional reason for the project's own value of one assumption. The project's audit log records
 * it with the change (who, when, old and new value). Shown only while the project has its own value; saved
 * when the field is left.
 */
export function ReasonField({
  valueId,
  preferences,
  editable,
  onPreferences,
}: {
  /** Assumption id of the value, for example `street.mixed_traffic_delay_share`. */
  valueId: string;
  preferences: PreferencesDoc | null | undefined;
  editable: boolean;
  onPreferences: (doc: PreferencesDoc) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const saved = reasonOf(preferences, valueId);
  // What the planner is typing; saved when the field is left.
  const [text, setText] = useState<string | null>(null);
  if (prefValue(preferences, valueId) === undefined) return null;
  if (!editable)
    return saved ? (
      <p className="m-0 w-full text-sm text-slate-600">
        {t("prefs.reason")}: {saved}
      </p>
    ) : null;
  const commit = () => {
    if (text !== null && text.trim() !== saved) onPreferences(withReason(preferences, valueId, text));
    setText(null);
  };
  return (
    <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
      <label htmlFor={id} className="text-sm text-slate-600">
        {t("prefs.reason")}
      </label>
      <div className="field min-w-48 flex-1">
        <input
          id={id}
          maxLength={MAX_REASON}
          value={text ?? saved}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      </div>
    </div>
  );
}
