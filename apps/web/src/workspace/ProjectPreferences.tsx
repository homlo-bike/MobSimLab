import { type FormEvent, useId, useState } from "react";
import { useI18n } from "../i18n/i18n";
import { DELAY_PREFS, MAX_DELAY_SHARE, type PreferencesDoc, prefValue, withPref } from "./preferences";
import { can, type Project, type ProjectsApi } from "../projects/api";
import { ModePicker } from "../projects/ProjectDialogs";
import { Placeholder } from "./Placeholder";
import type { ProjectPlugin } from "../plugins/registry";
import { ProjectPlugins } from "./ProjectPlugins";
import { DesignRulesSection } from "./DesignRules";
import { VehicleChoiceSection } from "./VehicleChoice";
import { SwitchChoiceSection } from "./SwitchChoice";
import { ParametersSection } from "./Parameters";
import { AssumptionsReportSection } from "./AssumptionsReport";
import { roadValue } from "../features/road-sim/params";
import { StationsSection } from "./StationsSection";
import { CURRENCY_CODES } from "../features/costs/currencies";
import { type CurrencyState, NO_CURRENCY, RATE_PREF, withCurrency } from "../features/costs/currency";

/**
 * Preferences tab (mockup "Project preferences"): the project's name, description, study area and modes, which
 * Owners and Editors can change, the design rules per rail mode and the catalogue vehicles and switches used.
 * Calendar, demand and costs follow.
 */
