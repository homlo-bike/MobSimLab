import { useEffect, useMemo, useState } from "react";
import { card, fmtQty, num, td, th, Tile } from "../costs/CostTables";
import { useModeLabel } from "../schematic/common";
import { type Translate, useI18n } from "../../i18n/i18n";
import { prefId } from "../costs/params";
import type { LineFact } from "../tables/lineFacts";
import { type PreferencesDoc, withPref } from "../../workspace/preferences";
import { loadWasmEnergy } from "./engine";
import { ELECTRIC_SHARE, energyValues, GRID, libraryRange, ownValue } from "./params";
import type { EnergyEngine, EnergyEngineLoader, EnergyEstimate, EnergyLineInput } from "./types";
import { engineErrorText } from "../../i18n/engine";

/** Street modes whose fleet may be partly battery electric (`energy.electric_share` set per mode). */
const BUS_MODES = ["bus", "brt", "intercity_bus"];

const int = (v: number) => new Intl.NumberFormat("en").format(Math.round(v));
const compact = (v: number) =>
  new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v);
/** Purpose: kWh as MWh or GWh, in the language's unit format. */
const energyIn = (t: Translate) => (kwh: number) =>
  kwh >= 1e6 ? t("tbl.u.gwh", { v: fmtQty(kwh / 1e6) }) : t("tbl.u.mwh", { v: fmtQty(kwh / 1e3) });
/** Purpose: kg as tonnes, in the language's unit format. */
const tonnesIn = (t: Translate) => (kg: number) => t("tbl.u.t", { v: fmtQty(kg / 1000) });

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
 * project values, in the chosen language.
 * Side effects: loads the energy WebAssembly module; `onPreferences` saves the project's values.
 */
export function EnergySection({
  facts,
  preferences,
  onPreferences,
  loadEngine = loadWasmEnergy,
  onEstimate,
}: {
  facts: LineFact[];
  preferences: PreferencesDoc | null;
  onPreferences?: (d: PreferencesDoc) => void;
  loadEngine?: EnergyEngineLoader;
  /** Told each new estimate (the multi-year run takes the energy a year from it). */
  onEstimate?: (e: EnergyEstimate | null) => void;
}) {
  const { t: tr } = useI18n();
  const modeLabel = useModeLabel();
  const energy = energyIn(tr);
  const tonnes = tonnesIn(tr);
  const litres = (v: number | string) => tr("tbl.u.l", { v });
  const grams = (v: number | string) => tr("tbl.u.g", { v });
  const [engine, setEngine] = useState<EnergyEngine | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadEngine().then(
      (e) => alive && setEngine(e),
      (e) => alive && setError(engineErrorText(e)),
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
      setError(engineErrorText(e));
      return null;
    }
  }, [engine, inputs]);
  useEffect(() => onEstimate?.(result), [result, onEstimate]);

  const set = (id: string, v: number | null) => onPreferences?.(withPref(preferences, id, v));
  const busModes = BUS_MODES.filter((m) => facts.some((f) => f.mode === m));
  const t = result?.total;
  const missing = [...new Set(result?.lines.flatMap((l) => l.missing) ?? [])];

  return (
    <section aria-labelledby="energy-title" className="mt-10">
      <h2 id="energy-title" className="text-xl font-semibold tracking-tight">
        {tr("nrg.title")}
      </h2>
      <p className="mt-1 max-w-3xl text-slate-600">{tr("nrg.intro")}</p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {tr("nrg.error", { error })}
        </p>
      )}
      <section className={card} aria-labelledby="energy-inputs">
        <h3 id="energy-inputs" className="caps m-0">
          {tr("nrg.values")}
        </h3>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-3">
          <ValueField
            label={tr("nrg.grid")}
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
                label={tr("nrg.electricShare", { mode: modeLabel(m) })}
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
          {tr("tbl.noLines")}
        </p>
      ) : !result || !t ? (
        !error && (
          <p role="status" className="mt-4 text-slate-500">
            {tr("nrg.estimating")}
          </p>
        )
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile
              title={tr("nrg.electricityYear")}
              value={energy(t.electricity_kwh)}
              sub={tr("nrg.electricitySub")}
            />
            <Tile
              title={tr("nrg.dieselYear")}
              value={litres(compact(t.diesel_l))}
              sub={tr("nrg.dieselSub", {
                energy: energy(t.diesel_l * (inputs[0]?.params["energy.diesel_kwh_per_l"] ?? 10)),
              })}
            />
            <Tile
              title={tr("nrg.emissionsYear")}
              value={tonnes(t.co2e_kg)}
              sub={tr("nrg.emissionsSub", {
                electric: tonnes(t.co2e_electric_kg),
                diesel: tonnes(t.co2e_diesel_kg),
              })}
            />
            <Tile
              title={tr("nrg.perPlaceKm")}
              value={t.place_km > 0 ? grams(fmtQty((t.co2e_kg * 1000) / t.place_km)) : "—"}
              sub={tr("nrg.perPlaceKmSub")}
            />
          </div>
          <section className={card} aria-label={tr("nrg.aria")}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className={th}>{tr("tbl.line")}</th>
                    <th className={`${th} text-right`}>{tr("nrg.vehicleKm")}</th>
                    <th className={`${th} text-right`}>{tr("nrg.electric")}</th>
                    <th className={`${th} text-right`}>{tr("nrg.electricity")}</th>
                    <th className={`${th} text-right`}>{tr("nrg.diesel")}</th>
                    <th className={`${th} text-right`}>{tr("nrg.co2e")}</th>
                    <th className={`${th} text-right`}>{tr("nrg.perVehicleKm")}</th>
                    <th className={`${th} text-right`}>{tr("nrg.perPlaceKm")}</th>
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
                      <td className={num}>{litres(int(l.diesel_l))}</td>
                      <td className={num}>{tonnes(l.co2e_kg)}</td>
                      <td className={num}>
                        {grams(int(l.g_per_vkm))}
                        <span className="block text-xs text-slate-500">
                          {tr("tbl.u.kwh", { v: fmtQty(l.kwh_per_vkm) })}
                        </span>
                      </td>
                      <td className={num}>
                        {l.g_per_place_km === null ? "—" : grams(fmtQty(l.g_per_place_km))}
                      </td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className={td}>{tr("nrg.allLines")}</td>
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
                    <td className={num}>{litres(int(t.diesel_l))}</td>
                    <td className={num}>{tonnes(t.co2e_kg)}</td>
                    <td className={num}>
                      {t.vehicle_km > 0 ? grams(int((t.co2e_kg * 1000) / t.vehicle_km)) : "—"}
                    </td>
                    <td className={num}>
                      {t.place_km > 0 ? grams(fmtQty((t.co2e_kg * 1000) / t.place_km)) : "—"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <ul className="mt-3 list-disc ps-5 text-xs text-slate-500">
              <li>{tr("nrg.note.rail")}</li>
              <li>{tr("nrg.note.diesel")}</li>
              <li>{tr("nrg.note.library")}</li>
              {missing.length > 0 && <li>{tr("nrg.note.missing", { list: missing.join(", ") })}</li>}
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
  const { t } = useI18n();
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
          <span className="text-xs text-slate-500">{t("nrg.libraryValue")}</span>
        ) : (
          onChange && (
            <button type="button" className="text-xs text-blue-700 underline" onClick={() => onChange(null)}>
              {t("nrg.useLibrary", { value: Math.round(library * 1000) / 1000 })}
            </button>
          )
        )}
      </span>
    </label>
  );
}
