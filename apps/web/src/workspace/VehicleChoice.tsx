import { useId, useState } from "react";
import { useI18n } from "../i18n/i18n";
import type { MessageKey } from "../i18n/messages";
import { RAIL_MODES } from "../features/railways/modes";
import { TRAINS } from "../features/railways/trains";
import { MODE_ORDER, MODES } from "../features/street-lines/modes";
import { VEHICLES } from "../features/street-lines/vehicles";
import { type PreferencesDoc, vehiclesOffFrom, withVehicles } from "./preferences";

/** Project mode ids that the catalogue knows by another id. */
const CATALOGUE_MODE_OF: Record<string, string> = { intercity_rail: "long_distance_rail" };

interface Entry {
  id: string;
  name: string;
  length_m: number;
  capacity: number;
  top_speed_kmh: number;
}

/** Every mode with catalogue vehicles, in the Create tab's order, with its vehicles. */
const CATALOGUE: { mode: string; label: MessageKey; vehicles: Entry[] }[] = [
  ...MODE_ORDER.map((m) => ({
    mode: m as string,
    label: MODES[m].label,
    vehicles: VEHICLES.filter((v) => v.mode === m),
  })),
  ...RAIL_MODES.map((r) => ({
    mode: r.id as string,
    label: r.label,
    vehicles: TRAINS.filter((v) => v.mode === r.id),
  })),
].filter((g) => g.vehicles.length > 0);

/**
 * Purpose: which catalogue vehicles the project uses, per mode. The street line and railway tools offer only
 * those; all are used until the planner leaves some out, and at least one per mode stays in use.
 */
export function VehicleChoiceSection({
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
  const own = projectModes
    .map((m) => CATALOGUE_MODE_OF[m] ?? m)
    .filter((m) => CATALOGUE.some((g) => g.mode === m));
  const [mode, setMode] = useState<string>(own[0] ?? CATALOGUE[0]?.mode ?? "bus");
  const off = vehiclesOffFrom(preferences);
  const group = CATALOGUE.find((g) => g.mode === mode) ?? CATALOGUE[0];
  if (!group) return null;
  const usedOf = (g: (typeof CATALOGUE)[number]) => g.vehicles.filter((v) => !off.has(v.id)).length;
  const used = usedOf(group);
  const ids = group.vehicles.map((v) => v.id);
  return (
    <section
      aria-labelledby="pp-vehicles"
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 md:p-6"
    >
      <h2 id="pp-vehicles" className="caps m-0">
        {t("prefs.vehiclesTitle")}
      </h2>
      <p className="mt-1 text-sm text-slate-600">{t("prefs.vehiclesIntro")}</p>
      <label className="mt-4 mb-1.5 block font-semibold" htmlFor={modeId}>
        {t("prefs.vehiclesMode")}
      </label>
      <div className="field">
        <select id={modeId} value={group.mode} onChange={(e) => setMode(e.target.value)}>
          {CATALOGUE.map((g) => (
            <option key={g.mode} value={g.mode}>
              {t(g.label)} · {t("prefs.vehiclesUsed", { used: usedOf(g), total: g.vehicles.length })}
            </option>
          ))}
        </select>
      </div>
      {editable && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn min-h-10"
            disabled={used === ids.length}
            onClick={() => onPreferences(withVehicles(preferences, ids, true))}
          >
            {t("prefs.vehiclesAll")}
          </button>
        </div>
      )}
      <ul className="mt-2 flex list-none flex-col p-0">
        {group.vehicles.map((v) => {
          const on = !off.has(v.id);
          // The last vehicle in use stays: a line always has one to offer.
          const last = on && used === 1;
          return (
            <li key={v.id} className="border-t border-slate-100 first:border-t-0">
              <label className="flex min-h-11 items-start gap-3 py-2.5">
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0"
                  checked={on}
                  disabled={!editable || last}
                  onChange={(e) => onPreferences(withVehicles(preferences, [v.id], e.target.checked))}
                />
                <span className="min-w-0">
                  <span className="block font-semibold">{v.name}</span>
                  <span className="block text-sm text-slate-500">
                    {t("prefs.vehiclesFacts", {
                      length: String(Number(v.length_m.toFixed(1))),
                      places: v.capacity,
                      speed: Math.round(v.top_speed_kmh),
                    })}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {editable && used === 1 && <p className="mt-2 text-sm text-slate-500">{t("prefs.vehiclesLast")}</p>}
      {!editable && <p className="mt-3 text-sm text-slate-500">{t("prefs.readOnly")}</p>}
    </section>
  );
}
