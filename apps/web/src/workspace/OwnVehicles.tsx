import { type FormEvent, useId, useRef, useState } from "react";
import { useI18n } from "../i18n/i18n";
import type { MessageKey } from "../i18n/messages";
import { RAIL_MODES } from "../features/railways/modes";
import { MODES } from "../features/street-lines/modes";
import {
  checkVehicle,
  type CheckedField,
  ENERGY_SOURCES,
  type FleetDoc,
  freeOwnId,
  isStreetMode,
  OWN_MODES,
  type OwnVehicle,
  ownCapacity,
  readVehicleFile,
  type Rejection,
  type UploadResult,
  type VehicleDraft,
  withOwnVehicles,
  withoutOwnVehicle,
} from "../features/fleet/model";

/** Largest vehicle file read, bytes. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Purpose: the message key of a mode's name. */
export function modeLabel(mode: string): MessageKey {
  if (isStreetMode(mode)) return MODES[mode].label;
  return RAIL_MODES.find((r) => r.id === mode)?.label ?? "fleet.mode";
}

/** Purpose: the message key of a checked field's name. */
function fieldLabel(f: CheckedField): MessageKey {
  return `fleet.field.${f}` as MessageKey;
}

/** Purpose: why a vehicle was rejected, in words. */
function useRejectionText() {
  const { t } = useI18n();
  return (r: Rejection) =>
    [
      r.missing.length
        ? t("fleet.missing", { fields: r.missing.map((f) => t(fieldLabel(f))).join(", ") })
        : "",
      r.invalid.length
        ? t("fleet.invalid", { fields: r.invalid.map((f) => t(fieldLabel(f))).join(", ") })
        : "",
    ]
      .filter(Boolean)
      .join(" ");
}

/**
 * Purpose: the project's own vehicles (Project preferences): upload them as JSON, in the catalogue's research
 * format or the full catalogue format, or create one with the form. A vehicle without a core value is
 * rejected. Own vehicles join the catalogue's in the Vehicles list, the line tools and the depots.
 */
