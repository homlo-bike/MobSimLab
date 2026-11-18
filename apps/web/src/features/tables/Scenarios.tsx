import { useEffect, useMemo, useState } from "react";
import { inputKey } from "../../projects/inputKey";
import { type ResultsApi, useLiveResult } from "../../projects/results";
import { card, fmtMoney, fmtQty, num, td, th } from "../costs/CostTables";
import type { Network, RailEngineLoader } from "../railways/types";
import type { StreetLinesDoc } from "../street-lines/saved";
import type { PreferencesDoc } from "../../workspace/preferences";
import { convertTo, type ProjectCurrency } from "../costs/currency";
import { buildRailway } from "./railBuild";
import { type Translate, useI18n } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/messages";
import {
  type Figures,
  figures,
  MAX_SCENARIOS,
  type Scenario,
  type ScenariosDoc,
  withoutScenario,
  withScenario,
} from "./scenarioModel";

interface Props {
  railway: Network | null;
  streetLines: StreetLinesDoc | null;
  preferences: PreferencesDoc | null;
  doc: ScenariosDoc | null;
  /** Saves the scenarios; absent when the planner may only view the project. */
  onChange?: (doc: ScenariosDoc) => void;
  /** The project's currency (Project preferences); null keeps US dollars. */
  currency?: ProjectCurrency | null;
  /** Tests inject this. */
  loadRail?: RailEngineLoader;
  /** The project's saved results: the figures of the saved scenarios. */
  results?: ResultsApi | null;
  /** The planner may replace the saved results (Owners and Editors). */
  canSave?: boolean;
}

const int = (v: number) => new Intl.NumberFormat("en").format(Math.round(v));
const km = (v: number, _m: unknown, t: Translate) => t("tbl.u.km", { v: fmtQty(v) });
const money = (v: number, m: (v: number) => string) => m(v);

/** Rows of the comparison: label, value and format (money rows get the project's money format). */
const ROWS: {
  label: MessageKey;
  key: keyof Figures;
  fmt: (v: number, money: (v: number) => string, t: Translate) => string;
}[] = [
  { label: "tbl.lines", key: "lines", fmt: int },
  { label: "scn.row.railKm", key: "railKm", fmt: km },
  { label: "scn.row.trackKm", key: "trackKm", fmt: km },
  { label: "scn.row.streetKm", key: "streetKm", fmt: km },
  { label: "scn.row.stations", key: "stations", fmt: int },
  { label: "scn.row.stops", key: "stops", fmt: int },
  { label: "tbl.inTunnel", key: "tunnelKm", fmt: km },
  { label: "tbl.onBridges", key: "bridgeKm", fmt: km },
  { label: "tbl.fleetSpares", key: "fleet", fmt: int },
  { label: "scn.row.inService", key: "inService", fmt: int },
  { label: "tbl.vehicleKmYear", key: "kmPerYear", fmt: int },
  { label: "scn.row.capacity", key: "capacityPerHour", fmt: int },
  { label: "scn.row.construction", key: "construction", fmt: money },
  { label: "scn.row.operating", key: "operating", fmt: money },
];

/** Purpose: a scenario's difference from the current design, as "+12 %" or "new" (in the language). */
function change(v: number, base: number, t: Translate): string | null {
  if (Math.abs(v - base) < 1e-9) return null;
  if (base === 0) return t("scn.new");
  const p = ((v - base) / Math.abs(base)) * 100;
  return `${p > 0 ? "+" : "−"}${fmtQty(Math.abs(p))} %`;
}

/**
 * Purpose: figures of a design: its railway built by the engine (when it has track), then the comparison
 * figures. Side effects: loads the rail engine.
 */
async function measure(
  railway: Network | null,
  streetLines: StreetLinesDoc | null,
  prefs: Record<string, number> | undefined,
  loadRail?: RailEngineLoader,
): Promise<Figures> {
  const rail = railway?.tracks.length ? await buildRailway(railway, loadRail) : null;
  return figures(railway, rail, streetLines, prefs);
}

/**
 * The scenario comparison of the Tables tab: save the current design under a name, and compare the saved
 * copies with the current design side by side, in the chosen language.
 * Side effects: builds every railway with the rail engine; saves through `onChange`.
 */