export function ProjectPreferences({
  api,
  project,
  onSaved,
  preferences = null,
  onPreferences,
  plugins = null,
  onSetPlugin,
  currency = NO_CURRENCY,
}: {
  api: ProjectsApi;
  project: Project;
  onSaved: (p: Project) => void;
  /** The project's preferences document (assumption values it changes); saved with the project's drawings. */
  preferences?: PreferencesDoc | null;
  /** Told about each change to the preferences; the project saves it. */
  onPreferences?: (doc: PreferencesDoc) => void;
  /** The plugins the project can use (ADR-0036 §9); null while loading. */
  plugins?: readonly ProjectPlugin[] | null;
  /** Turn a plugin on or off for the project (Owners). */
  onSetPlugin?: (pluginId: string, enabled: boolean, version?: string) => Promise<void>;
  /** The project's currency and its exchange rate. */
  currency?: CurrencyState;
}) {
  const { t } = useI18n();
  const editable = can.edit(project);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [area, setArea] = useState(project.areaName ?? "");
  const [modes, setModes] = useState(project.modes);
  const [state, setState] = useState<"idle" | "saving" | "saved" | { error: string }>("idle");
  const dirty =
    name.trim() !== project.name ||
    description.trim() !== project.description ||
    (area.trim() || null) !== project.areaName ||
    [...modes].sort().join() !== [...project.modes].sort().join();
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setState("saving");
    try {
      onSaved(
        await api.update(project.id, {
          name: name.trim(),
          description: description.trim(),
          areaName: area.trim() || null,
          modes,
        }),
      );
      setState("saved");
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : String(err) });
    }
  };
  const label = "mt-4 mb-1.5 block font-semibold";
  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10">
        <h1 className="text-2xl font-semibold tracking-tight">{t("prefs.title")}</h1>
        <p className="mt-1 text-slate-600">{t("prefs.intro")}</p>
        <form
          onSubmit={(e) => void save(e)}
          className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 md:p-6"
        >
          <h2 className="caps m-0">{t("prefs.project")}</h2>
          <fieldset disabled={!editable} className="m-0 border-0 p-0">
            <label className={label} htmlFor="pp-name">
              {t("new.name")}
            </label>
            <div className="field">
              <input
                id="pp-name"
                required
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <label className={label} htmlFor="pp-desc">
              {t("prefs.description")}
            </label>
            <textarea
              id="pp-desc"
              maxLength={2000}
              rows={3}
              className="w-full rounded-[10px] border border-slate-300 px-3 py-2 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <label className={label} htmlFor="pp-area">
              {t("new.area")}
            </label>
            <div className="field">
              <input id="pp-area" maxLength={200} value={area} onChange={(e) => setArea(e.target.value)} />
            </div>
            <div className={label}>{t("new.modes")}</div>
            <ModePicker value={modes} onChange={setModes} />
          </fieldset>
          {editable ? (
            <div className="mt-5 flex items-center gap-3">
              <button
                type="submit"
                className="btn btn-pri"
                disabled={!dirty || !name.trim() || state === "saving"}
              >
                {t("prefs.save")}
              </button>
              <span role="status" className="text-sm text-slate-600">
                {state === "saved" && !dirty
                  ? t("prefs.saved")
                  : typeof state === "object"
                    ? state.error
                    : ""}
              </span>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">{t("prefs.readOnly")}</p>
          )}
        </form>
        <DesignRulesSection
          projectModes={project.modes}
          preferences={preferences}
          editable={editable && !!onPreferences}
          onPreferences={(d) => onPreferences?.(d)}
        />
        <VehicleChoiceSection
          projectModes={project.modes}
          preferences={preferences}
          editable={editable && !!onPreferences}
          onPreferences={(d) => onPreferences?.(d)}
        />
        <SwitchChoiceSection
          projectModes={project.modes}
          preferences={preferences}
          editable={editable && !!onPreferences}
          onPreferences={(d) => onPreferences?.(d)}
        />
        <section
          aria-labelledby="pp-delay"
          className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 md:p-6"
        >
          <h2 id="pp-delay" className="caps m-0">
            {t("prefs.delayTitle")}
          </h2>
          <p className="mt-1 text-sm text-slate-600">{t("prefs.delayIntro")}</p>
          <div className="mt-2 flex flex-col gap-1">
            {DELAY_PREFS.map((p) => (
              <ShareField
                key={p.id}
                label={t(p.label)}
                library={p.library}
                value={prefValue(preferences, p.id)}
                editable={editable && !!onPreferences}
                onChange={(v) => onPreferences?.(withPref(preferences, p.id, v))}
              />
            ))}
          </div>
          {!editable && <p className="mt-3 text-sm text-slate-500">{t("prefs.readOnly")}</p>}
        </section>
        <section
          aria-labelledby="pp-road"
          className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 md:p-6"
        >
          <h2 id="pp-road" className="caps m-0">
            {t("prefs.roadTitle")}
          </h2>
          <p className="mt-1 text-sm text-slate-600">{t("prefs.roadIntro")}</p>
          <div className="mt-2 flex flex-col gap-1">
            <ShareField
              label={t("prefs.offPeakTraffic")}
              library={OFF_PEAK_LIBRARY}
              max={1}
              value={prefValue(preferences, OFF_PEAK_PREF)}
              editable={editable && !!onPreferences}
              onChange={(v) => onPreferences?.(withPref(preferences, OFF_PEAK_PREF, v))}
            />
          </div>
          {!editable && <p className="mt-3 text-sm text-slate-500">{t("prefs.readOnly")}</p>}
        </section>
        <StationsSection
          preferences={preferences}
          editable={editable && !!onPreferences}
          onPreferences={(d) => onPreferences?.(d)}
        />
        <CurrencySection
          state={currency}
          preferences={preferences}
          editable={editable && !!onPreferences}
          onPreferences={(d) => onPreferences?.(d)}
        />
        <ParametersSection
          preferences={preferences}
          editable={editable && !!onPreferences}
          onPreferences={(d) => onPreferences?.(d)}
        />
        <AssumptionsReportSection
          projectName={project.name}
          projectModes={project.modes}
          preferences={preferences}
          currency={currency.chosen}
        />
        {onSetPlugin && <ProjectPlugins plugins={plugins} manage={can.manage(project)} onSet={onSetPlugin} />}
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 md:p-6">
          <Placeholder title="prefs.moreTitle" intro="prefs.moreIntro" items={["prefs.calendar"]} />
        </div>
      </div>
    </div>
  );
}

/** Off-peak traffic of the road simulation, as a share of each street's peak value. */
const OFF_PEAK_PREF = "road.off_peak_traffic_share";
const OFF_PEAK_LIBRARY = roadValue(OFF_PEAK_PREF, "*", undefined)[1];

const pct = (share: number) => String(Math.round(share * 1000) / 10);

/**
 * Purpose: one share entered in percent, with the assumption library's value beside it and a way back to it.
 * `value` undefined means the library's applies; `onChange(null)` returns to it.
 */
