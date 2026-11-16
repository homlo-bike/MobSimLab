import { useId, useState } from "react";
import { useI18n } from "../i18n/i18n";
import { RAIL_MODES } from "../features/railways/modes";
import {
  DESIGN_RULES,
  type DesignRule,
  type PreferencesDoc,
  prefValue,
  rulePrefId,
  withPref,
} from "./preferences";

/** Project mode ids that the railway design tool knows by another id. */
const RAIL_MODE_OF: Record<string, string> = { intercity_rail: "long_distance_rail" };

const num = (v: number) => String(Number(v.toPrecision(6)));

/**
 * Purpose: the design rules of the railway design tool per rail mode (curve radii, gradient, platforms…), with
 * the assumption library's value beside each and a way back to it. The railway editor checks drawings against
 * the project's values.
 */
export function DesignRulesSection({
  projectModes,
  preferences,
  editable,
  onPreferences,
}: {
  projectModes: readonly string[];
  preferences: PreferencesDoc | null;
  editable: boolean;
  onPreferences: (doc: PreferencesDoc) => void;
}) {
  const { t } = useI18n();
  const modeId = useId();
  const own = projectModes.map((m) => RAIL_MODE_OF[m] ?? m).filter((m) => RAIL_MODES.some((r) => r.id === m));
  const [mode, setMode] = useState<string>(own[0] ?? "tram");
  const changed = (m: string) =>
    DESIGN_RULES.filter((r) => {
      const id = rulePrefId(r, m);
      return id !== null && prefValue(preferences, id) !== undefined;
    }).length;
  return (
    <section
      aria-labelledby="pp-rules"
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 md:p-6"
    >
      <h2 id="pp-rules" className="caps m-0">
        {t("prefs.rulesTitle")}
      </h2>
      <p className="mt-1 text-sm text-slate-600">{t("prefs.rulesIntro")}</p>
      <label className="mt-4 mb-1.5 block font-semibold" htmlFor={modeId}>
        {t("prefs.rulesMode")}
      </label>
      <div className="field">
        <select id={modeId} value={mode} onChange={(e) => setMode(e.target.value)}>
          {RAIL_MODES.map((r) => {
            const n = changed(r.id);
            return (
              <option key={r.id} value={r.id}>
                {t(r.label)}
                {n ? ` · ${t("prefs.rulesChanged", { count: n })}` : ""}
              </option>
            );
          })}
        </select>
      </div>
      {[DESIGN_RULES.filter((r) => r.engine), DESIGN_RULES.filter((r) => !r.engine)].map((rules, i) => (
        <div key={i} className="mt-2 flex flex-col">
          {i === 1 && (
            <>
              <h3 className="mt-4 mb-0 font-semibold">{t("prefs.accessTitle")}</h3>
              <p className="mt-1 mb-1 text-sm text-slate-600">{t("prefs.accessIntro")}</p>
            </>
          )}
          {rules.map((rule) => (
            <RuleField
              key={`${mode}-${rule.field}`}
              rule={rule}
              mode={mode}
              value={prefValue(preferences, rulePrefId(rule, mode) ?? "")}
              editable={editable}
              onChange={(v) => {
                const id = rulePrefId(rule, mode);
                if (id) onPreferences(withPref(preferences, id, v));
              }}
            />
          ))}
        </div>
      ))}
      {!editable && <p className="mt-3 text-sm text-slate-500">{t("prefs.readOnly")}</p>}
    </section>
  );
}

/**
 * Purpose: one design rule's value for a mode, with the library's value and range beside it.
 * `value` undefined means the library's applies; `onChange(null)` returns to it.
 */
function RuleField({
  rule,
  mode,
  value,
  editable,
  onChange,
}: {
  rule: DesignRule;
  mode: string;
  value: number | undefined;
  editable: boolean;
  onChange: (v: number | null) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const lib = rule.modes[mode]?.values;
  // What the planner is typing; the saved value shows again once the field is left.
  const [text, setText] = useState<string | null>(null);
  if (!lib) return null;
  const [low, central, high] = lib;
  const commit = (raw: string) => {
    const n = Number(raw.replace(",", "."));
    if (raw.trim() === "" || !Number.isFinite(n) || n <= 0) return;
    onChange(Math.abs(n - central) < 1e-9 ? null : n);
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 py-3 first:border-t-0">
      <label htmlFor={id} className="min-w-48 flex-1 font-semibold">
        {rule.label}
      </label>
      <div className="flex items-center gap-1.5">
        <div className="field w-28">
          <input
            id={id}
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            disabled={!editable}
            value={text ?? num(value ?? central)}
            onChange={(e) => {
              setText(e.target.value);
              commit(e.target.value);
            }}
            onBlur={() => setText(null)}
            className="text-end"
          />
        </div>
        <span className="w-12 text-sm text-slate-600">{rule.unit}</span>
      </div>
      <div className="flex w-full flex-wrap items-center gap-2 text-sm text-slate-500">
        <span>
          {low !== high
            ? t("prefs.rulesLibraryRange", {
                value: num(central),
                low: num(low),
                high: num(high),
                unit: rule.unit,
              })
            : t("prefs.rulesLibrary", { value: num(central), unit: rule.unit })}
        </span>
        {editable && value !== undefined && (
          <button
            type="button"
            className="min-h-10 text-blue-700 underline"
            onClick={() => {
              setText(null);
              onChange(null);
            }}
          >
            {t("prefs.delayReset")}
          </button>
        )}
      </div>
    </div>
  );
}
