import { createContext, type ReactNode, useContext, useEffect, useId, useMemo, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { useI18n } from "../i18n/i18n";
import { isolate, paramLabel, paramUnit } from "../i18n/params";
import type { MessageKey } from "../i18n/messages";
import { RATE_PREF } from "../features/costs/currency";
import { outsideLibraryRange } from "../features/costs/params";
import { TRAINS } from "../features/railways/trains";
import { VEHICLES } from "../features/street-lines/vehicles";
import { download } from "../features/schematic/export";
import { GROUP_LABEL, TRACTION_LABEL } from "./Parameters";
import { PARAM_GROUPS, type PreferencesDoc } from "./preferences";
import type { ValueHistoryEntry } from "../projects/api";
import {
  fmtNum,
  type LastChange,
  lastChanges,
  type OtherChoices,
  otherChoices,
  type ReportRow,
  type ReportSources,
  reportRows,
  type SourceEntry,
  toCsv,
} from "./assumptionsReport";

/** Catalogue vehicle names by id, for the vehicles a project does not use. */
const VEHICLE_NAMES = new Map<string, string>([
  ...VEHICLES.map((v) => [v.id, v.name] as [string, string]),
  ...TRAINS.map((v) => [v.id, v.name] as [string, string]),
]);

const BASIS_LABEL: Record<SourceEntry["basis"], MessageKey> = {
  cited: "report.basis.cited",
  documented: "report.basis.documented",
  "educated-guess": "report.basis.guess",
};
const CHECK_LABEL: Record<SourceEntry["check"], MessageKey> = {
  read: "report.check.read",
  secondary: "report.check.secondary",
  unverified: "report.check.unverified",
};

/** Purpose: a mode id as a message key (the library's long_distance_rail is the rail tools' label). */
const modeLabel = (m: string): MessageKey =>
  (m === "long_distance_rail" ? "rail.mode.long_distance_rail" : `mode.${m}`) as MessageKey;

/** Purpose: the generated sources data, loaded once and only when the report is shown. */
let sourcesPromise: Promise<ReportSources> | null = null;
function loadSources(): Promise<ReportSources> {
  sourcesPromise ??= import("./assumptions-report.generated.json").then(
    (m) => (m.default ?? m) as unknown as ReportSources,
    (err: unknown) => {
      sourcesPromise = null;
      throw err;
    },
  );
  return sourcesPromise;
}

/**
 * Purpose: the assumptions report (FR-ASM-04): every assumption library value the project uses, with the
 * library's range, basis, check, sources and reasoning, marked where the project changed it, and the project's
 * other choices. Exported as CSV, or printed (or saved as PDF) through the browser's print dialog.
 * Side effects: loads the sources data when shown; starts a download or opens the print dialog on request.
 */
export function AssumptionsReportSection({
  projectName,
  projectModes,
  preferences,
  currency,
  loadHistory,
}: {
  projectName: string;
  projectModes: readonly string[];
  preferences: PreferencesDoc | null;
  /** The currency the project chose, or null when each tool shows the country's own. */
  currency: string | null;
  /** The project's value history (who changed a value and when), newest first; absent: not shown. */
  loadHistory?: () => Promise<readonly ValueHistoryEntry[]>;
}) {
  const { t, language } = useI18n();
  const groupId = useId();
  const [data, setData] = useState<ReportSources | "loading" | "error">("loading");
  const [group, setGroup] = useState<string>(PARAM_GROUPS[0] ?? "Modes");
  const [changedOnly, setChangedOnly] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [changes, setChanges] = useState<ReadonlyMap<string, LastChange>>(new Map());
  // Who changed each value and when; read again a moment after the preferences change, once they are saved.
  useEffect(() => {
    if (!loadHistory) return;
    let live = true;
    const timer = setTimeout(
      () =>
        loadHistory().then(
          (h) => live && setChanges(lastChanges(h)),
          () => {},
        ),
      1500,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [loadHistory, preferences]);
  useEffect(() => {
    let live = true;
    loadSources().then(
      (d) => live && setData(d),
      () => live && setData("error"),
    );
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    const done = () => setPrinting(false);
    window.addEventListener("afterprint", done);
    return () => window.removeEventListener("afterprint", done);
  }, []);
  const rows = useMemo(
    () => (typeof data === "object" ? reportRows(data, preferences, projectModes) : []),
    [data, preferences, projectModes],
  );
  const shown = changedOnly ? rows.filter((r) => r.changed) : rows;
  const other = otherChoices(preferences, projectModes, VEHICLE_NAMES, currency, RATE_PREF);
  const groupName = (g: string) => (GROUP_LABEL[g] ? t(GROUP_LABEL[g]) : g);
  const sources = typeof data === "object" ? data.sources : {};

  const scope = (r: ReportRow) => {
    if (r.traction) {
      const k = TRACTION_LABEL[r.traction];
      return k ? t(k) : r.traction;
    }
    return r.mode === "*" ? t("prefs.paramsAllModes") : t(modeLabel(r.mode));
  };
  const shownValue = (v: number | string) => (typeof v === "number" ? fmtNum(v) : v);

  const csv = () => {
    const lines: (string | number)[][] = [
      [
        t("report.col.group"),
        t("report.col.parameter"),
        t("report.col.id"),
        t("report.col.mode"),
        t("report.col.value"),
        t("report.col.unit"),
        t("report.col.changed"),
        t("report.col.libLow"),
        t("report.col.libCentral"),
        t("report.col.libHigh"),
        t("report.col.basis"),
        t("report.col.check"),
        t("report.col.sources"),
        t("report.col.reasoning"),
        t("report.col.usedBy"),
        t("report.col.reason"),
        t("report.col.changedBy"),
        t("report.col.changedAt"),
      ],
    ];
    for (const r of shown) {
      const lib = Array.isArray(r.library) ? r.library : ["", r.library, ""];
      lines.push([
        groupName(r.param.group),
        paramLabel(language, r.param.id, r.param.label),
        r.param.id,
        scope(r),
        r.value,
        paramUnit(language, r.param.unit),
        r.changed ? t("report.yes") : t("report.no"),
        lib[0],
        lib[1],
        lib[2],
        r.source ? t(BASIS_LABEL[r.source.basis]) : "",
        r.source ? t(CHECK_LABEL[r.source.check]) : "",
        (r.source?.sources ?? [])
          .map((id) => {
            const s = sources[id];
            return s ? [s.title, s.url].filter(Boolean).join(" ") : id;
          })
          .join("; "),
        r.source?.rationale ?? "",
        r.usedBy.join("; "),
        r.reason,
        (r.changed && changes.get(r.prefId)?.by) || "",
        (r.changed && changes.get(r.prefId)?.at.slice(0, 10)) || "",
      ]);
    }
    lines.push([]);
    for (const [k, v] of otherLines(other)) lines.push([t("report.other"), k, "", "", v]);
    const name = `${projectName.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "project"}-assumptions.csv`;
    download(new Blob(["﻿" + toCsv(lines)], { type: "text/csv;charset=utf-8" }), name);
  };

  /** The other choices as label and value, in the language shown. */
  const otherLines = (o: OtherChoices): [string, string][] => [
    [t("report.currency"), o.currency ?? t("report.currencyCountry")],
    ...(o.currency
      ? ([[t("report.rate"), o.perUsd !== null ? fmtNum(o.perUsd) : t("report.rateWorldBank")]] as [
          string,
          string,
        ][])
      : []),
    [t("report.vehiclesOff"), o.vehiclesOff.length ? o.vehiclesOff.join("; ") : t("report.allUsed")],
    [t("report.switchesOff"), o.switchesOff.length ? o.switchesOff.join("; ") : t("report.allUsed")],
    ...o.turnouts.map(
      (x) =>
        [
          `${t("report.turnout")} · ${t(modeLabel(x.mode))}`,
          x.changed ? `${x.turnout} (${t("report.changed")})` : x.turnout,
        ] as [string, string],
    ),
  ];

  const print = () => {
    flushSync(() => setPrinting(true));
    window.print();
  };

  const list = (groupRows: ReportRow[]) => (
    <ul className="m-0 list-none p-0">
      {groupRows.map((r) => (
        <ReportLine
          key={`${r.param.id}|${r.mode}|${r.traction ?? ""}`}
          row={r}
          scope={scope(r)}
          last={r.changed ? changes.get(r.prefId) : undefined}
        >
          {shownValue(r.value)}
        </ReportLine>
      ))}
    </ul>
  );
  const groupRows = shown.filter((r) => r.param.group === group);
  const date = new Date().toLocaleDateString(undefined, { dateStyle: "long" });
  return (
    <section
      aria-labelledby="pp-report"
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 md:p-6"
    >
      <h2 id="pp-report" className="caps m-0">
        {t("report.title")}
      </h2>
      <p className="mt-1 text-sm text-slate-600">{t("report.intro")}</p>
      {data === "loading" && <p className="mt-3 text-sm text-slate-500">{t("common.loading")}</p>}
      {data === "error" && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {t("report.loadError")}
        </p>
      )}
      {typeof data === "object" && (
        <SourcesContext.Provider value={sources}>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn" onClick={csv}>
              {t("report.csv")}
            </button>
            <button type="button" className="btn" onClick={print}>
              {t("print.title")}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-end gap-x-4">
            <div className="min-w-56 flex-1">
              <label className="mt-2 mb-1.5 block font-semibold" htmlFor={groupId}>
                {t("prefs.paramsGroup")}
              </label>
              <div className="field">
                <select id={groupId} value={group} onChange={(e) => setGroup(e.target.value)}>
                  {PARAM_GROUPS.map((g) => {
                    const n = new Set(
                      rows.filter((r) => r.param.group === g && r.changed).map((r) => r.param.id),
                    ).size;
                    return (
                      <option key={g} value={g}>
                        {groupName(g)}
                        {n ? ` · ${t("prefs.rulesChanged", { count: n })}` : ""}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>
            <label className="flex min-h-11 items-center gap-2.5">
              <input
                type="checkbox"
                className="h-4 w-4 accent-blue-700"
                checked={changedOnly}
                onChange={(e) => setChangedOnly(e.target.checked)}
              />
              {t("report.changedOnly")}
            </label>
          </div>
          <div className="mt-2 max-h-[36rem] overflow-y-auto pe-1">
            {groupRows.length ? (
              list(groupRows)
            ) : (
              <p className="mt-3 text-sm text-slate-500">{t("report.noneChanged")}</p>
            )}
          </div>
          <h3 className="mt-5 mb-1 font-semibold">{t("report.other")}</h3>
          <OtherList lines={otherLines(other)} />
          {printing &&
            createPortal(
              <div className="print-report hidden bg-white p-0 text-slate-900">
                <header className="mb-4 border-b border-slate-300 pb-2">
                  <h1 className="text-2xl font-semibold">{projectName}</h1>
                  <p className="text-sm text-slate-600">
                    {t("report.title")} · {date}
                    {changedOnly ? ` · ${t("report.changedOnly")}` : ""}
                  </p>
                </header>
                {PARAM_GROUPS.map((g) => {
                  const gr = shown.filter((r) => r.param.group === g);
                  return gr.length ? (
                    <section key={g} className="mb-4">
                      <h2 className="mb-1 text-lg font-semibold">{groupName(g)}</h2>
                      {list(gr)}
                    </section>
                  ) : null;
                })}
                <section className="mb-4 break-inside-avoid">
                  <h2 className="mb-1 text-lg font-semibold">{t("report.other")}</h2>
                  <OtherList lines={otherLines(other)} />
                </section>
              </div>,
              document.body,
            )}
        </SourcesContext.Provider>
      )}
    </section>
  );
}

/** Purpose: a time as a date in the viewer's language. */
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

const SourcesContext = createContext<Record<string, ReportSources["sources"][string]>>({});

/** Purpose: one line of the report: parameter and scope, value, library range, basis, sources and reasoning. */
function ReportLine({
  row: r,
  scope,
  last,
  children,
}: {
  row: ReportRow;
  scope: string;
  /** Who last changed the value and when, when known. */
  last?: LastChange;
  children: ReactNode;
}) {
  const { t, language } = useI18n();
  const sources = useContext(SourcesContext);
  const unit = paramUnit(language, r.param.unit);
  const lib = r.library;
  const library = Array.isArray(lib)
    ? lib[0] !== lib[2]
      ? t("prefs.rulesLibraryRange", {
          value: isolate(fmtNum(lib[1])),
          low: isolate(fmtNum(lib[0])),
          high: isolate(fmtNum(lib[2])),
          unit: isolate(unit),
        })
      : t("prefs.rulesLibrary", { value: isolate(fmtNum(lib[1])), unit: isolate(unit) })
    : t("prefs.rulesLibrary", { value: isolate(String(lib)), unit: isolate(unit) });
  // A unit cost the project set outside the library's range is flagged, as in the cost tables.
  const outside =
    r.param.group === "Cost" &&
    r.changed &&
    Array.isArray(lib) &&
    typeof r.value === "number" &&
    outsideLibraryRange(r.value, lib);
  return (
    <li className="break-inside-avoid border-t border-slate-100 py-2.5 first:border-t-0">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="min-w-48 flex-1 font-semibold">
          {paramLabel(language, r.param.id, r.param.label)}{" "}
          <span className="font-normal text-slate-500">· {scope}</span>
        </span>
        <span className="tabular-nums">
          <bdi>{children}</bdi> <bdi>{unit}</bdi>
        </span>
        {r.changed && (
          <span className="rounded bg-amber-100 px-1.5 text-xs font-semibold text-amber-900">
            {t("report.changed")}
          </span>
        )}
        {outside && (
          <span className="rounded bg-red-100 px-1.5 text-xs font-semibold text-red-900">
            ⚠ {t("cost.outsideRange", { low: fmtNum(lib[0]), high: fmtNum(lib[2]) })}
          </span>
        )}
      </div>
      <div className="mt-0.5 flex flex-wrap gap-x-2 text-sm text-slate-600">
        <span>{library}</span>
        {r.fromAll && <span>· {t("prefs.paramsFromAll")}</span>}
        {r.source && (
          <span>
            · {t(BASIS_LABEL[r.source.basis])} · {t(CHECK_LABEL[r.source.check])}
          </span>
        )}
      </div>
      {(last || r.reason) && (
        <div className="mt-0.5 text-sm text-amber-900">
          {last &&
            (last.by
              ? t("report.changedBy", { name: last.by, date: fmtDate(last.at) })
              : t("report.changedOn", { date: fmtDate(last.at) }))}
          {last && r.reason && " · "}
          {r.reason && t("report.reason", { reason: r.reason })}
        </div>
      )}
      {r.source && r.source.sources.length > 0 && (
        <div className="mt-0.5 text-sm text-slate-600">
          {t("report.sources")}{" "}
          {r.source.sources.map((id, i) => {
            const s = sources[id];
            return (
              <span key={id}>
                {i > 0 && "; "}
                {s?.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer" className="text-blue-700 underline">
                    {s.title}
                  </a>
                ) : (
                  (s?.title ?? id)
                )}
              </span>
            );
          })}
        </div>
      )}
      {r.source?.rationale && <p className="mt-0.5 mb-0 text-sm text-slate-500">{r.source.rationale}</p>}
      {r.usedBy.length > 0 && (
        <p className="mt-0.5 mb-0 text-xs text-slate-500">
          {t("report.usedBy", { list: r.usedBy.join(", ") })}
        </p>
      )}
    </li>
  );
}

/** Purpose: the project's other choices as a list of label and value. */
function OtherList({ lines }: { lines: [string, string][] }) {
  return (
    <dl className="m-0 text-sm">
      {lines.map(([k, v]) => (
        <div key={k} className="flex flex-wrap gap-x-3 border-t border-slate-100 py-2 first:border-t-0">
          <dt className="min-w-48 flex-1 font-semibold">{k}</dt>
          <dd className="m-0 flex-[2]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
