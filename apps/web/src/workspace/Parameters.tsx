import { useId, useState } from "react";
import { useI18n } from "../i18n/i18n";
import type { MessageKey } from "../i18n/messages";
import { RAIL_MODES } from "../features/railways/modes";
import { MODE_ORDER, MODES } from "../features/street-lines/modes";
import {
  choiceValue,
  LIBRARY_PARAMS,
  type LibraryParam,
  PARAM_GROUPS,
  paramLibrary,
  paramPrefId,
  type PreferencesDoc,
  prefValue,
  withChoice,
  withPref,
} from "./preferences";

/** The library's group names as message keys. */
const GROUP_LABEL: Record<string, MessageKey> = {
  Modes: "prefs.group.modes",
  Operations: "prefs.group.operations",
  Demand: "prefs.group.demand",
  Analysis: "prefs.group.analysis",
  Simulation: "prefs.group.simulation",
  "Infrastructure standards": "prefs.group.infrastructure",
  Accessibility: "prefs.group.accessibility",
  "Depots and streets": "prefs.group.depots",
  "Energy and climate": "prefs.group.energy",
  Cost: "prefs.group.cost",
  Benefits: "prefs.group.benefits",
  Fares: "prefs.group.fares",
  Noise: "prefs.group.noise",
};

const TRACTION_LABEL: Record<string, MessageKey> = {
  battery: "prefs.traction.battery",
  diesel: "prefs.traction.diesel",
  hydrogen: "prefs.traction.hydrogen",
  cng: "prefs.traction.cng",
  electric: "prefs.traction.electric",
};

/** The library's modes, street modes first, as the Create tab lists them. */
const MODE_CHOICES: { id: string; label: MessageKey }[] = [
  ...MODE_ORDER.filter((m) => ["bus", "brt", "trolleybus", "intercity_bus"].includes(m)).map((m) => ({
    id: m as string,
    label: MODES[m].label,
  })),
  ...RAIL_MODES.map((r) => ({ id: r.id as string, label: r.label })),
];

const num = (v: number) => String(Number(v.toPrecision(6)));
const HEX = /^#[0-9a-f]{6}$/i;

/** Purpose: whether the project changes any value of a parameter (any mode, any traction). */
function changedParam(p: LibraryParam, doc: PreferencesDoc | null): boolean {
  const own = (id: string) => id === p.id || id.startsWith(`${p.id}.`);
  return Object.keys(doc?.values ?? {}).some(own) || Object.keys(doc?.choices ?? {}).some(own);
}

/**
 * Purpose: every parameter of the assumption library, by group, with the library's value beside each and a way
 * back to it. A value can be set for every mode or for one mode; one for the mode wins.
 */