export function OwnVehiclesSection({
  fleet,
  editable,
  onFleet,
}: {
  fleet: FleetDoc;
  editable: boolean;
  onFleet: (doc: FleetDoc) => void;
}) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<UploadResult[] | null>(null);
  const [editing, setEditing] = useState<OwnVehicle | "new" | null>(null);
  const rejection = useRejectionText();

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const out: UploadResult[] = [];
    for (const f of Array.from(files)) {
      if (f.size > MAX_FILE_BYTES) {
        out.push({ file: f.name, label: f.name, unreadable: true });
        continue;
      }
      out.push(...readVehicleFile(f.name, await f.text()));
    }
    const ok = out.flatMap((r) => ("vehicle" in r ? [r.vehicle] : []));
    if (ok.length) onFleet(withOwnVehicles(fleet, ok));
    setResults(out);
    if (fileRef.current) fileRef.current.value = "";
  };

  const remove = (v: OwnVehicle) => {
    const units = fleet.units.filter((u) => u.vehicle === v.id).length;
    const ask = units
      ? t("fleet.deleteWithUnits", { name: v.name, count: units })
      : t("fleet.deleteConfirm", { name: v.name });
    if (window.confirm(ask)) onFleet(withoutOwnVehicle(fleet, v.id));
  };

  return (
    <section
      aria-labelledby="pp-own"
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 md:p-6"
    >
      <h2 id="pp-own" className="caps m-0">
        {t("fleet.ownTitle")}
      </h2>
      <p className="mt-1 text-sm text-slate-600">{t("fleet.ownIntro")}</p>
      {editable && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn min-h-10" onClick={() => fileRef.current?.click()}>
            {t("fleet.upload")}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            multiple
            className="hidden"
            aria-label={t("fleet.upload")}
            data-testid="fleet-upload"
            onChange={(e) => void upload(e.target.files)}
          />
          <button type="button" className="btn min-h-10" onClick={() => setEditing("new")}>
            {t("fleet.create")}
          </button>
        </div>
      )}
      {results && (
        <div role="status" className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {results.map((r, i) => (
              <li key={i}>
                {"vehicle" in r ? (
                  <span className="text-emerald-800">✓ {t("fleet.added", { name: r.label })}</span>
                ) : "rejected" in r ? (
                  <span className="text-red-800">
                    ✗ {t("fleet.rejected", { name: r.label })} {rejection(r.rejected)}
                  </span>
                ) : (
                  <span className="text-red-800">✗ {t("fleet.unreadable", { file: r.file })}</span>
                )}
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-ghost mt-2 min-h-9" onClick={() => setResults(null)}>
            {t("common.dismiss")}
          </button>
        </div>
      )}
      {editing && (
        <VehicleForm
          key={editing === "new" ? "new" : editing.id}
          initial={editing === "new" ? null : editing}
          onCancel={() => setEditing(null)}
          onSave={(v) => {
            const old = editing === "new" ? null : editing;
            const id = freeOwnId(fleet, v.name, old?.id);
            const vehicle = { ...v, id: old?.id ?? id, origin: old?.origin ?? "created" };
            onFleet(withOwnVehicles(fleet, [vehicle]));
            setEditing(null);
          }}
        />
      )}
      {fleet.vehicles.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{t("fleet.ownNone")}</p>
      ) : (
        <ul className="mt-2 flex list-none flex-col p-0">
          {fleet.vehicles.map((v) => (
            <li
              key={v.id}
              className="flex flex-wrap items-start gap-x-3 gap-y-1 border-t border-slate-100 py-2.5 first:border-t-0"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">
                  {v.name}
                  <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-800">
                    {t(v.origin === "upload" ? "fleet.uploaded" : "fleet.created")}
                  </span>
                </span>
                <span className="block text-sm text-slate-500">
                  {t(modeLabel(v.mode))} ·{" "}
                  {t("prefs.vehiclesFacts", {
                    length: String(Number(v.length_m.toFixed(1))),
                    places: ownCapacity(v),
                    speed: Math.round(v.top_speed_kmh),
                  })}
                </span>
              </span>
              {editable && (
                <span className="flex gap-2">
                  <button type="button" className="btn btn-ghost min-h-9" onClick={() => setEditing(v)}>
                    {t("fleet.edit")}
                  </button>
                  <button type="button" className="btn btn-ghost min-h-9" onClick={() => remove(v)}>
                    {t("fleet.delete")}
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {!editable && <p className="mt-3 text-sm text-slate-500">{t("prefs.readOnly")}</p>}
    </section>
  );
}

/** The form's number fields, in order, with whether each is a core value. */
const NUMBER_FIELDS: {
  key: keyof OwnVehicle;
  label: CheckedField;
  core?: boolean;
  street?: boolean;
  rail?: boolean;
}[] = [
  { key: "length_m", label: "length", core: true },
  { key: "width_m", label: "width", core: true },
  { key: "height_m", label: "height_m" },
  { key: "seats", label: "seats", core: true },
  { key: "standing", label: "standing", core: true },
  { key: "standing_density", label: "standing_density" },
  { key: "top_speed_kmh", label: "topSpeed", core: true },
  { key: "power_kw", label: "power_kw" },
  { key: "empty_mass_t", label: "empty_mass_t" },
  { key: "loaded_weight_t", label: "loaded_weight_t", street: true },
  { key: "cars", label: "cars", rail: true },
  { key: "articulations", label: "articulations" },
  { key: "turning_circle_m", label: "turning_circle_m", street: true },
];

/** Purpose: the form to create an own vehicle, or change one. Saving checks it as an upload is checked. */
function VehicleForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: OwnVehicle | null;
  onSave: (v: OwnVehicle) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const base = useId();
  const rejection = useRejectionText();
  const text = (x: unknown) => (x === null || x === undefined ? "" : String(x));
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {
      name: text(initial?.name),
      manufacturer: text(initial?.manufacturer),
      mode: initial?.mode ?? "bus",
      energy: initial?.energy ?? "",
      notes: text(initial?.notes),
      sources: (initial?.sources ?? []).join("\n"),
    };
    for (const f of NUMBER_FIELDS) out[f.key] = text(initial?.[f.key]);
    return out;
  });
  const [error, setError] = useState<Rejection | null>(null);
  const street = isStreetMode(values.mode ?? "");
  const set = (k: string, v: string) => setValues((x) => ({ ...x, [k]: v }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const draft: VehicleDraft = {
      id: initial?.id ?? "own-new",
      name: values.name,
      manufacturer: values.manufacturer,
      mode: values.mode,
      energy: values.energy,
      notes: values.notes,
      sources: (values.sources ?? "").split(/\s+/),
      axles_m: initial?.axles_m ?? null,
      origin: "created",
    };
    for (const f of NUMBER_FIELDS) {
      const raw = (values[f.key] ?? "").trim().replace(",", ".");
      const hidden = (f.street && !street) || (f.rail && street);
      draft[f.key] = hidden || raw === "" ? undefined : Number(raw);
    }
    const checked = checkVehicle(draft);
    if ("rejected" in checked) setError(checked.rejected);
    else onSave(checked.vehicle);
  };
  const label = "mb-1 block text-sm font-semibold";
  return (
    <form
      onSubmit={submit}
      aria-label={t(initial ? "fleet.editTitle" : "fleet.createTitle")}
      className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 md:p-4"
    >
      <h3 className="m-0 text-base font-semibold">{t(initial ? "fleet.editTitle" : "fleet.createTitle")}</h3>
      <p className="mt-1 text-sm text-slate-600">{t("fleet.formIntro")}</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor={`${base}-name`}>
            {t("fleet.field.name")} *
          </label>
          <div className="field">
            <input
              id={`${base}-name`}
              maxLength={200}
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className={label} htmlFor={`${base}-man`}>
            {t("fleet.field.manufacturer")}
          </label>
          <div className="field">
            <input
              id={`${base}-man`}
              maxLength={120}
              value={values.manufacturer}
              onChange={(e) => set("manufacturer", e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className={label} htmlFor={`${base}-mode`}>
            {t("fleet.field.mode")} *
          </label>
          <div className="field">
            <select id={`${base}-mode`} value={values.mode} onChange={(e) => set("mode", e.target.value)}>
              {OWN_MODES.map((m) => (
                <option key={m} value={m}>
                  {t(modeLabel(m))}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className={label} htmlFor={`${base}-energy`}>
            {t("fleet.field.energy")} *
          </label>
          <div className="field">
            <select
              id={`${base}-energy`}
              value={values.energy}
              onChange={(e) => set("energy", e.target.value)}
            >
              <option value="">{t("fleet.choose")}</option>
              {ENERGY_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {t(`fleet.energy.${s}` as MessageKey)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {NUMBER_FIELDS.filter((f) => !(f.street && !street) && !(f.rail && street)).map((f) => (
          <div key={f.key}>
            <label className={label} htmlFor={`${base}-${f.key}`}>
              {t(fieldLabel(f.label))}
              {f.core ? " *" : ""}
            </label>
            <div className="field">
              <input
                id={`${base}-${f.key}`}
                inputMode="decimal"
                value={values[f.key]}
                onChange={(e) => set(f.key, e.target.value)}
              />
            </div>
          </div>
        ))}
      </div>
      <label className={`${label} mt-3`} htmlFor={`${base}-sources`}>
        {t("fleet.field.sources")}
      </label>
      <textarea
        id={`${base}-sources`}
        rows={2}
        className="w-full rounded-[10px] border border-slate-300 px-3 py-2 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
        value={values.sources}
        onChange={(e) => set("sources", e.target.value)}
      />
      <label className={`${label} mt-3`} htmlFor={`${base}-notes`}>
        {t("fleet.field.notes")}
      </label>
      <textarea
        id={`${base}-notes`}
        rows={2}
        maxLength={4000}
        className="w-full rounded-[10px] border border-slate-300 px-3 py-2 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
        value={values.notes}
        onChange={(e) => set("notes", e.target.value)}
      />
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-800">
          {rejection(error)}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" className="btn btn-pri min-h-10">
          {t("fleet.save")}
        </button>
        <button type="button" className="btn min-h-10" onClick={onCancel}>
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}
