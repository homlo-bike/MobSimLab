import { useEffect, useState } from "react";
import { card, fmtMoney, fmtQty, num, td, th } from "../costs/CostTables";
import type { Network, RailEngineLoader } from "../railways/types";
import type { StreetLinesDoc } from "../street-lines/saved";
import type { PreferencesDoc } from "../../workspace/preferences";
import { buildRailway } from "./railBuild";
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
  /** Tests inject this. */
  loadRail?: RailEngineLoader;
}

const int = (v: number) => new Intl.NumberFormat("en").format(Math.round(v));
const km = (v: number) => `${fmtQty(v)} km`;
const usd = (v: number) => fmtMoney(v, "USD");

/** Rows of the comparison: label, value and format. */
const ROWS: { label: string; key: keyof Figures; fmt: (v: number) => string }[] = [
  { label: "Lines", key: "lines", fmt: int },
  { label: "Railway route length", key: "railKm", fmt: km },
  { label: "Railway track length", key: "trackKm", fmt: km },
  { label: "Street line route length", key: "streetKm", fmt: km },
  { label: "Stations", key: "stations", fmt: int },
  { label: "Street stops", key: "stops", fmt: int },
  { label: "In tunnel", key: "tunnelKm", fmt: km },
  { label: "On bridges and viaducts", key: "bridgeKm", fmt: km },
  { label: "Fleet with spares", key: "fleet", fmt: int },
  { label: "In service at the peak", key: "inService", fmt: int },
  { label: "Vehicle-km a year", key: "kmPerYear", fmt: int },
  { label: "Peak capacity, places an hour", key: "capacityPerHour", fmt: int },
  { label: "Construction (medium)", key: "construction", fmt: usd },
  { label: "Operating a year (medium)", key: "operating", fmt: usd },
];

/** Purpose: a scenario's difference from the current design, as "+12 %" or "new". */
function change(v: number, base: number): string | null {
  if (Math.abs(v - base) < 1e-9) return null;
  if (base === 0) return "new";
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
 * copies with the current design side by side. In English for now, like the other tables.
 * Side effects: builds every railway with the rail engine; saves through `onChange`.
 */
export function Scenarios({ railway, streetLines, preferences, doc, onChange, loadRail }: Props) {
  const prefs = preferences?.values;
  const list = doc?.scenarios ?? [];
  const [name, setName] = useState("");
  const [current, setCurrent] = useState<Figures | null>(null);
  const [saved, setSaved] = useState<Record<string, Figures>>({});
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

  const savedKey = JSON.stringify([list.map((s) => s.id), prefs]);
  useEffect(() => {
    let live = true;
    (async () => {
      const out: Record<string, Figures> = {};
      for (const s of list) out[s.id] = await measure(s.railway, s.streetLines, prefs, loadRail);
      if (live) setSaved(out);
    })().catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [savedKey, loadRail]);

  const full = list.length >= MAX_SCENARIOS;
  const save = () => {
    if (!onChange || !name.trim() || full) return;
    onChange(withScenario(doc, name, railway, streetLines));
    setName("");
  };
  const remove = (s: Scenario) => {
    if (!onChange) return;
    if (!window.confirm(`Delete the scenario "${s.name}"? This cannot be undone.`)) return;
    onChange(withoutScenario(doc, s.id));
  };

  return (
    <section aria-labelledby="compare-title" className="mt-10">
      <h2 id="compare-title" className="text-xl font-semibold tracking-tight">
        Compare scenarios
      </h2>
      <p className="mt-1 max-w-3xl text-slate-600">
        Save the current railway design and street lines as a scenario, change the design, and compare. Every
        scenario is measured with the project's current preferences.
      </p>
      {onChange && (
        <form
          className="mt-4 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm sm:max-w-xs">
            <span className="font-medium text-slate-700">Scenario name</span>
            <input
              className="rounded-lg border border-slate-300 bg-white px-3 py-2"
              value={name}
              maxLength={120}
              placeholder="For example: Metro to the harbour"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button type="submit" className="btn btn-pri min-h-10" disabled={!name.trim() || full}>
            Save current design
          </button>
          {full && (
            <span className="text-sm text-slate-600">
              A project keeps {MAX_SCENARIOS} scenarios. Delete one to save another.
            </span>
          )}
        </form>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          A design could not be measured: {error}
        </p>
      )}
      {list.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-5 text-slate-600">
          No scenarios saved yet.
        </p>
      ) : (
        <section className={card} aria-label="Scenarios side by side">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: `${16 + 9 * (list.length + 1)}rem` }}>
              <thead>
                <tr className="border-b border-slate-200 align-bottom">
                  <th className={th}>Figure</th>
                  <th className={`${th} text-right`}>Current design</th>
                  {list.map((s) => (
                    <th key={s.id} className={`${th} text-right`}>
                      <span className="block text-slate-900">{s.name}</span>
                      <span className="block text-xs font-normal text-slate-500">
                        saved {new Date(s.savedAt).toLocaleDateString("en", { dateStyle: "medium" })}
                      </span>
                      {onChange && (
                        <button
                          type="button"
                          className="mt-1 text-xs font-normal text-red-700 hover:underline"
                          aria-label={`Delete ${s.name}`}
                          onClick={() => remove(s)}
                        >
                          Delete
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
                      {row.label}
                    </th>
                    <td className={`${num} font-medium`}>{current ? row.fmt(current[row.key]) : "…"}</td>
                    {list.map((s) => {
                      const f = saved[s.id];
                      const d = f && current ? change(f[row.key], current[row.key]) : null;
                      return (
                        <td key={s.id} className={num}>
                          {f ? row.fmt(f[row.key]) : "…"}
                          {d && <span className="block text-xs text-slate-500">{d} vs current</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Costs are medium estimates in US dollars at the assumption library's price base, before the
            conversion to the project's country, so scenarios compare on equal terms; the cost tables above
            give the current design in the country's currency.
          </p>
        </section>
      )}
    </section>
  );
}