export function Scenarios({
  railway,
  streetLines,
  preferences,
  doc,
  onChange,
  currency = null,
  loadRail,
  results = null,
  canSave = false,
}: Props) {
  const { t, language } = useI18n();
  const prefs = preferences?.values;
  // US dollars of the library's price base, in the project's currency at the exchange rate.
  const conv = convertTo(currency, "USD", 1);
  const fmtCost = (v: number) => fmtMoney(v * conv.rate, conv.currency);
  const list = doc?.scenarios ?? [];
  const [name, setName] = useState("");
  const [current, setCurrent] = useState<Figures | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentKey = JSON.stringify([railway, streetLines, prefs]);
  useEffect(() => {
    let live = true;
    measure(railway, streetLines, prefs, loadRail).then(
      (f) => live && setCurrent(f),
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [currentKey, loadRail]);

  // The figures of the saved scenarios (every railway built by the engine) are saved with the project and
  // worked out again when the scenarios or the preferences change.
  const savedKey = JSON.stringify([list.map((s) => s.id), prefs]);
  const savedInputs = useMemo(
    () => (list.length ? inputKey({ scenarios: list, prefs: prefs ?? null }) : null),
    // The scenario ids and the preferences stand for the scenarios: a scenario is never edited, only replaced.
    [savedKey],
  );
  const measured = useLiveResult<Record<string, Figures>>(
    results,
    "scenario-measures",
    savedInputs,
    canSave,
    async () => {
      const out: Record<string, Figures> = {};
      for (const s of list) out[s.id] = await measure(s.railway, s.streetLines, prefs, loadRail);
      return out;
    },
  );
  const saved = measured.value ?? {};
  const shownError = error ?? measured.error;

  const full = list.length >= MAX_SCENARIOS;
  const save = () => {
    if (!onChange || !name.trim() || full) return;
    onChange(withScenario(doc, name, railway, streetLines));
    setName("");
  };
  const remove = (s: Scenario) => {
    if (!onChange) return;
    if (!window.confirm(t("scn.confirmDelete", { name: s.name }))) return;
    onChange(withoutScenario(doc, s.id));
  };

  return (
    <section aria-labelledby="compare-title" className="mt-10">
      <h2 id="compare-title" className="text-xl font-semibold tracking-tight">
        {t("scn.title")}
      </h2>
      <p className="mt-1 max-w-3xl text-slate-600">{t("scn.intro")}</p>
      {onChange && (
        <form
          className="mt-4 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm sm:max-w-xs">
            <span className="font-medium text-slate-700">{t("scn.name")}</span>
            <input
              className="rounded-lg border border-slate-300 bg-white px-3 py-2"
              value={name}
              maxLength={120}
              placeholder={t("scn.placeholder")}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button type="submit" className="btn btn-pri min-h-10" disabled={!name.trim() || full}>
            {t("scn.save")}
          </button>
          {full && <span className="text-sm text-slate-600">{t("scn.full", { max: MAX_SCENARIOS })}</span>}
        </form>
      )}
      {shownError && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {t("scn.error", { error: shownError })}
        </p>
      )}
      {list.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-5 text-slate-600">
          {t("scn.none")}
        </p>
      ) : (
        <section className={card} aria-label={t("scn.aria")}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: `${16 + 9 * (list.length + 1)}rem` }}>
              <thead>
                <tr className="border-b border-slate-200 align-bottom">
                  <th className={th}>{t("scn.figure")}</th>
                  <th className={`${th} text-right`}>{t("scn.current")}</th>
                  {list.map((s) => (
                    <th key={s.id} className={`${th} text-right`}>
                      <span className="block text-slate-900">{s.name}</span>
                      <span className="block text-xs font-normal text-slate-500">
                        {t("scn.saved", {
                          date: new Date(s.savedAt).toLocaleDateString(language, {
                            dateStyle: "medium",
                            numberingSystem: "latn",
                          }),
                        })}
                      </span>
                      {onChange && (
                        <button
                          type="button"
                          className="mt-1 text-xs font-normal text-red-700 hover:underline"
                          aria-label={t("scn.deleteName", { name: s.name })}
                          onClick={() => remove(s)}
                        >
                          {t("scn.delete")}
                        </button>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr key={row.key} className="border-b border-slate-100">
                    <th scope="row" className={`${td} text-left font-normal`}>
                      {t(row.label)}
                    </th>
                    <td className={`${num} font-medium`}>
                      {current ? row.fmt(current[row.key], fmtCost, t) : "…"}
                    </td>
                    {list.map((s) => {
                      const f = saved[s.id];
                      const d = f && current ? change(f[row.key], current[row.key], t) : null;
                      return (
                        <td key={s.id} className={num}>
                          {f ? row.fmt(f[row.key], fmtCost, t) : "…"}
                          {d && (
                            <span className="block text-xs text-slate-500">
                              {t("scn.vsCurrent", { change: d })}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            {conv.currency === "USD"
              ? t("scn.note.usd")
              : t("scn.note.converted", {
                  currency: conv.currency ?? "",
                  rate: String(Number(conv.rate.toPrecision(4))),
                })}
          </p>
        </section>
      )}
    </section>
  );
}
