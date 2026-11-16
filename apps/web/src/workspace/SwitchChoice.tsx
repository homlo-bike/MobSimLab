import { useId, useState } from "react";
import { useI18n } from "../i18n/i18n";
import { RAIL_MODES } from "../features/railways/modes";
import {
  CATALOGUE_SWITCHES,
  type CatalogueSwitch,
  LIBRARY_DEFAULT_TURNOUT,
  type PreferencesDoc,
  switchChoiceFrom,
  withDefaultTurnout,
  withSwitches,
} from "./preferences";

/** Project mode ids that the railway design tool knows by another id. */
const RAIL_MODE_OF: Record<string, string> = { intercity_rail: "long_distance_rail" };

const num = (v: number) => String(Number(v.toFixed(2)));

/**
 * Purpose: the default turnout the railway editor uses for a mode, as the rail engine picks it: the
 * project's when it uses it, else the library's when it uses it, else its first turnout in use.
 */
export function effectiveDefault(
  mode: string,
  turnouts: readonly CatalogueSwitch[],
  off: ReadonlySet<string>,
  own: string | undefined,
): string | null {
  const used = turnouts.filter((s) => !off.has(s.id)).map((s) => s.id);
  const lib = LIBRARY_DEFAULT_TURNOUT[mode];
  if (own && used.includes(own)) return own;
  if (lib && used.includes(lib)) return lib;
  return used[0] ?? null;
}

/**
 * Purpose: which turnouts and slips of the switches and crossings catalogue the railway editor offers per
 * rail mode, and the turnout new switches start with. All are used until the planner leaves some out.
 */
export function SwitchChoiceSection({
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
  const choice = switchChoiceFrom(preferences);
  const off = new Set(choice.off);
  const of = (m: string) => CATALOGUE_SWITCHES.filter((s) => s.typical_modes.includes(m));
  // Turnouts smallest radius first, as the railway editor lists them.
  const turnouts = of(mode)
    .filter((s) => s.element === "turnout")
    .sort((a, b) => (a.radius_m ?? 0) - (b.radius_m ?? 0));
  const slips = of(mode).filter((s) => s.element !== "turnout");
  const def = effectiveDefault(mode, turnouts, off, choice.default_turnout[mode]);
  const usedOf = (m: string) => of(m).filter((s) => !off.has(s.id)).length;
  const all = of(mode).map((s) => s.id);
  const facts = (s: CatalogueSwitch) =>
    t("prefs.switchesFacts", {
      n: s.crossing_ratio_n !== null ? num(s.crossing_ratio_n) : "–",
      radius: s.radius_m !== null ? num(s.radius_m) : "–",
      speed: s.diverging_speed_kmh ?? "–",
    });
  const row = (s: CatalogueSwitch, isTurnout: boolean) => {
    const on = !off.has(s.id);
    const isDefault = isTurnout && s.id === def;
    return (
      <li key={s.id} className="border-t border-slate-100 first:border-t-0">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5">
          <label className="flex min-h-11 min-w-0 flex-1 items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 size-4 shrink-0"
              checked={on}
              // The default turnout stays in use: choose another default first.
              disabled={!editable || isDefault}
              onChange={(e) => onPreferences(withSwitches(preferences, [s.id], e.target.checked))}
            />
            <span className="min-w-0">
              <span className="block font-semibold">{s.label}</span>
              <span className="block text-sm text-slate-500">{facts(s)}</span>
            </span>
          </label>
          {isTurnout && (
            <label className="flex min-h-11 items-center gap-2 text-sm text-slate-600">
              <input
                type="radio"
                name={`${modeId}-default`}
                className="size-4"
                checked={isDefault}
                disabled={!editable || !on}
                onChange={() => onPreferences(withDefaultTurnout(preferences, mode, s.id))}
              />
              {t("prefs.switchesDefault")}
            </label>
          )}
        </div>
      </li>
    );
  };
  return (
    <section
      aria-labelledby="pp-switches"
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 md:p-6"
    >
      <h2 id="pp-switches" className="caps m-0">
        {t("prefs.switchesTitle")}
      </h2>
      <p className="mt-1 text-sm text-slate-600">{t("prefs.switchesIntro")}</p>
      <label className="mt-4 mb-1.5 block font-semibold" htmlFor={modeId}>
        {t("prefs.rulesMode")}
      </label>
      <div className="field">
        <select id={modeId} value={mode} onChange={(e) => setMode(e.target.value)}>
          {RAIL_MODES.map((r) => (
            <option key={r.id} value={r.id}>
              {t(r.label)} · {t("prefs.vehiclesUsed", { used: usedOf(r.id), total: of(r.id).length })}
            </option>
          ))}
        </select>
      </div>
      {editable && (
        <div className="mt-3">
          <button
            type="button"
            className="btn min-h-10"
            disabled={all.every((id) => !off.has(id)) && !choice.default_turnout[mode]}
            onClick={() =>
              onPreferences(withDefaultTurnout(withSwitches(preferences, all, true), mode, null))
            }
          >
            {t("prefs.vehiclesAll")}
          </button>
        </div>
      )}
      <h3 className="mt-4 mb-0 text-sm font-semibold text-slate-700">{t("prefs.switchesTurnouts")}</h3>
      <ul className="m-0 flex list-none flex-col p-0">{turnouts.map((s) => row(s, true))}</ul>
      {slips.length > 0 && (
        <>
          <h3 className="mt-4 mb-0 text-sm font-semibold text-slate-700">{t("prefs.switchesSlips")}</h3>
          <ul className="m-0 flex list-none flex-col p-0">{slips.map((s) => row(s, false))}</ul>
        </>
      )}
      {editable && <p className="mt-2 text-sm text-slate-500">{t("prefs.switchesLast")}</p>}
      {!editable && <p className="mt-3 text-sm text-slate-500">{t("prefs.readOnly")}</p>}
    </section>
  );
}
