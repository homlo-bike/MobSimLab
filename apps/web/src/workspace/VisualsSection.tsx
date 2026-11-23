import { useId, useState } from "react";
import { useI18n } from "../i18n/i18n";
import type { MessageKey } from "../i18n/messages";
import {
  DEFAULT_VEHICLE_VISUALS,
  MAX_VISUAL_DELAY_MIN,
  type PreferencesDoc,
  VEHICLE_STATES,
  type VehicleState,
  vehicleVisualsFrom,
  withVehicleVisuals,
} from "./preferences";

const COLOR_LABEL = {
  on_time: "visuals.onTime",
  late: "visuals.late",
  very_late: "visuals.veryLate",
  out_of_service: "visuals.outOfService",
  parked: "visuals.parked",
} as const satisfies Record<VehicleState, MessageKey>;

/**
 * Purpose: the Preferences section for how vehicles look in the simulation (Simulator → Road simulation's
 * replay): up to how many minutes late a vehicle in service is on time and late (later is very late), and the
 * colour of each: on time, late, very late, out of service on the street, parked in the depot. `editable` false
 * shows the values only.
 */
export function VisualsSection({
  preferences,
  editable,
  onPreferences,
}: {
  preferences: PreferencesDoc | null;
  editable: boolean;
  onPreferences: (doc: PreferencesDoc) => void;
}) {
  const { t } = useI18n();
  const v = vehicleVisualsFrom(preferences);
  return (
    <section
      aria-labelledby="pp-visuals"
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 md:p-6"
    >
      <h2 id="pp-visuals" className="caps m-0">
        {t("visuals.vehiclesTitle")}
      </h2>
      <p className="mt-1 text-sm text-slate-600">{t("visuals.vehiclesIntro")}</p>
      <div className="mt-2 flex flex-col">
        <MinutesField
          label={t("visuals.onTimeUpTo")}
          value={v.on_time_min}
          own={preferences?.visuals?.on_time_min !== undefined}
          fallback={DEFAULT_VEHICLE_VISUALS.on_time_min}
          editable={editable}
          onChange={(m) => onPreferences(withVehicleVisuals(preferences, { on_time_min: m }))}
        />
        <MinutesField
          label={t("visuals.lateUpTo")}
          value={v.late_min}
          own={preferences?.visuals?.late_min !== undefined}
          fallback={DEFAULT_VEHICLE_VISUALS.late_min}
          editable={editable}
          onChange={(m) => onPreferences(withVehicleVisuals(preferences, { late_min: m }))}
        />
        {v.late_min <= v.on_time_min && <p className="text-sm text-amber-800">{t("visuals.noLate")}</p>}
      </div>
      <h3 className="caps mt-4 mb-1">{t("visuals.colors")}</h3>
      <ul className="m-0 flex list-none flex-col p-0">
        {VEHICLE_STATES.map((k) => (
          <ColorField
            key={k}
            label={t(COLOR_LABEL[k])}
            value={v.colors[k]}
            own={preferences?.visuals?.colors?.[k] !== undefined}
            editable={editable}
            onChange={(c) => onPreferences(withVehicleVisuals(preferences, { colors: { [k]: c } }))}
          />
        ))}
      </ul>
      {!editable && <p className="mt-3 text-sm text-slate-500">{t("prefs.readOnly")}</p>}
    </section>
  );
}

/** Purpose: a number of minutes, with the default and a way back to it. */
function MinutesField({
  label,
  value,
  own,
  fallback,
  editable,
  onChange,
}: {
  label: string;
  value: number;
  own: boolean;
  fallback: number;
  editable: boolean;
  onChange: (min: number | null) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  // What the planner is typing; the saved value shows again once the field is left.
  const [text, setText] = useState<string | null>(null);
  const commit = (raw: string) => {
    const n = Number(raw.replace(",", "."));
    if (raw.trim() === "" || !Number.isFinite(n) || n < 0 || n > MAX_VISUAL_DELAY_MIN) return;
    const m = Math.round(n * 10) / 10;
    onChange(m === fallback ? null : m);
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
      <label htmlFor={id} className="min-w-48 flex-1 font-semibold">
        {label}
      </label>
      <div className="field w-24">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          max={MAX_VISUAL_DELAY_MIN}
          step={0.5}
          disabled={!editable}
          value={text ?? String(value)}
          onChange={(e) => {
            setText(e.target.value);
            commit(e.target.value);
          }}
          onBlur={() => setText(null)}
          className="text-end"
        />
      </div>
      <div className="flex w-full items-center gap-2 text-sm text-slate-500">
        <span>{t("visuals.defaultMin", { value: fallback })}</span>
        {editable && own && (
          <button
            type="button"
            className="min-h-10 text-blue-700 underline"
            onClick={() => {
              setText(null);
              onChange(null);
            }}
          >
            {t("visuals.reset")}
          </button>
        )}
      </div>
    </div>
  );
}

/** Purpose: one vehicle colour, with a way back to the default. */
function ColorField({
  label,
  value,
  own,
  editable,
  onChange,
}: {
  label: string;
  value: string;
  own: boolean;
  editable: boolean;
  onChange: (color: string | null) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
      <label htmlFor={id} className="min-w-48 flex-1">
        {label}
      </label>
      <input
        id={id}
        type="color"
        disabled={!editable}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-16 cursor-pointer rounded border border-slate-300 bg-white"
      />
      <span className="w-20 font-mono text-sm text-slate-500">{value}</span>
      {editable && own && (
        <button
          type="button"
          className="min-h-10 text-sm text-blue-700 underline"
          onClick={() => onChange(null)}
        >
          {t("visuals.reset")}
        </button>
      )}
    </li>
  );
}
