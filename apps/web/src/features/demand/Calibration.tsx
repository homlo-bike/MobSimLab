/**
 * Calibration of the demand model (09 §2.3): what the planner observed (mode shares, the mean car trip and
 * weekday boardings of lines and stops, typed or from CSV), and how a calibrated run fits it.
 */
import { useState } from "react";
import type { PreferencesDoc } from "../../workspace/preferences";
import type { Calibration, Mode, ObservedDemand } from "./api";
import { demandParam } from "./params";
import type { DemandDoc, ObservedCount, ObservedDoc } from "./zones";

const card = "mt-4 rounded-2xl border border-slate-200 bg-white p-4 md:p-6";
const th = "px-2 py-1.5 text-left font-medium text-slate-600";
const td = "px-2 py-1.5 align-top";
const num = "px-2 py-1.5 text-right align-top tabular-nums whitespace-nowrap";
const SHARE_MODES: Mode[] = ["car", "transit", "walk", "cycle"];
const MODE_LABEL: Record<Mode, string> = {
  car: "Car",
  transit: "Public transport",
  walk: "Walking",
  cycle: "Cycling",
};
/** Largest number of observed counts (apps/api and the worker take as many). */
export const MAX_COUNTS = 5000;
const SHOWN = 50;

function fmt(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return "–";
  return v.toLocaleString("en", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

/** Purpose: one CSV line as fields; double quotes enclose fields with commas, and "" is a quote. */
function csvFields(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === "," || c === ";" || c === "\t") {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/**
 * Purpose: observed counts from CSV text with the columns kind (line or stop), id (an id or name) and value
 * (weekday boardings). A header row is optional; rows that cannot be read are listed by number.
 */
export function parseCountsCsv(text: string): { counts: ObservedCount[]; errors: string[] } {
  const counts: ObservedCount[] = [];
  const bad: number[] = [];
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  lines.forEach((raw, i) => {
    if (!raw.trim()) return;
    const [kind = "", id = "", value = ""] = csvFields(raw);
    const k = kind.toLowerCase();
    if (i === 0 && k === "kind") return;
    const v = Number(value.replace(/\s/g, ""));
    if ((k !== "line" && k !== "stop") || !id || value === "" || !Number.isFinite(v) || v < 0) {
      bad.push(i + 1);
      return;
    }
    counts.push({ kind: k, id, value: v });
  });
  const errors: string[] = [];
  if (bad.length)
    errors.push(
      `Rows ${bad.slice(0, 10).join(", ")}${bad.length > 10 ? ` and ${bad.length - 10} more` : ""} were left out: each row needs line or stop, an id or name, and a number of boardings.`,
    );
  if (counts.length > MAX_COUNTS) {
    errors.push(`Only the first ${MAX_COUNTS} counts are kept.`);
    counts.length = MAX_COUNTS;
  }
  return { counts, errors };
}

/**
 * Purpose: what a run calibrates to, from the saved observed data: the shares when all four are given and
 * add up to more than 0, the mean car trip when above 0, and the counts. Undefined when there is nothing.
 */
export function observedForRun(o: ObservedDoc | null | undefined): ObservedDemand | undefined {
  if (!o) return undefined;
  const out: ObservedDemand = {};
  const s = o.shares ?? {};
  const shares = SHARE_MODES.map((m) => s[m]);
  if (shares.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0)) {
    const vals = shares as number[];
    if (vals.reduce((a, b) => a + b, 0) > 0)
      out.mode_shares = Object.fromEntries(SHARE_MODES.map((m, i) => [m, vals[i]])) as Record<Mode, number>;
  }
  if (o.meanCarKm && o.meanCarKm > 0) out.mean_car_km = o.meanCarKm;
  if (o.counts?.length) out.counts = o.counts.slice(0, MAX_COUNTS);
  return out.mode_shares || out.mean_car_km || out.counts ? out : undefined;
}

/** The observed data card: mode shares, the mean car trip, and counts typed or uploaded as CSV. */
export function ObservedCard({
  doc,
  onDoc,
  lineNames,
  stopNames,
}: {
  doc: DemandDoc | null;
  onDoc?: (doc: DemandDoc) => void;
  lineNames: string[];
  stopNames: string[];
}) {
  const [notes, setNotes] = useState<string[]>([]);
  const o = doc?.observed ?? {};
  const counts = o.counts ?? [];
  const editable = !!onDoc;
  if (!editable && !observedForRun(o)) return null;
  const save = (next: ObservedDoc) => {
    const d: DemandDoc = { ...(doc ?? { source: "auto" }) };
    const clean: ObservedDoc = {};
    if (next.shares && Object.keys(next.shares).length) clean.shares = next.shares;
    if (next.meanCarKm) clean.meanCarKm = next.meanCarKm;
    if (next.counts?.length) clean.counts = next.counts;
    if (Object.keys(clean).length) d.observed = clean;
    else delete d.observed;
    onDoc?.(d);
  };
  const setShare = (m: Mode, raw: string) => {
    const shares = { ...(o.shares ?? {}) };
    const v = raw.trim() === "" ? NaN : Number(raw);
    if (Number.isFinite(v) && v >= 0 && v <= 100) shares[m] = v;
    else delete shares[m];
    save({ ...o, shares });
  };
  const setKm = (raw: string) => {
    const v = Number(raw);
    save({ ...o, meanCarKm: raw.trim() !== "" && Number.isFinite(v) && v > 0 && v < 1000 ? v : null });
  };
  const setCount = (i: number, c: ObservedCount | null) => {
    const next = counts.slice();
    if (c) next[i] = c;
    else next.splice(i, 1);
    save({ ...o, counts: next });
  };
  const upload = async (file: File) => {
    const { counts: read, errors } = parseCountsCsv(await file.text());
    const merged = [...counts, ...read].slice(0, MAX_COUNTS);
    setNotes([`${read.length} counts read from ${file.name}.`, ...errors]);
    save({ ...o, counts: merged });
  };
  const given = SHARE_MODES.map((m) => o.shares?.[m]).filter((v): v is number => typeof v === "number");
  const sum = given.reduce((a, b) => a + b, 0);
  return (
    <div className={card} aria-label="Observed data">
      <h3 className="caps m-0">Observed data</h3>
      <p className="mt-2 text-sm text-slate-600">
        With observed data the run calibrates itself: it moves the mode constants and the trip length until
        the model matches, and shows how close it got. Leave everything empty for an uncalibrated run.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {SHARE_MODES.map((m) => (
          <label key={m} className="block text-sm">
            <span className="font-medium">{MODE_LABEL[m]}, % of trips</span>
            <input
              key={`${m}:${o.shares?.[m] ?? ""}`}
              type="number"
              min={0}
              max={100}
              step="any"
              className="input mt-1 w-full"
              defaultValue={o.shares?.[m] ?? ""}
              disabled={!editable}
              onBlur={(e) => setShare(m, e.target.value)}
            />
          </label>
        ))}
        <label className="block text-sm">
          <span className="font-medium">Mean car trip, km</span>
          <input
            key={`km:${o.meanCarKm ?? ""}`}
            type="number"
            min={0}
            step="any"
            className="input mt-1 w-full"
            defaultValue={o.meanCarKm ?? ""}
            disabled={!editable}
            onBlur={(e) => setKm(e.target.value)}
          />
        </label>
      </div>
      {given.length > 0 && given.length < 4 && (
        <p className="mt-2 text-sm text-amber-800">
          Give all four shares, or none: shares are used together.
        </p>
      )}
      {given.length === 4 && Math.abs(sum - 100) > 0.5 && (
        <p className="mt-2 text-sm text-slate-600">
          The shares add up to {fmt(sum, 1)} %; the run scales them to 100 %.
        </p>
      )}

      <h4 className="mt-4 mb-0 text-sm font-semibold">Boardings, a weekday</h4>
      <p className="mt-1 text-sm text-slate-600">
        Counts of lines or stops, by id or name. CSV files need the columns kind (line or stop), id and value.
      </p>
      <datalist id="demand-observed-lines">
        {lineNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <datalist id="demand-observed-stops">
        {stopNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      {counts.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={th}>Line or stop</th>
                <th className={th}>Id or name</th>
                <th className={`${th} text-right`}>Boardings</th>
                {editable && <th className={th} aria-label="Remove" />}
              </tr>
            </thead>
            <tbody>
              {counts.slice(0, SHOWN).map((c, i) => (
                <tr key={`${i}:${c.kind}:${c.id}:${c.value}`} className="border-t border-slate-100">
                  <td className={td}>
                    <select
                      className="input"
                      aria-label={`Count ${i + 1}: line or stop`}
                      value={c.kind}
                      disabled={!editable}
                      onChange={(e) => setCount(i, { ...c, kind: e.target.value as "line" | "stop" })}
                    >
                      <option value="line">Line</option>
                      <option value="stop">Stop</option>
                    </select>
                  </td>
                  <td className={td}>
                    <input
                      className="input w-full"
                      aria-label={`Count ${i + 1}: id or name`}
                      list={c.kind === "line" ? "demand-observed-lines" : "demand-observed-stops"}
                      defaultValue={c.id}
                      disabled={!editable}
                      onBlur={(e) => {
                        const id = e.target.value.trim();
                        if (id && id !== c.id) setCount(i, { ...c, id });
                      }}
                    />
                  </td>
                  <td className={num}>
                    <input
                      type="number"
                      min={0}
                      className="input w-28 text-right"
                      aria-label={`Count ${i + 1}: boardings`}
                      defaultValue={c.value}
                      disabled={!editable}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (e.target.value !== "" && Number.isFinite(v) && v >= 0 && v !== c.value)
                          setCount(i, { ...c, value: v });
                      }}
                    />
                  </td>
                  {editable && (
                    <td className={td}>
                      <button type="button" className="btn min-h-10" onClick={() => setCount(i, null)}>
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {counts.length > SHOWN && (
            <p className="mt-1 text-sm text-slate-500">
              And {fmt(counts.length - SHOWN)} more counts from the CSV.
            </p>
          )}
        </div>
      )}
      {editable && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn min-h-10"
            disabled={counts.length >= MAX_COUNTS}
            onClick={() =>
              save({ ...o, counts: [...counts, { kind: "line", id: lineNames[0] ?? "", value: 0 }] })
            }
          >
            Add a count
          </button>
          <label className="btn min-h-10 cursor-pointer">
            Upload counts (CSV)
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void upload(f);
              }}
            />
          </label>
          {counts.length > 0 && (
            <button
              type="button"
              className="btn min-h-10"
              onClick={() => {
                setNotes([]);
                save({ ...o, counts: [] });
              }}
            >
              Remove all counts
            </button>
          )}
        </div>
      )}
      {notes.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-sm text-slate-600" role="status">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function sharePct(v: number | null | undefined): string {
  return v == null ? "–" : `${fmt(v * 100, 1)} %`;
}

/** How a calibrated run fits what was observed, and the values it fitted, which can go to preferences. */
export function CalibrationResult({
  c,
  preferences,
  onPreferences,
}: {
  c: Calibration;
  preferences: PreferencesDoc | null;
  onPreferences?: (doc: PreferencesDoc) => void;
}) {
  const [saved, setSaved] = useState(false);
  const fitted = Object.entries(c.fitted);
  const shares = SHARE_MODES.some((m) => c.mode_shares[m]?.observed != null);
  const last = c.rounds[c.rounds.length - 1];
  const worst = c.counts
    .filter((r) => r.geh != null)
    .sort((a, b) => (b.geh ?? 0) - (a.geh ?? 0))
    .slice(0, 15);
  const missing = c.counts.filter((r) => r.modelled == null);
  const save = () => {
    const values = { ...(preferences?.values ?? {}) };
    for (const [k, v] of fitted) values[k] = v;
    onPreferences?.({ ...(preferences ?? {}), values });
    setSaved(true);
  };
  return (
    <div className="mt-4" aria-label="Calibration">
      <h4 className="m-0 text-sm font-semibold">Calibration</h4>
      <p className="mt-1 text-sm text-slate-600">
        {c.rounds.length === 1 ? "One round" : `${c.rounds.length} rounds`}
        {last ? `; the largest gap left is ${fmt(last.gap * 100, 1)} %` : ""}.
        {c.matched > 0 &&
          ` ${fmt(c.matched)} counts matched a line or stop: %RMSE ${fmt(c.rmse_pct, 1)}, ${fmt((c.geh_under_5_share ?? 0) * 100)} % with a GEH under 5.`}
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={th} />
              <th className={`${th} text-right`}>Observed</th>
              <th className={`${th} text-right`}>Modelled</th>
            </tr>
          </thead>
          <tbody>
            {shares &&
              SHARE_MODES.map((m) => (
                <tr key={m} className="border-t border-slate-100">
                  <th scope="row" className={th}>
                    {MODE_LABEL[m]}
                  </th>
                  <td className={num}>{sharePct(c.mode_shares[m]?.observed)}</td>
                  <td className={num}>{sharePct(c.mode_shares[m]?.modelled)}</td>
                </tr>
              ))}
            {c.mean_car_km.observed != null && (
              <tr className="border-t border-slate-100">
                <th scope="row" className={th}>
                  Mean car trip
                </th>
                <td className={num}>{fmt(c.mean_car_km.observed, 1)} km</td>
                <td className={num}>{fmt(c.mean_car_km.modelled, 1)} km</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {worst.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm" aria-label="Counts with the largest GEH">
            <thead>
              <tr>
                <th className={th}>Count</th>
                <th className={`${th} text-right`}>Observed</th>
                <th className={`${th} text-right`}>Modelled</th>
                <th className={`${th} text-right`}>GEH</th>
              </tr>
            </thead>
            <tbody>
              {worst.map((r, i) => (
                <tr key={`${i}:${r.kind}:${r.id}`} className="border-t border-slate-100">
                  <td className={td}>
                    {r.kind === "line" ? "Line" : "Stop"} {r.id}
                  </td>
                  <td className={num}>{fmt(r.observed)}</td>
                  <td className={num}>{fmt(r.modelled)}</td>
                  <td className={`${num} ${(r.geh ?? 0) >= 5 ? "font-semibold text-amber-800" : ""}`}>
                    {fmt(r.geh, 1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {missing.length > 0 && (
        <p className="mt-2 text-sm text-amber-800">
          {fmt(missing.length)} counts name no line or stop of the network:{" "}
          {missing
            .slice(0, 5)
            .map((r) => r.id)
            .join(", ")}
          {missing.length > 5 ? "…" : ""}
        </p>
      )}
      {fitted.length > 0 && (
        <>
          <table className="mt-3 w-full text-sm" aria-label="Fitted values">
            <tbody>
              {fitted.map(([k, v]) => (
                <tr key={k} className="border-t border-slate-100">
                  <th scope="row" className={th}>
                    {demandParam(k).label}
                  </th>
                  <td className={num}>{fmt(v, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {onPreferences && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" className="btn btn-pri min-h-10" disabled={saved} onClick={save}>
                {saved ? "Saved to Project preferences" : "Save fitted values to Project preferences"}
              </button>
              <span className="text-sm text-slate-500">Later runs then start from them.</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