export function ParametersSection({
  preferences,
  editable,
  onPreferences,
}: {
  preferences: PreferencesDoc | null;
  editable: boolean;
  onPreferences: (doc: PreferencesDoc) => void;
}) {
  const { t } = useI18n();
  const groupId = useId();
  const modeId = useId();
  const [group, setGroup] = useState<string>(PARAM_GROUPS[0] ?? "Modes");
  const [mode, setMode] = useState<string>("*");
  const groupName = (g: string) => (GROUP_LABEL[g] ? t(GROUP_LABEL[g]) : g);
  const params = LIBRARY_PARAMS.filter((p) => p.group === group);
  return (
    <section
      aria-labelledby="pp-params"
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 md:p-6"
    >
      <h2 id="pp-params" className="caps m-0">
        {t("prefs.paramsTitle")}
      </h2>
      <p className="mt-1 text-sm text-slate-600">{t("prefs.paramsIntro")}</p>
      <div className="mt-2 flex flex-wrap gap-x-4">
        <div className="min-w-56 flex-1">
          <label className="mt-2 mb-1.5 block font-semibold" htmlFor={groupId}>
            {t("prefs.paramsGroup")}
          </label>
          <div className="field">
            <select id={groupId} value={group} onChange={(e) => setGroup(e.target.value)}>
              {PARAM_GROUPS.map((g) => {
                const n = LIBRARY_PARAMS.filter((p) => p.group === g && changedParam(p, preferences)).length;
                return (
                  <option key={g} value={g}>
                    {groupName(g)}
                    {n ? ` · ${t("prefs.rulesChanged", { count: n })}` : ""}
                  </option>
                );
              })}
            </select>
          </div>
        </div>
        <div className="min-w-56 flex-1">
          <label className="mt-2 mb-1.5 block font-semibold" htmlFor={modeId}>
            {t("prefs.paramsMode")}
          </label>
          <div className="field">
            <select id={modeId} value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="*">{t("prefs.paramsAllModes")}</option>
              {MODE_CHOICES.map((m) => (
                <option key={m.id} value={m.id}>
                  {t(m.label)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-col">
        {params.flatMap((p) => {
          const rows = [
            <ParamField
              key={`${mode}-${p.id}`}
              param={p}
              mode={mode}
              preferences={preferences}
              editable={editable}
              onPreferences={onPreferences}
            />,
          ];
          // Values for a traction are the same for every mode, so they show with "All modes".
          if (mode === "*")
            for (const tr of Object.keys(p.traction ?? {}))
              rows.push(
                <ParamField
                  key={`${p.id}-${tr}`}
                  param={p}
                  mode="*"
                  traction={tr}
                  preferences={preferences}
                  editable={editable}
                  onPreferences={onPreferences}
                />,
              );
          return rows;
        })}
      </div>
      {!editable && <p className="mt-3 text-sm text-slate-500">{t("prefs.readOnly")}</p>}
    </section>
  );
}

/**
 * Purpose: one parameter's value for a mode (or a traction), with the library's value beside it and a way back
 * to it. For one mode, a value the project set for every mode shows until the mode gets its own.
 */
function ParamField({
  param: p,
  mode,
  traction,
  preferences,
  editable,
  onPreferences,
}: {
  param: LibraryParam;
  mode: string;
  traction?: string;
  preferences: PreferencesDoc | null;
  editable: boolean;
  onPreferences: (doc: PreferencesDoc) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  // What the planner is typing; the saved value shows again once the field is left.
  const [text, setText] = useState<string | null>(null);
  const prefId = paramPrefId(p.id, mode, traction);
  const lib = paramLibrary(p, mode, traction);
  const isNumber = p.kind === "number" && Array.isArray(lib);
  const own = isNumber ? prefValue(preferences, prefId) : choiceValue(preferences, prefId);
  const allId = paramPrefId(p.id, "*");
  const fromAll =
    own === undefined && mode !== "*" && !traction
      ? isNumber
        ? prefValue(preferences, allId)
        : choiceValue(preferences, allId)
      : undefined;
  const label = traction
    ? `${p.label} · ${TRACTION_LABEL[traction] ? t(TRACTION_LABEL[traction]) : traction}`
    : p.label;
  const set = (v: number | string | null) =>
    onPreferences(
      typeof v === "string" || (v === null && !isNumber)
        ? withChoice(preferences, prefId, v as string | null)
        : withPref(preferences, prefId, v),
    );
  let input;
  let library: string;
  if (isNumber) {
    const [low, central, high] = lib;
    // Negative values only where the library has them (temperatures, for example).
    const min = Math.min(
      0,
      ...Object.values(p.values).flatMap((v) => (Array.isArray(v) ? [v[0]] : [])),
      ...Object.values(p.traction ?? {}).flatMap((v) => (Array.isArray(v) ? [v[0]] : [])),
    );
    const commit = (raw: string) => {
      const n = Number(raw.replace(",", "."));
      if (raw.trim() === "" || !Number.isFinite(n) || n < min) return;
      set(Math.abs(n - central) < 1e-9 && fromAll === undefined ? null : n);
    };
    const shown = (own ?? fromAll ?? central) as number;
    input = (
      <div className="flex items-center gap-1.5">
        <div className="field w-28">
          <input
            id={id}
            type="number"
            inputMode="decimal"
            min={min < 0 ? undefined : 0}
            step="any"
            disabled={!editable}
            value={text ?? num(shown)}
            onChange={(e) => {
              setText(e.target.value);
              commit(e.target.value);
            }}
            onBlur={() => setText(null)}
            className="text-end"
          />
        </div>
        <span className="w-16 text-sm text-slate-600">{p.unit}</span>
      </div>
    );
    library =
      low !== high
        ? t("prefs.rulesLibraryRange", { value: num(central), low: num(low), high: num(high), unit: p.unit })
        : t("prefs.rulesLibrary", { value: num(central), unit: p.unit });
  } else {
    const central = String(lib);
    const shown = (own ?? fromAll ?? central) as string;
    const choose = (v: string) => set(v === central && fromAll === undefined ? null : v);
    input =
      p.kind === "enum" ? (
        <div className="field w-56 max-w-full">
          <select id={id} disabled={!editable} value={shown} onChange={(e) => choose(e.target.value)}>
            {(p.options ?? [central]).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
      ) : HEX.test(central) ? (
        <input
          id={id}
          type="color"
          disabled={!editable}
          value={shown}
          onChange={(e) => choose(e.target.value.toUpperCase())}
          className="h-10 w-16 cursor-pointer rounded border border-slate-300 bg-white"
        />
      ) : (
        <div className="field w-56 max-w-full">
          <input
            id={id}
            disabled={!editable}
            value={text ?? shown}
            onChange={(e) => {
              setText(e.target.value);
              if (e.target.value.trim()) choose(e.target.value.trim());
            }}
            onBlur={() => setText(null)}
          />
        </div>
      );
    library = t("prefs.rulesLibrary", { value: central, unit: p.unit });
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 py-3 first:border-t-0">
      <label htmlFor={id} className="min-w-48 flex-1 font-semibold">
        {label}
      </label>
      {input}
      <div className="flex w-full flex-wrap items-center gap-x-2 text-sm text-slate-500">
        <span>{library}</span>
        {fromAll !== undefined && <span>· {t("prefs.paramsFromAll")}</span>}
        {editable && own !== undefined && (
          <button
            type="button"
            className="min-h-10 text-blue-700 underline"
            onClick={() => {
              setText(null);
              set(null);
            }}
          >
            {t("prefs.delayReset")}
          </button>
        )}
      </div>
    </div>
  );
}
