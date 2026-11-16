import { useId, useState } from "react";
import { useI18n } from "../i18n/i18n";
import { LIBRARY_SAME_NAME_M, type PreferencesDoc, prefValue, SAME_NAME_PREF, withPref } from "./preferences";

/** Largest same-name station distance accepted, metres. */
const MAX_SAME_NAME_M = 5000;

/**
 * Purpose: the Preferences section for how stops become stations: the distance within which stops with the
 * same name are one station (`journey.same_name_station_m`), used by the schematic map, the journey planner
 * and the benefits and ridership tables. `editable` false shows the value only.
 */
export function StationsSection({
  preferences,
  editable,
  onPreferences,
}: {
  preferences: PreferencesDoc | null;
  editable: boolean;
  onPreferences: (doc: PreferencesDoc) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const value = prefValue(preferences, SAME_NAME_PREF);
  // What the planner is typing; the saved value shows again once the field is left.
  const [text, setText] = useState<string | null>(null);
  const commit = (raw: string) => {
    const n = Number(raw.replace(",", "."));
    if (raw.trim() === "" || !Number.isFinite(n) || n < 0 || n > MAX_SAME_NAME_M) return;
    const m = Math.round(n);
    onPreferences(withPref(preferences, SAME_NAME_PREF, m === LIBRARY_SAME_NAME_M ? null : m));
  };
  return (
    <section
      aria-labelledby="pp-stations"
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 md:p-6"
    >
      <h2 id="pp-stations" className="caps m-0">
        {t("prefs.stationsTitle")}
      </h2>
      <p className="mt-1 text-sm text-slate-600">{t("prefs.stationsIntro")}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
        <label htmlFor={id} className="min-w-48 flex-1 font-semibold">
          {t("jp.set.sameName")}
        </label>
        <div className="field w-24">
          <input
            id={id}
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_SAME_NAME_M}
            step={50}
            disabled={!editable}
            value={text ?? String(value ?? LIBRARY_SAME_NAME_M)}
            onChange={(e) => {
              setText(e.target.value);
              commit(e.target.value);
            }}
            onBlur={() => setText(null)}
            className="text-end"
          />
        </div>
        <div className="flex w-full items-center gap-2 text-sm text-slate-500">
          <span>{t("prefs.libraryM", { value: LIBRARY_SAME_NAME_M })}</span>
          {editable && value !== undefined && (
            <button
              type="button"
              className="min-h-10 text-blue-700 underline"
              onClick={() => {
                setText(null);
                onPreferences(withPref(preferences, SAME_NAME_PREF, null));
              }}
            >
              {t("prefs.delayReset")}
            </button>
          )}
        </div>
      </div>
      {!editable && <p className="mt-3 text-sm text-slate-500">{t("prefs.readOnly")}</p>}
    </section>
  );
}
