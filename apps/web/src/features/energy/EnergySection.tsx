import { useEffect, useMemo, useState } from "react";
import { card, fmtQty, modeLabel, num, td, th, Tile } from "../costs/CostTables";
import { prefId } from "../costs/params";
import type { LineFact } from "../tables/lineFacts";
import { type PreferencesDoc, withPref } from "../../workspace/preferences";
import { loadWasmEnergy } from "./engine";
import { ELECTRIC_SHARE, energyValues, GRID, libraryRange, ownValue } from "./params";
import type { EnergyEngine, EnergyEngineLoader, EnergyEstimate, EnergyLineInput } from "./types";

/** Street modes whose fleet may be partly battery electric (`energy.electric_share` set per mode). */
const BUS_MODES = ["bus", "brt", "intercity_bus"];

const int = (v: number) => new Intl.NumberFormat("en").format(Math.round(v));
const compact = (v: number) =>
  new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v);
/** kWh as MWh or GWh. */
const energy = (kwh: number) => (kwh >= 1e6 ? `${fmtQty(kwh / 1e6)} GWh` : `${fmtQty(kwh / 1e3)} MWh`);
const tonnes = (kg: number) => `${fmtQty(kg / 1000)} t`;

/**
 * Purpose: the inputs of the energy calculation for the project's lines: each line's vehicle-km a year,
 * places per vehicle and its mode's `energy.*` values with the project's own values on top.
 */
export function energyInputs(
  facts: LineFact[],
  prefs: PreferencesDoc["values"] | undefined,
): EnergyLineInput[] {
  return facts.map((f) => ({
    id: f.id,
    name: f.name,
    mode: f.mode,
    vehicle_km: f.kmPerYear,
    places: f.placesPerVehicle,
    params: energyValues(f.mode, prefs),
  }));
}

/**
 * Purpose: the energy plugin's section of the Tables tab (calculation `energy_emissions`): electricity,
 * diesel and greenhouse gas emissions a year per line and for the network, from the same vehicle-km as
 * the service table and the cost tables, with the grid's emission intensity and the battery bus share as
 * project values. In English for now, like the other tables.
 * Side effects: loads the energy WebAssembly module; `onPreferences` saves the project's values.
 */
