import { type FormEvent, useId, useState } from "react";
import { useI18n } from "../i18n/i18n";
import type { MessageKey } from "../i18n/messages";
import type { SavedDepot } from "../features/depots/types";
import { railVehicles, streetVehicles } from "../features/fleet/registry";
import {
  duplicateNumbers,
  type FleetDoc,
  type FleetUnit,
  MAX_UNITS,
  OWN_MODES,
  UNIT_STATUSES,
  type UnitStatus,
  withNewUnits,
  withoutUnits,
  withUnit,
} from "../features/fleet/model";
import { modeLabel } from "./OwnVehicles";
import { type PreferencesDoc, vehiclesOffFrom } from "./preferences";

/** Fleet vehicles shown at once; the type filter narrows a longer list. */
const SHOWN = 300;
/** Project mode ids that the catalogue knows by another id. */
const CATALOGUE_MODE_OF: Record<string, string> = { intercity_rail: "long_distance_rail" };

interface Choice {
  id: string;
  name: string;
  mode: string;
}

/** Purpose: the vehicles a fleet vehicle can be, by mode: those the project uses, plus any the fleet has. */
function choices(off: ReadonlySet<string>, fleet: FleetDoc, projectModes: readonly string[]) {
  const all: Choice[] = [...streetVehicles(), ...railVehicles()];
  const inFleet = new Set(fleet.units.map((u) => u.vehicle));
  const own = new Set(fleet.vehicles.map((v) => v.id));
  const modes = new Set(projectModes.map((m) => CATALOGUE_MODE_OF[m] ?? m));
  const pick = (v: Choice) => inFleet.has(v.id) || own.has(v.id) || (!off.has(v.id) && modes.has(v.mode));
  let list = all.filter(pick);
  if (!list.length) list = all.filter((v) => !off.has(v.id));
  return OWN_MODES.map((m) => ({ mode: m, vehicles: list.filter((v) => v.mode === m) })).filter(
    (g) => g.vehicles.length,
  );
}

/**
 * Purpose: the project's fleet (Project preferences): its individual vehicles, each of a catalogue or own
 * type, with a fleet number, a home depot, the year it entered service and its status. Vehicles are added
 * several at a time, numbered up from a first fleet number.
 */
