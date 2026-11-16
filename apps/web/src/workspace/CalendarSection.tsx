import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/i18n";
import {
  type CalendarApi,
  calendarApi,
  calendarFrom,
  DAY_TYPES,
  dayCounts,
  type DayTypeId,
  holidayRows,
  MAX_YEARS,
  simulationYearsFrom,
  withCalendar,
  withDayCount,
  withFetched,
  withHolidayAdded,
  withHolidayRemoved,
  withSimulationYears,
  yearList,
} from "./calendar";
import type { PreferencesDoc } from "./preferences";

const DEFAULT_API = calendarApi();

/** Message key of each day type's name. */
export const DAY_TYPE_LABEL = {
  weekday: "cal.day.weekday",
  saturday: "cal.day.saturday",
  sunday: "cal.day.sunday",
  holiday: "cal.day.holiday",
} as const satisfies Record<DayTypeId, string>;

/**
 * Purpose: the Preferences section of the project calendar (ADR-0020): the simulation years, the country (and
 * region) of the public holidays, each year's holidays with the planner's added and removed days, and the
 * number of days of each day type per year, which the planner can change. Missing years' holidays are fetched
 * from Nager.Date and kept in the project when the planner can edit it.
 */
export function CalendarSection({
  preferences,
  editable,
  onPreferences,
  detectedCountry = null,
  api = DEFAULT_API,
  today = new Date(),
}: {
  preferences: PreferencesDoc | null;
  editable: boolean;
  onPreferences: (doc: PreferencesDoc) => void;
  /** ISO alpha-2 country at the project's location, when known. */
  detectedCountry?: string | null;
  api?: CalendarApi;
  today?: Date;
}) {
  const { t, language } = useI18n();
  const cal = calendarFrom(preferences);
  const years = simulationYearsFrom(preferences, today);
  const defaults = simulationYearsFrom(null, today);
  const own = !!preferences?.simulationYears;
  const list = yearList(years);
  const country = (cal.country ?? detectedCountry ?? "").toUpperCase();
  const [shown, setShown] = useState<number>(years.first);
  const year = list.includes(shown) ? shown : years.first;
  // Holidays fetched this session for a viewer, who cannot keep them in the project.
  const [session, setSession] = useState<Record<string, Awaited<ReturnType<CalendarApi["holidays"]>>>>({});
  const [fetchState, setFetchState] = useState<"idle" | "loading" | { error: string }>("idle");
  const [attempt, setAttempt] = useState(0);
  // The latest document, so holidays that arrive later do not undo changes made meanwhile.
  const latest = useRef(preferences);
  latest.current = preferences;
  const missing = useMemo(
    () => (country ? list.filter((y) => !cal.fetched?.[String(y)] && !session[`${country}/${y}`]) : []),
    [country, years.first, years.last, cal.fetched, session],
  );
  // The calendar with the session's holidays for years the project has no copy of.
  const view = useMemo(() => {
    let c = cal;
    for (const y of list) {
      const s = session[`${country}/${y}`];
      if (!c.fetched?.[String(y)] && s) c = withFetched(c, y, s);
    }
    return c;
  }, [cal, session, country, years.first, years.last]);

  useEffect(() => {
    if (!missing.length || !/^[A-Z]{2}$/.test(country)) return;
    let stop = false;
    setFetchState("loading");
    Promise.all(missing.map((y) => api.holidays(country, y).then((days) => [y, days] as const)))
      .then((got) => {
        if (stop) return;
        setFetchState("idle");
        const now = calendarFrom(latest.current);
        if (editable && (now.country ?? detectedCountry ?? "").toUpperCase() === country) {
          let next = now;
          for (const [y, days] of got) next = withFetched(next, y, days);
          onPreferences(withCalendar(latest.current, next));
        } else
          setSession((s) => ({ ...s, ...Object.fromEntries(got.map(([y, d]) => [`${country}/${y}`, d])) }));
      })
      .catch((e: unknown) => {
        if (!stop) setFetchState({ error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      stop = true;
    };
  }, [missing.join(), country, attempt]);

  const setCal = (next: typeof cal) => onPreferences(withCalendar(preferences, next));
  const fmtDate = (d: string) => {
    try {
      return new Intl.DateTimeFormat(language, { dateStyle: "medium", timeZone: "UTC" }).format(
        new Date(`${d}T00:00:00Z`),
      );
    } catch {
      return d;
    }
  };
  const rows = holidayRows(view, year);
  return (
    <section
      aria-labelledby="pp-calendar"
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 md:p-6"
    >
      <h2 id="pp-calendar" className="caps m-0">
        {t("cal.title")}
      </h2>
      <p className="mt-1 text-sm text-slate-600">{t("cal.intro")}</p>

      <h3 className="mt-4 font-semibold">{t("cal.years")}</h3>
      <YearsFields
        first={years.first}
        last={years.last}
        editable={editable}
        onChange={(first, last) => onPreferences(withSimulationYears(preferences, { first, last }))}
      />
      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
        <span>{t("cal.yearsDefault", { first: defaults.first, last: defaults.last, max: MAX_YEARS })}</span>
        {editable && own && (
          <button
            type="button"
            className="min-h-10 text-blue-700 underline"
            onClick={() => onPreferences(withSimulationYears(preferences, null))}
          >
            {t("cal.reset")}
          </button>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <CodeField
          label={t("cal.country")}
          hint={
            detectedCountry
              ? t("cal.countryHint", { code: detectedCountry.toUpperCase() })
              : t("cal.countryUnknown")
          }
          value={cal.country ?? ""}
          pattern={/^[A-Za-z]{2}$/}
          placeholder={detectedCountry?.toUpperCase() ?? "DE"}
          editable={editable}
          onChange={(v) => setCal({ ...cal, country: v ? v.toUpperCase() : undefined, fetched: undefined })}
        />
        <CodeField
          label={t("cal.region")}
          hint={t("cal.regionHint")}
          value={cal.region ?? ""}
          pattern={/^[A-Za-z]{2}-[A-Za-z0-9]{1,3}$/}
          placeholder={`${country || "DE"}-…`}
          editable={editable}
          onChange={(v) => setCal({ ...cal, region: v ? v.toUpperCase() : undefined })}
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <h3 className="flex-1 font-semibold">{t("cal.holidays", { year })}</h3>
        <label className="text-sm" htmlFor="pp-cal-year">
          {t("cal.year")}
        </label>
        <div className="field w-28">
          <select id="pp-cal-year" value={year} onChange={(e) => setShown(Number(e.target.value))}>
            {list.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>
      {!country && <p className="mt-2 text-sm text-slate-600">{t("cal.noCountry")}</p>}
      {fetchState === "loading" && (
        <p role="status" className="mt-2 text-sm text-slate-600">
          {t("cal.loading")}
        </p>
      )}
      {typeof fetchState === "object" && (
        <p role="alert" className="mt-2 text-sm text-red-800">
          {t("cal.fetchFailed", { error: fetchState.error })}{" "}
          <button
            type="button"
            className="min-h-10 text-blue-700 underline"
            onClick={() => setAttempt((a) => a + 1)}
          >
            {t("cal.retry")}
          </button>
        </p>
      )}
      {rows.length === 0 && country && fetchState !== "loading" && (
        <p className="mt-2 text-sm text-slate-600">{t("cal.noneYet")}</p>
      )}
      {rows.length > 0 && (
        <ul className="mt-2 divide-y divide-slate-100" aria-label={t("cal.holidays", { year })}>
          {rows.map((h) => (
            <li key={`${h.origin}-${h.date}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className={`w-32 tabular-nums ${h.counts ? "" : "text-slate-400 line-through"}`}>
                {fmtDate(h.date)}
              </span>
              <span className={`min-w-40 flex-1 ${h.counts ? "" : "text-slate-400"}`}>
                {h.localName && h.localName !== h.name ? `${h.localName} · ${h.name}` : h.name}
                {h.origin === "added" && (
                  <span className="ms-2 text-xs text-slate-500">{t("cal.added")}</span>
                )}
                {h.reason === "region" && (
                  <span className="ms-2 text-xs text-slate-500">
                    {t("cal.otherRegion", { regions: (h.regions ?? []).join(", ") })}
                  </span>
                )}
              </span>
              {editable && h.reason !== "region" && (
                <button
                  type="button"
                  className="min-h-10 text-sm text-blue-700 underline"
                  onClick={() =>
                    setCal(
                      h.counts
                        ? withHolidayRemoved(cal, h.date)
                        : withHolidayAdded(cal, { date: h.date, name: h.name }),
                    )
                  }
                >
                  {h.origin === "added" ? t("cal.delete") : h.counts ? t("cal.remove") : t("cal.restore")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <AddHoliday year={year} onAdd={(date, name) => setCal(withHolidayAdded(cal, { date, name }))} />
      )}
      <p className="mt-2 text-xs text-slate-500">{t("cal.source")}</p>

      <h3 className="mt-5 font-semibold">{t("cal.counts")}</h3>
      <p className="mt-1 text-sm text-slate-600">{t("cal.countsIntro")}</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <thead>
            <tr className="text-start text-slate-500">
              <th scope="col" className="py-1 text-start font-medium">
                {t("cal.year")}
              </th>
              {DAY_TYPES.map((dt) => (
                <th key={dt} scope="col" className="py-1 text-end font-medium">
                  {t(DAY_TYPE_LABEL[dt])}
                </th>
              ))}
              <th scope="col" className="py-1 text-end font-medium">
                {t("cal.total")}
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((y) => {
              const c = dayCounts(y, view);
              const total = DAY_TYPES.reduce((s, dt) => s + c.used[dt], 0);
              return (
                <tr key={y} className="border-t border-slate-100">
                  <th scope="row" className="py-1 text-start font-semibold">
                    {y}
                    {!c.hasHolidays && (
                      <span className="block text-xs font-normal text-amber-800">
                        {t("cal.noHolidaysYear")}
                      </span>
                    )}
                  </th>
                  {DAY_TYPES.map((dt) => (
                    <td key={dt} className="py-1 text-end">
                      <CountField
                        label={`${y} · ${t(DAY_TYPE_LABEL[dt])}`}
                        value={c.used[dt]}
                        counted={c.counted[dt]}
                        own={!!c.own[dt]}
                        editable={editable}
                        onChange={(v) => setCal(withDayCount(cal, y, dt, v === c.counted[dt] ? null : v))}
                        resetLabel={t("cal.resetCount", { value: c.counted[dt] })}
                      />
                    </td>
                  ))}
                  <td className="py-1 text-end tabular-nums">{total}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!editable && <p className="mt-3 text-sm text-slate-500">{t("prefs.readOnly")}</p>}
    </section>
  );
}

/** Purpose: the first and last simulation year; a change is passed on once both make sense. */
function YearsFields({
  first,
  last,
  editable,
  onChange,
}: {
  first: number;
  last: number;
  editable: boolean;
  onChange: (first: number, last: number) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const [text, setText] = useState<{ first: string; last: string } | null>(null);
  const shown = text ?? { first: String(first), last: String(last) };
  const commit = (next: { first: string; last: string }) => {
    setText(next);
    const a = Number(next.first);
    const b = Number(next.last);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1900 || b > 2200 || b < a || b - a >= MAX_YEARS)
      return;
    onChange(a, b);
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-3">
      {(["first", "last"] as const).map((k) => (
        <div key={k} className="flex items-center gap-2">
          <label htmlFor={`${id}-${k}`}>{t(k === "first" ? "cal.first" : "cal.last")}</label>
          <div className="field w-28">
            <input
              id={`${id}-${k}`}
              type="number"
              inputMode="numeric"
              min={1900}
              max={2200}
              step={1}
              disabled={!editable}
              value={shown[k]}
              onChange={(e) => commit({ ...shown, [k]: e.target.value })}
              onBlur={() => setText(null)}
              className="text-end"
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Purpose: a short code (country or region) the planner types; empty means the default. */
function CodeField({
  label,
  hint,
  value,
  pattern,
  placeholder,
  editable,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  pattern: RegExp;
  placeholder: string;
  editable: boolean;
  onChange: (v: string) => void;
}) {
  const id = useId();
  const [text, setText] = useState<string | null>(null);
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block font-semibold">
        {label}
      </label>
      <div className="field">
        <input
          id={id}
          type="text"
          autoComplete="off"
          spellCheck={false}
          disabled={!editable}
          placeholder={placeholder}
          value={text ?? value}
          onChange={(e) => {
            const v = e.target.value.trim();
            setText(e.target.value);
            if (v === "" || pattern.test(v)) onChange(v);
          }}
          onBlur={() => setText(null)}
        />
      </div>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

/** Purpose: one day count the planner can change, with a way back to the counted one. */
function CountField({
  label,
  value,
  counted,
  own,
  editable,
  onChange,
  resetLabel,
}: {
  label: string;
  value: number;
  counted: number;
  own: boolean;
  editable: boolean;
  onChange: (v: number | null) => void;
  resetLabel: string;
}) {
  const [text, setText] = useState<string | null>(null);
  if (!editable) return <span className={`tabular-nums ${own ? "font-semibold" : ""}`}>{value}</span>;
  return (
    <div className="flex items-center justify-end gap-1">
      {own && (
        <button
          type="button"
          title={resetLabel}
          aria-label={`${label}: ${resetLabel}`}
          className="min-h-10 min-w-8 text-blue-700"
          onClick={() => {
            setText(null);
            onChange(null);
          }}
        >
          ↺
        </button>
      )}
      <div className={`field w-20 ${own ? "ring-1 ring-amber-400" : ""}`}>
        <input
          aria-label={label}
          type="number"
          inputMode="numeric"
          min={0}
          max={366}
          step={1}
          value={text ?? String(value)}
          onChange={(e) => {
            setText(e.target.value);
            const n = Number(e.target.value);
            if (e.target.value.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= 366)
              onChange(n === counted ? null : n);
          }}
          onBlur={() => setText(null)}
          className="text-end"
        />
      </div>
    </div>
  );
}

/** Purpose: add a day off to a year: a date of that year and a name. */
function AddHoliday({ year, onAdd }: { year: number; onAdd: (date: string, name: string) => void }) {
  const { t } = useI18n();
  const id = useId();
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const ok = date.startsWith(`${year}-`) && name.trim() !== "";
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    onAdd(date, name.trim());
    setDate("");
    setName("");
  };
  return (
    <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2">
      <div>
        <label htmlFor={`${id}-d`} className="mb-1 block text-sm">
          {t("cal.addDate")}
        </label>
        <div className="field w-44">
          <input
            id={`${id}-d`}
            type="date"
            min={`${year}-01-01`}
            max={`${year}-12-31`}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
      </div>
      <div className="min-w-40 flex-1">
        <label htmlFor={`${id}-n`} className="mb-1 block text-sm">
          {t("cal.addName")}
        </label>
        <div className="field">
          <input
            id={`${id}-n`}
            type="text"
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      </div>
      <button type="submit" className="btn min-h-10" disabled={!ok}>
        {t("cal.add")}
      </button>
    </form>
  );
}
