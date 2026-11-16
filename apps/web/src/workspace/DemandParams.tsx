import { useId, useMemo, useState } from "react";
import { useI18n } from "../i18n/i18n";
import type { MessageKey } from "../i18n/messages";
import {
  acceptable,
  DEMAND_PARAMS,
  DEMAND_STEPS,
  type DemandParam,
  type DemandStep,
} from "../features/demand/params";
import { type PreferencesDoc, prefValue, withPref } from "./preferences";

const num = (v: number) => String(Number(v.toPrecision(6)));
const stepLabel = (s: DemandStep) => `prefs.demandStep.${s}` as MessageKey;

/**
 * Purpose: every value of the demand model (ADR-0019), by model step and searchable, with the assumption
 * library's value and range beside each and a way back to it. Demand runs use the project's values.
 */
export function DemandParamsSection({
  preferences,
  editable,
  onPreferences,
}: {
  preferences: PreferencesDoc | null;
  editable: boolean;
  onPreferences: (doc: PreferencesDoc) => void;
}) {
  const { t } = useI18n();
  const stepId = useId();
  const searchId = useId();
  const [step, setStep] = useState<DemandStep | "all">("zones");
  const [query, setQuery] = useState("");
  const changed = (s: DemandStep | "all") =>
    DEMAND_PARAMS.filter((p) => (s === "all" || p.step === s) && prefValue(preferences, p.key) !== undefined)
      .length;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return DEMAND_PARAMS.filter(
      (p) =>
        (step === "all" || p.step === step) &&
        (!q || p.label.toLowerCase().includes(q) || p.key.toLowerCase().includes(q)),
    );
  }, [step, query]);
  const option = (s: DemandStep | "all", label: string) => {
    const n = changed(s);
    return (
      <option key={s} value={s}>
        {label}
        {n ? ` · ${t("prefs.rulesChanged", { count: n })}` : ""}
      </option>
    );
  };
  return (
    <section
      aria-labelledby="pp-demand"
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 md:p-6"
    >
      <h2 id="pp-demand" className="caps m-0">
        {t("prefs.demandTitle")}
      </h2>
      <p className="mt-1 text-sm text-slate-600">{t("prefs.demandIntro")}</p>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
        <div className="min-w-48 flex-1">
          <label className="mb-1.5 block font-semibold" htmlFor={stepId}>
            {t("prefs.demandStep")}
          </label>
          <div className="field">
            <select id={stepId} value={step} onChange={(e) => setStep(e.target.value as DemandStep | "all")}>
              {DEMAND_STEPS.map((s) => option(s, t(stepLabel(s))))}
              {option("all", t("prefs.demandAll"))}
            </select>
          </div>
        </div>
        <div className="min-w-48 flex-1">
          <label className="mb-1.5 block font-semibold" htmlFor={searchId}>
            {t("prefs.demandSearch")}
          </label>
          <div className="field">
            <input id={searchId} type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-col">
        {shown.map((p) => (
          <ParamField
            key={p.key}
            param={p}
            value={prefValue(preferences, p.key)}
            editable={editable}
            onChange={(v) => onPreferences(withPref(preferences, p.key, v))}
          />
        ))}
        {!shown.length && <p className="mt-3 text-sm text-slate-500">{t("prefs.demandNone")}</p>}
      </div>
      {!editable && <p className="mt-3 text-sm text-slate-500">{t("prefs.readOnly")}</p>}
    </section>
  );
}

/**
 * Purpose: one demand value, with the library's value and range beside it.
 * `value` undefined means the library's applies; `onChange(null)` returns to it.
 */
function ParamField({
  param,
  value,
  editable,
  onChange,
}: {
  param: DemandParam;
  value: number | undefined;
  editable: boolean;
  onChange: (v: number | null) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  // What the planner is typing; the saved value shows again once the field is left.
  const [text, setText] = useState<string | null>(null);
  const [low, central, high] = param.values;
  const commit = (raw: string) => {
    const n = Number(raw.replace(",", "."));
    if (raw.trim() === "" || !acceptable(param, n)) return;
    onChange(Math.abs(n - central) < 1e-12 ? null : n);
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 py-3 first:border-t-0">
      <label htmlFor={id} className="min-w-48 flex-1 font-semibold">
        {param.label}
      </label>
      <div className="flex items-center gap-1.5">
        <div className="field w-28">
          <input
            id={id}
            type="number"
            inputMode="decimal"
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
        <span className="w-24 text-sm text-slate-600">{param.unit}</span>
      </div>
      <div className="flex w-full flex-wrap items-center gap-2 text-sm text-slate-500">
        <span>
          {low !== high
            ? t("prefs.rulesLibraryRange", {
                value: num(central),
                low: num(low),
                high: num(high),
                unit: param.unit,
              })
            : t("prefs.rulesLibrary", { value: num(central), unit: param.unit })}
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