export function FleetSection({
  fleet,
  preferences,
  projectModes,
  depots,
  editable,
  onFleet,
}: {
  fleet: FleetDoc;
  preferences: PreferencesDoc | null;
  projectModes: readonly string[];
  depots: readonly SavedDepot[];
  editable: boolean;
  onFleet: (doc: FleetDoc) => void;
}) {
  const { t } = useI18n();
  const base = useId();
  const groups = choices(vehiclesOffFrom(preferences), fleet, projectModes);
  const byId = new Map(groups.flatMap((g) => g.vehicles.map((v) => [v.id, v] as const)));
  const nameOf = (id: string) => byId.get(id)?.name ?? t("fleet.unknownVehicle");
  const depotsFor = (vehicle: string) => {
    const mode = byId.get(vehicle)?.mode;
    return depots.filter((d) => mode && (d.modes as string[]).includes(mode));
  };
  const [filter, setFilter] = useState<string>("");
  const dup = duplicateNumbers(fleet);
  const shown = fleet.units.filter((u) => !filter || u.vehicle === filter);
  const types = [...new Set(fleet.units.map((u) => u.vehicle))];
  const label = "mb-1 block text-sm font-semibold";
  return (
    <section
      aria-labelledby="pp-fleet"
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 md:p-6"
    >
      <h2 id="pp-fleet" className="caps m-0">
        {t("fleet.title")}
      </h2>
      <p className="mt-1 text-sm text-slate-600">{t("fleet.intro")}</p>
      {editable && fleet.units.length < MAX_UNITS && (
        <AddUnits groups={groups} depotsFor={depotsFor} onAdd={(a) => onFleet(withNewUnits(fleet, a))} />
      )}
      {fleet.units.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{t("fleet.none")}</p>
      ) : (
        <>
          <h3 className="mt-5 mb-1 text-base font-semibold">{t("fleet.summary")}</h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
            {types.map((id) => {
              const of = fleet.units.filter((u) => u.vehicle === id);
              const parts = UNIT_STATUSES.map((s) => [s, of.filter((u) => u.status === s).length] as const)
                .filter(([, n]) => n > 0)
                .map(([s, n]) => `${n} ${t(`fleet.status.${s}` as MessageKey)}`);
              return (
                <li key={id}>
                  <span className="font-semibold">{nameOf(id)}</span>:{" "}
                  {t("fleet.count", { count: of.length })} ({parts.join(", ")})
                </li>
              );
            })}
          </ul>
          <div className="mt-4">
            <label className={label} htmlFor={`${base}-filter`}>
              {t("fleet.filter")}
            </label>
            <div className="field">
              <select id={`${base}-filter`} value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="">{t("fleet.filterAll", { count: fleet.units.length })}</option>
                {types.map((id) => (
                  <option key={id} value={id}>
                    {nameOf(id)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {dup.size > 0 && (
            <p role="alert" className="mt-3 text-sm text-amber-800">
              {t("fleet.duplicate", { numbers: [...dup].slice(0, 10).join(", ") })}
            </p>
          )}
          <ul className="mt-2 flex list-none flex-col p-0" aria-label={t("fleet.title")}>
            {shown.slice(0, SHOWN).map((u) => (
              <UnitRow
                key={u.id}
                unit={u}
                vehicleName={nameOf(u.vehicle)}
                depots={depotsFor(u.vehicle)}
                editable={editable}
                duplicate={dup.has(u.number)}
                onChange={(c) => onFleet(withUnit(fleet, u.id, c))}
                onDelete={() => onFleet(withoutUnits(fleet, [u.id]))}
              />
            ))}
          </ul>
          {shown.length > SHOWN && (
            <p className="mt-2 text-sm text-slate-500">
              {t("fleet.more", { shown: SHOWN, total: shown.length })}
            </p>
          )}
          {editable && filter && (
            <button
              type="button"
              className="btn btn-ghost mt-2 min-h-9"
              onClick={() => {
                if (
                  window.confirm(t("fleet.deleteTypeConfirm", { count: shown.length, name: nameOf(filter) }))
                )
                  onFleet(
                    withoutUnits(
                      fleet,
                      shown.map((u) => u.id),
                    ),
                  );
              }}
            >
              {t("fleet.deleteType")}
            </button>
          )}
        </>
      )}
      {!editable && <p className="mt-3 text-sm text-slate-500">{t("prefs.readOnly")}</p>}
    </section>
  );
}

/** Purpose: the form that adds fleet vehicles of one type. */
function AddUnits({
  groups,
  depotsFor,
  onAdd,
}: {
  groups: { mode: string; vehicles: Choice[] }[];
  depotsFor: (vehicle: string) => SavedDepot[];
  onAdd: (a: {
    vehicle: string;
    count: number;
    first: string;
    depot: string | null;
    year: number | null;
    status: UnitStatus;
  }) => void;
}) {
  const { t } = useI18n();
  const base = useId();
  const [vehicle, setVehicle] = useState(groups[0]?.vehicles[0]?.id ?? "");
  const [count, setCount] = useState("1");
  const [first, setFirst] = useState("101");
  const [depot, setDepot] = useState("");
  const [year, setYear] = useState("");
  const [status, setStatus] = useState<UnitStatus>("active");
  const [error, setError] = useState<MessageKey | null>(null);
  const depots = depotsFor(vehicle);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(count);
    const y = year.trim() ? Number(year) : null;
    if (!vehicle) return setError("fleet.err.vehicle");
    if (!Number.isInteger(n) || n < 1 || n > 500) return setError("fleet.err.count");
    if (!first.trim()) return setError("fleet.err.number");
    if (y !== null && (!Number.isInteger(y) || y < 1850 || y > 2100)) return setError("fleet.err.year");
    setError(null);
    onAdd({
      vehicle,
      count: n,
      first,
      depot: depots.some((d) => d.id === depot) ? depot : null,
      year: y,
      status,
    });
  };
  const label = "mb-1 block text-sm font-semibold";
  return (
    <form
      onSubmit={submit}
      aria-label={t("fleet.addTitle")}
      className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 md:p-4"
    >
      <h3 className="m-0 text-base font-semibold">{t("fleet.addTitle")}</h3>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={label} htmlFor={`${base}-vehicle`}>
            {t("fleet.vehicle")}
          </label>
          <div className="field">
            <select id={`${base}-vehicle`} value={vehicle} onChange={(e) => setVehicle(e.target.value)}>
              {groups.map((g) => (
                <optgroup key={g.mode} label={t(modeLabel(g.mode))}>
                  {g.vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className={label} htmlFor={`${base}-count`}>
            {t("fleet.howMany")}
          </label>
          <div className="field">
            <input
              id={`${base}-count`}
              inputMode="numeric"
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className={label} htmlFor={`${base}-first`}>
            {t("fleet.firstNumber")}
          </label>
          <div className="field">
            <input
              id={`${base}-first`}
              maxLength={40}
              value={first}
              onChange={(e) => setFirst(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className={label} htmlFor={`${base}-depot`}>
            {t("fleet.depot")}
          </label>
          <div className="field">
            <select
              id={`${base}-depot`}
              value={depot}
              disabled={!depots.length}
              onChange={(e) => setDepot(e.target.value)}
            >
              <option value="">{t(depots.length ? "fleet.noDepot" : "fleet.noDepotFits")}</option>
              {depots.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className={label} htmlFor={`${base}-year`}>
            {t("fleet.year")}
          </label>
          <div className="field">
            <input
              id={`${base}-year`}
              inputMode="numeric"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className={label} htmlFor={`${base}-status`}>
            {t("fleet.statusLabel")}
          </label>
          <div className="field">
            <select
              id={`${base}-status`}
              value={status}
              onChange={(e) => setStatus(e.target.value as UnitStatus)}
            >
              {UNIT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`fleet.status.${s}` as MessageKey)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-800">
          {t(error)}
        </p>
      )}
      <button type="submit" className="btn btn-pri mt-3 min-h-10">
        {t("fleet.add")}
      </button>
    </form>
  );
}

/** Purpose: one fleet vehicle: its number, type, home depot, year and status, editable in place. */
function UnitRow({
  unit,
  vehicleName,
  depots,
  editable,
  duplicate,
  onChange,
  onDelete,
}: {
  unit: FleetUnit;
  vehicleName: string;
  depots: SavedDepot[];
  editable: boolean;
  duplicate: boolean;
  onChange: (c: Partial<Omit<FleetUnit, "id">>) => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const [number, setNumber] = useState(unit.number);
  const [year, setYear] = useState(unit.year === null ? "" : String(unit.year));
  const commitYear = () => {
    const y = year.trim() ? Number(year) : null;
    if (y === null || (Number.isInteger(y) && y >= 1850 && y <= 2100)) onChange({ year: y });
    else setYear(unit.year === null ? "" : String(unit.year));
  };
  const small = "rounded-lg border border-slate-300 px-2 py-1.5 text-sm";
  return (
    <li className="flex flex-wrap items-center gap-2 border-t border-slate-100 py-2 first:border-t-0">
      <input
        aria-label={t("fleet.number")}
        className={`${small} w-24 ${duplicate ? "border-amber-500" : ""}`}
        maxLength={40}
        disabled={!editable}
        value={number}
        onChange={(e) => setNumber(e.target.value)}
        onBlur={() => number.trim() && number !== unit.number && onChange({ number: number.trim() })}
      />
      <span className="min-w-0 flex-1 basis-40 text-sm">{vehicleName}</span>
      <select
        aria-label={t("fleet.depot")}
        className={small}
        disabled={!editable || !depots.length}
        value={unit.depot ?? ""}
        onChange={(e) => onChange({ depot: e.target.value || null })}
      >
        <option value="">{t("fleet.noDepot")}</option>
        {depots.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
        {unit.depot && !depots.some((d) => d.id === unit.depot) && (
          <option value={unit.depot}>{t("fleet.depotGone")}</option>
        )}
      </select>
      <input
        aria-label={t("fleet.year")}
        className={`${small} w-20`}
        inputMode="numeric"
        disabled={!editable}
        value={year}
        onChange={(e) => setYear(e.target.value)}
        onBlur={commitYear}
      />
      <select
        aria-label={t("fleet.statusLabel")}
        className={small}
        disabled={!editable}
        value={unit.status}
        onChange={(e) => onChange({ status: e.target.value as UnitStatus })}
      >
        {UNIT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {t(`fleet.status.${s}` as MessageKey)}
          </option>
        ))}
      </select>
      {editable && (
        <button
          type="button"
          className="btn btn-ghost min-h-9"
          aria-label={t("fleet.deleteUnit", { number: unit.number })}
          onClick={onDelete}
        >
          ✕
        </button>
      )}
    </li>
  );
}