export function EnergySection({
  facts,
  preferences,
  onPreferences,
  loadEngine = loadWasmEnergy,
}: {
  facts: LineFact[];
  preferences: PreferencesDoc | null;
  onPreferences?: (d: PreferencesDoc) => void;
  loadEngine?: EnergyEngineLoader;
}) {
  const [engine, setEngine] = useState<EnergyEngine | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadEngine().then(
      (e) => alive && setEngine(e),
      (e) => alive && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      alive = false;
    };
  }, [loadEngine]);

  const prefs = preferences?.values;
  const inputs = useMemo(() => energyInputs(facts, prefs), [facts, prefs]);
  const result: EnergyEstimate | null = useMemo(() => {
    if (!engine) return null;
    try {
      return engine.estimate(inputs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [engine, inputs]);

  const set = (id: string, v: number | null) => onPreferences?.(withPref(preferences, id, v));
  const busModes = BUS_MODES.filter((m) => facts.some((f) => f.mode === m));
  const t = result?.total;
  const missing = [...new Set(result?.lines.flatMap((l) => l.missing) ?? [])];

  return (
    <section aria-labelledby="energy-title" className="mt-10">
      <h2 id="energy-title" className="text-xl font-semibold tracking-tight">
        Energy and emissions
      </h2>
      <p className="mt-1 max-w-3xl text-slate-600">
        Traction energy and greenhouse gas emissions a year, from each line's vehicle-km in the service table.
        Electricity is counted where it is bought (substation or charger), diesel well-to-wheel.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          The energy estimate did not run: {error}
        </p>
      )}
      <section className={card} aria-labelledby="energy-inputs">
        <h3 id="energy-inputs" className="caps m-0">
          Project values
        </h3>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-3">
          <ValueField
            label="Grid electricity, kg CO2e per kWh"
            id={GRID}
            step={0.01}
            max={2}
            library={libraryRange(GRID, "bus")?.central ?? 0}
            value={ownValue(GRID, "*", prefs)}
            onChange={onPreferences ? (v) => set(GRID, v) : undefined}
          />
          {busModes.map((m) => {
            const id = prefId(ELECTRIC_SHARE, m);
            const lib = libraryRange(ELECTRIC_SHARE, m)?.central ?? 0;
            const v = ownValue(ELECTRIC_SHARE, m, prefs);
            return (
              <ValueField
                key={m}
                label={`${modeLabel(m)}: battery electric, %`}
                id={id}
                step={5}
                max={100}
                library={lib * 100}
                value={v === undefined ? undefined : v * 100}
                onChange={
                  onPreferences ? (x) => set(id, x === null ? null : Math.min(100, x) / 100) : undefined
                }
              />
            );
          })}
        </div>
      </section>
      {facts.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-5 text-slate-600">
          No lines yet. Add a service line in the railway tool or draw a street line.
        </p>
      ) : !result || !t ? (
        !error && (
          <p role="status" className="mt-4 text-slate-500">
            Estimating energy…
          </p>
        )
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile
              title="Electricity a year"
              value={energy(t.electricity_kwh)}
              sub="at the substation or charger"
            />
            <Tile
              title="Diesel a year"
              value={`${compact(t.diesel_l)} L`}
              sub={`${energy(t.diesel_l * (inputs[0]?.params["energy.diesel_kwh_per_l"] ?? 10))} of fuel`}
            />
            <Tile
              title="Emissions a year"
              value={tonnes(t.co2e_kg)}
              sub={`CO2e: ${tonnes(t.co2e_electric_kg)} electricity, ${tonnes(t.co2e_diesel_kg)} diesel`}
            />
            <Tile
              title="Per place-km"
              value={t.place_km > 0 ? `${fmtQty((t.co2e_kg * 1000) / t.place_km)} g` : "—"}
              sub="CO2e for each place offered, every place filled"
            />
          </div>
          <section className={card} aria-label="Energy and emissions per line">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className={th}>Line</th>
                    <th className={`${th} text-right`}>Vehicle-km</th>
                    <th className={`${th} text-right`}>Electric</th>
                    <th className={`${th} text-right`}>Electricity</th>
                    <th className={`${th} text-right`}>Diesel</th>
                    <th className={`${th} text-right`}>CO2e</th>
                    <th className={`${th} text-right`}>Per vehicle-km</th>
                    <th className={`${th} text-right`}>Per place-km</th>
                  </tr>
                </thead>
                <tbody>
                  {result.lines.map((l) => (
                    <tr key={l.id} className="border-b border-slate-100">
                      <td className={`${td} min-w-[9rem]`}>
                        <span className="font-medium">{l.name}</span>
                        <span className="block text-xs text-slate-500">{modeLabel(l.mode)}</span>
                      </td>
                      <td className={num}>{int(l.vehicle_km)}</td>
                      <td className={num}>{`${int(l.electric_share * 100)} %`}</td>
                      <td className={num}>{energy(l.electricity_kwh)}</td>
                      <td className={num}>{`${int(l.diesel_l)} L`}</td>
                      <td className={num}>{tonnes(l.co2e_kg)}</td>
                      <td className={num}>
                        {`${int(l.g_per_vkm)} g`}
                        <span className="block text-xs text-slate-500">{`${fmtQty(l.kwh_per_vkm)} kWh`}</span>
                      </td>
                      <td className={num}>
                        {l.g_per_place_km === null ? "—" : `${fmtQty(l.g_per_place_km)} g`}
                      </td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className={td}>All lines</td>
                    <td className={num}>{int(t.vehicle_km)}</td>
                    <td className={num}>
                      {t.vehicle_km > 0
                        ? `${int(
                            (result.lines.reduce((s, l) => s + l.vehicle_km * l.electric_share, 0) /
                              t.vehicle_km) *
                              100,
                          )} %`
                        : "—"}
                    </td>
                    <td className={num}>{energy(t.electricity_kwh)}</td>
                    <td className={num}>{`${int(t.diesel_l)} L`}</td>
                    <td className={num}>{tonnes(t.co2e_kg)}</td>
                    <td className={num}>
                      {t.vehicle_km > 0 ? `${int((t.co2e_kg * 1000) / t.vehicle_km)} g` : "—"}
                    </td>
                    <td className={num}>
                      {t.place_km > 0 ? `${fmtQty((t.co2e_kg * 1000) / t.place_km)} g` : "—"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <ul className="mt-3 list-disc ps-5 text-xs text-slate-500">
              <li>
                Rail uses electricity per place-km times the train's places, since trains range from a short
                tram to a 16-car high-speed train; street modes use a value per vehicle-km. Battery buses add
                the charging loss.
              </li>
              <li>
                Diesel counts burning it (tank-to-wheel) and producing it (well-to-tank). Electricity counts
                generation at the grid's emission intensity; a line on green power sets a lower value.
              </li>
              <li>
                Values come from the energy plugin's assumption library (energy.*), all unverified first
                estimates; the simulation will replace the intensities with each line's own running.
              </li>
              {missing.length > 0 && <li>Missing values, counted as 0: {missing.join(", ")}.</li>}
            </ul>
          </section>
        </>
      )}
    </section>
  );
}

/**
 * Purpose: a project value with the library's value beside it and a way back to it. `value` undefined
 * means the library's applies; `onChange(null)` returns to it; without `onChange` it is read-only.
 */
function ValueField({
  label,
  id,
  library,
  value,
  step,
  max,
  onChange,
}: {
  label: string;
  id: string;
  library: number;
  value: number | undefined;
  step: number;
  max: number;
  onChange?: (v: number | null) => void;
}) {
  const shown = Math.round((value ?? library) * 1000) / 1000;
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="number"
          name={id}
          aria-label={label}
          min={0}
          max={max}
          step={step}
          disabled={!onChange}
          className="w-24 rounded-lg border border-slate-300 px-2 py-1.5"
          value={shown}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (!Number.isFinite(v) || v < 0) return;
            onChange?.(Math.abs(v - library) < 1e-9 ? null : v);
          }}
        />
        {value === undefined ? (
          <span className="text-xs text-slate-500">library value</span>
        ) : (
          onChange && (
            <button type="button" className="text-xs text-blue-700 underline" onClick={() => onChange(null)}>
              Use the library value ({Math.round(library * 1000) / 1000})
            </button>
          )
        )}
      </span>
    </label>
  );
}