function ShareField({
  label,
  library,
  max = MAX_DELAY_SHARE,
  value,
  editable,
  onChange,
}: {
  label: string;
  library: number;
  /** Largest share accepted. */
  max?: number;
  value: number | undefined;
  editable: boolean;
  onChange: (share: number | null) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const shown = pct(value ?? library);
  // What the planner is typing; the saved value shows again once the field is left.
  const [text, setText] = useState<string | null>(null);
  const commit = (raw: string) => {
    const n = Number(raw.replace(",", "."));
    if (raw.trim() === "" || !Number.isFinite(n) || n < 0 || n > max * 100) return;
    const share = Math.round(n * 10) / 1000;
    onChange(Math.abs(share - library) < 1e-9 ? null : share);
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 py-3 first:border-t-0">
      <label htmlFor={id} className="min-w-48 flex-1 font-semibold">
        {label}
      </label>
      <div className="flex items-center gap-1.5">
        <div className="field w-24">
          <input
            id={id}
            type="number"
            inputMode="decimal"
            min={0}
            max={max * 100}
            step={1}
            disabled={!editable}
            value={text ?? shown}
            onChange={(e) => {
              setText(e.target.value);
              commit(e.target.value);
            }}
            onBlur={() => setText(null)}
            className="text-end"
          />
        </div>
        <span aria-hidden="true">%</span>
      </div>
      <div className="flex w-full items-center gap-2 text-sm text-slate-500">
        <span>{t("prefs.delayDefault", { value: pct(library) })}</span>
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

const sig = (v: number) => String(Number(v.toPrecision(6)));

/**
 * Purpose: the currency all money in the project is shown in, and its rate per US$: the World Bank's official
 * exchange rate, or the project's own.
 */
function CurrencySection({
  state,
  preferences,
  editable,
  onPreferences,
}: {
  state: CurrencyState;
  preferences: PreferencesDoc | null;
  editable: boolean;
  onPreferences: (doc: PreferencesDoc) => void;
}) {
  const { t, language } = useI18n();
  const rateId = useId();
  const [text, setText] = useState<string | null>(null);
  const names = (() => {
    try {
      return new Intl.DisplayNames([language, "en"], { type: "currency" });
    } catch {
      return null;
    }
  })();
  const nameOf = (code: string) => {
    const n = names?.of(code);
    return n && n !== code ? `${code} · ${n}` : code;
  };
  const chosen = state.chosen;
  const own = prefValue(preferences, RATE_PREF);
  const shown = own ?? state.worldBank?.value;
  const commit = (raw: string) => {
    const n = Number(raw.replace(",", "."));
    if (raw.trim() === "" || !Number.isFinite(n) || n <= 0) return;
    onPreferences(withPref(preferences, RATE_PREF, n));
  };
  return (
    <section
      aria-labelledby="pp-currency"
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 md:p-6"
    >
      <h2 id="pp-currency" className="caps m-0">
        {t("prefs.currencyTitle")}
      </h2>
      <p className="mt-1 text-sm text-slate-600">{t("prefs.currencyIntro")}</p>
      <label className="mt-4 mb-1.5 block font-semibold" htmlFor="pp-currency-code">
        {t("prefs.currencyLabel")}
      </label>
      <div className="field">
        <select
          id="pp-currency-code"
          disabled={!editable}
          value={chosen ?? ""}
          onChange={(e) => {
            setText(null);
            onPreferences(withCurrency(preferences, e.target.value || null));
          }}
        >
          <option value="">{t("prefs.currencyCountry")}</option>
          {CURRENCY_CODES.map((c) => (
            <option key={c} value={c}>
              {nameOf(c)}
            </option>
          ))}
        </select>
      </div>
      {chosen && chosen !== "USD" && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 pt-3">
          <label htmlFor={rateId} className="min-w-48 flex-1 font-semibold">
            {t("prefs.currencyRate", { code: chosen })}
          </label>
          <div className="field w-36">
            <input
              id={rateId}
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              disabled={!editable}
              value={text ?? (shown !== undefined ? sig(shown) : "")}
              onChange={(e) => {
                setText(e.target.value);
                commit(e.target.value);
              }}
              onBlur={() => setText(null)}
              className="text-end"
            />
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 text-sm text-slate-500">
            <span>
              {state.worldBank
                ? t("prefs.currencyWorldBank", {
                    year: state.worldBank.year,
                    value: sig(state.worldBank.value),
                  })
                : state.status === "loading"
                  ? t("common.loading")
                  : own === undefined
                    ? t("prefs.currencyMissing", { code: chosen })
                    : ""}
            </span>
            {editable && own !== undefined && (
              <button
                type="button"
                className="min-h-10 text-blue-700 underline"
                onClick={() => {
                  setText(null);
                  onPreferences(withPref(preferences, RATE_PREF, null));
                }}
              >
                {t("prefs.currencyReset")}
              </button>
            )}
          </div>
        </div>
      )}
      {chosen && <p className="mt-3 text-sm text-slate-500">{t("prefs.currencyHow")}</p>}
      {!editable && <p className="mt-3 text-sm text-slate-500">{t("prefs.readOnly")}</p>}
    </section>
  );
}
