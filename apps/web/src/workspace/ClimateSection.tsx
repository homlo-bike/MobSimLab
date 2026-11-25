import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/i18n";
import { type VariantShares, variantShares, weatherSettings } from "../features/calendar-run/weather";
import {
  CLIMATE_FIELDS,
  type ClimateField,
  type ClimateFetcher,
  climateFrom,
  climateRows,
  type FetchedClimate,
  fetchClimate,
  type ProjectClimate,
  type MonthClimate,
  withClimate,
  withClimateValue,
  withFetchedClimate,
} from "./climate";
import { zoneShares } from "./climateZones";
import type { PreferencesDoc } from "./preferences";
import { engineErrorText } from "../i18n/engine";

const FIELD_LABEL = {
  mean_c: "climate.mean",
  max_c: "climate.max",
  min_c: "climate.min",
  max_sd_c: "climate.maxSd",
  min_sd_c: "climate.minSd",
} as const satisfies Record<ClimateField, string>;

const NO_LINES: readonly (readonly [number, number])[][] = [];

const DAYS_IN_MONTH = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Purpose: the Preferences section of the project's climate (ADR-0020 weather day types): twelve months of air
 * temperatures at the project's location, fetched once from Open-Meteo (1991–2020) and kept in the project when
 * the planner can edit it, each value changeable; with the expected hot, very hot and frost days per month that
 * calendar runs use.
 */
