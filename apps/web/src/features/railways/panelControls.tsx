import { hasMessage, type Translate, useI18n } from "../../i18n/i18n";
import { LEVELS, RAIL_MODES } from "./modes";
import type { RailMode } from "./types";

/** Class names of the panel's text fields and selects. */
export const field = "rounded border border-slate-300 bg-slate-50 px-2 py-1";
export const input = `${field} min-w-0 max-w-56`;

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-slate-200 pt-3">
      <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">{title}</h3>
      {children}
    </section>
  );
}

export function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-md bg-slate-100 p-2">
      <b className="block font-mono text-base">{value}</b>
      <span className="text-xs text-slate-600">{label}</span>
    </div>
  );
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-slate-700">{label}</span>
      {children}
    </label>
  );
}

export function Num({
  value,
  onChange,
  unit,
  min = 0,
  step = 1,
  label,
  wrap,
}: {
  value: number;
  onChange: (v: number) => void;
  unit: string;
  min?: number;
  step?: number;
  label: string;
  /** An angle: any number is taken and wrapped into 0 … wrap (−139° becomes 221°) instead of clamped to `min`. */
  wrap?: number;
}) {
  return (
    <span className="flex items-center gap-1">
      <input
        type="number"
        aria-label={label}
        min={wrap ? undefined : min}
        step={step}
        value={Math.round(value * 10) / 10}
        onChange={(e) => {
          // While a number is half typed (a lone "-"), the field reads "": keep the value until it is a number.
          if (e.target.value.trim() === "") return;
          const v = Number(e.target.value);
          if (!Number.isFinite(v)) return;
          onChange(wrapOrClamp(v, min, wrap));
        }}
        className="w-20 rounded border border-slate-300 px-1 py-0.5 text-end"
      />
      <span className="w-7 text-slate-500">{unit}</span>
    </span>
  );
}

/** Purpose: an angle wrapped into [0, wrap), or any other value held at `min`. */
export function wrapOrClamp(v: number, min: number, wrap?: number): number {
  if (wrap) return ((v % wrap) + wrap) % wrap;
  return Math.max(min, v);
}

export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex rounded border border-slate-300 bg-slate-50 p-0.5"
    >
      {options.map((o) => (
        <button
          key={String(o.id)}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`flex-1 rounded px-1.5 py-1 text-xs ${value === o.id ? "bg-emerald-800 text-white" : "hover:bg-slate-200"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Purpose: the level options with their short labels ("−1", "Street", "+1") in the current language. */
export const levelOpts = (t: Translate) =>
  LEVELS.map((l) => ({ id: l.id, label: hasMessage(l.short) ? t(l.short) : l.short }));

/** `what` is the whole button text, such as "Delete signal (Del)". */
export function Remove({ onClick, what }: { onClick: () => void; what: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border border-red-300 px-2 py-1 text-red-700 hover:bg-red-50"
    >
      {what}
    </button>
  );
}

/**
 * Purpose: the railway system of a station or track. Systems are separate infrastructure in one
 * drawing; `null` follows the mode for new elements.
 */
export function ModeRow({ value, onChange }: { value: RailMode; onChange: (m: RailMode) => void }) {
  const { t } = useI18n();
  return (
    <Row label={t("rail.system")}>
      <select
        aria-label={t("rail.system")}
        value={value}
        onChange={(e) => onChange(e.target.value as RailMode)}
        className={input}
      >
        {RAIL_MODES.map((m) => (
          <option key={m.id} value={m.id}>
            {t(m.label)}
          </option>
        ))}
      </select>
    </Row>
  );
}