export function ClimateSection({
  preferences,
  editable,
  onPreferences,
  place,
  lines = NO_LINES,
  fetcher = fetchClimate,
}: {
  preferences: PreferencesDoc | null;
  editable: boolean;
  onPreferences: (doc: PreferencesDoc) => void;
  /** The project's location [lon, lat], or null when nothing is drawn yet. */
  place: readonly [number, number] | null;
  /** The network's drawn lines in degrees (climateZones.ts `networkPolylines`), for each zone's share. */
  lines?: readonly (readonly [number, number])[][];
  fetcher?: ClimateFetcher;
}) {
  const { t, language } = useI18n();
  const climate = climateFrom(preferences);
  // Fetched this session for a viewer, who cannot keep it in the project.
  const [session, setSession] = useState<FetchedClimate | null>(null);
  const [state, setState] = useState<"idle" | "loading" | { error: string }>("idle");
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(preferences);
  latest.current = preferences;
  // A large area: a climate per zone (climateZones.ts), kept by the workspace; the table shows one zone.
  const zones = climate.zones && climate.zones.length > 1 ? climate.zones : null;
  const [zoneId, setZoneId] = useState<string | null>(null);
  const zone = zones ? (zones.find((z) => z.id === zoneId) ?? zones[0]!) : null;
  const zonePart = useMemo(
    () => (zones ? zoneShares(zones, lines as [number, number][][]) : null),
    [zones, lines],
  );
  const view: ProjectClimate =
    zone ?? (climate.fetched || !session ? climate : withFetchedClimate(climate, session));
  const need = !zones && !climate.fetched && !session && place !== null;

  useEffect(() => {
    if ((!need && attempt === 0) || !place) return;
    let stop = false;
    setState("loading");
    fetcher(place[1], place[0])
      .then((got) => {
        if (stop) return;
        setState("idle");
        if (editable)
          onPreferences(withClimate(latest.current, withFetchedClimate(climateFrom(latest.current), got)));
        else setSession(got);
      })
      .catch((e: unknown) => {
        if (!stop) setState({ error: engineErrorText(e) });
      });
    return () => {
      stop = true;
    };
  }, [need, attempt, place?.[0], place?.[1]]);

  const w = weatherSettings(preferences);
  const rows = climateRows(view);
  const monthName = (m: number) =>
    new Intl.DateTimeFormat(language, { month: "short", timeZone: "UTC" }).format(
      new Date(Date.UTC(2001, m - 1, 1)),
    );
  const complete = rows.every((r) => CLIMATE_FIELDS.every((f) => r.used[f] !== undefined));
  const shares: (VariantShares | null)[] = rows.map((r) =>
    complete ? variantShares(r.used as MonthClimate, w) : null,
  );
  const days = (v: keyof VariantShares) =>
    shares.map((s, i) => (s ? Math.round(s[v] * DAYS_IN_MONTH[i]! * 10) / 10 : null));
  const one = (x: number) => new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(x);
  const set = (month: number, f: ClimateField, v: number | null) =>
    onPreferences(
      withClimate(
        preferences,
        zone && zones
          ? {
              ...climate,
              zones: zones.map((z) => (z.id === zone.id ? { ...z, ...withClimateValue(z, month, f, v) } : z)),
            }
          : withClimateValue(climate, month, f, v),
      ),
    );
  const fetched = view.fetched;
  return (
    <section
      aria-labelledby="pp-climate"
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 md:p-6"
    >
      <h2 id="pp-climate" className="caps m-0">
        {t("climate.title")}
      </h2>
      <p className="mt-1 text-sm text-slate-600">{t("climate.intro")}</p>
      {!place && !fetched && !zones && <p className="mt-2 text-sm text-slate-600">{t("climate.noPlace")}</p>}
      {zones && zone && (
        <div className="mt-3">
          <p className="text-sm text-slate-600">{t("climate.zonesIntro", { n: zones.length })}</p>
          <label className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">{t("climate.zone")}</span>
            <select className="field min-h-10" value={zone.id} onChange={(e) => setZoneId(e.target.value)}>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-1 text-sm text-slate-600">
            {lines.length
              ? t("climate.zoneShare", { share: one(100 * (zonePart?.[zones.indexOf(zone)] ?? 0)) })
              : t("climate.zoneNoLines")}
          </p>
        </div>
      )}
      {state === "loading" && (
        <p role="status" className="mt-2 text-sm text-slate-600">
          {t("climate.loading")}
        </p>
      )}
      {typeof state === "object" && (
        <p role="alert" className="mt-2 text-sm text-red-800">
          {t("climate.failed", { error: state.error })}{" "}
          <button
            type="button"
            className="min-h-10 text-blue-700 underline"
            onClick={() => setAttempt((a) => a + 1)}
          >
            {t("cal.retry")}
          </button>
        </p>
      )}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="text-slate-500">
              <th scope="col" className="py-1 text-start font-medium">
                {t("climate.month")}
              </th>
              {CLIMATE_FIELDS.map((f) => (
                <th key={f} scope="col" className="py-1 text-end font-medium">
                  {t(FIELD_LABEL[f])}
                </th>
              ))}
              <th scope="col" className="py-1 text-end font-medium">
                {t("climate.hotDays")}
              </th>
              <th scope="col" className="py-1 text-end font-medium">
                {t("climate.veryHotDays")}
              </th>
              <th scope="col" className="py-1 text-end font-medium">
                {t("climate.coldDays")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.month} className="border-t border-slate-100">
                <th scope="row" className="py-1 text-start font-semibold">
                  {monthName(r.month)}
                </th>
                {CLIMATE_FIELDS.map((f) => (
                  <td key={f} className="py-1 text-end">
                    <TempField
                      label={`${monthName(r.month)} · ${t(FIELD_LABEL[f])}`}
                      value={r.used[f]}
                      fetched={r.fetched[f]}
                      own={!!r.own[f]}
                      editable={editable}
                      spread={f.endsWith("_sd_c")}
                      onChange={(v) => set(r.month, f, v === r.fetched[f] ? null : v)}
                      resetLabel={
                        r.fetched[f] === undefined
                          ? t("climate.clear")
                          : t("climate.reset", { value: one(r.fetched[f]!) })
                      }
                    />
                  </td>
                ))}
                {(["hot", "very_hot", "cold"] as const).map((v) => (
                  <td key={v} className="py-1 text-end tabular-nums">
                    {days(v)[i] === null ? "–" : one(days(v)[i]!)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable && <p className="mt-1 text-xs text-slate-500">{t("climate.ownHint")}</p>}
      <p className="mt-2 text-sm text-slate-600">
        {t("climate.limits", {
          heat: one(w.heatAirC),
          heatKmh: one(w.heatKmh),
          sag: one(w.sagAirC),
          sagKmh: one(w.sagKmh),
          frost: one(w.frostC),
          switches: t(w.switchHeating ? "climate.switchesHeated" : "climate.switchesFreeze"),
        })}
      </p>
      {fetched && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span>
            {t("climate.source", {
              from: fetched.from_year,
              to: fetched.to_year,
              lat: one(fetched.lat),
              lon: one(fetched.lon),
            })}
          </span>
          {editable && place && !zones && state !== "loading" && (
            <button
              type="button"
              className="min-h-10 text-blue-700 underline"
              onClick={() => setAttempt((a) => a + 1)}
            >
              {t("climate.refetch")}
            </button>
          )}
        </p>
      )}
      {!editable && <p className="mt-3 text-sm text-slate-500">{t("prefs.readOnly")}</p>}
    </section>
  );
}

/** Purpose: one temperature the planner can change, with a way back to Open-Meteo's. */
function TempField({
  label,
  value,
  fetched,
  own,
  editable,
  spread,
  onChange,
  resetLabel,
}: {
  label: string;
  value: number | undefined;
  fetched: number | undefined;
  own: boolean;
  editable: boolean;
  spread: boolean;
  onChange: (v: number | null) => void;
  resetLabel: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = value === undefined ? "" : String(value);
  if (!editable)
    return (
      <span className={`tabular-nums ${own ? "font-semibold" : ""}`}>
        {value === undefined ? "–" : shown}
      </span>
    );
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
          inputMode="decimal"
          min={spread ? 0 : -90}
          max={70}
          step={0.1}
          value={text ?? shown}
          onChange={(e) => {
            setText(e.target.value);
            const n = Number(e.target.value.replace(",", "."));
            if (e.target.value.trim() === "" || !Number.isFinite(n) || n > 70 || n < (spread ? 0 : -90))
              return;
            const v = Math.round(n * 10) / 10;
            onChange(fetched !== undefined && v === fetched ? null : v);
          }}
          onBlur={() => setText(null)}
          className="text-end"
        />
      </div>
    </div>
  );
}
