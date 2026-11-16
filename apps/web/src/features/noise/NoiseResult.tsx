import { formatInt, useI18n } from "../../i18n/i18n";
import { download } from "../schematic/export";
import { DIFFERENCE, differenceClass, exposureRows } from "./difference";
import { contoursGeoJson, csv, type ExportClass } from "./export";
import { LEGEND } from "./mapLayer";
import { type Done, FROM_DB } from "./result";
import type { Indicator, NoiseExposure } from "./types";

const NAMES: Record<Indicator, string> = { lden: "L_den", lnight: "L_night" };

/** Purpose: a people count as the Directive reports it, rounded to the nearest hundred above 100. */
export function peopleText(n: number): string {
  return formatInt(n >= 100 ? Math.round(n / 100) * 100 : n);
}

/** Purpose: a change with its sign, "+3", "−12", "0". */
function signed(n: number, text: (n: number) => string): string {
  if (n > 0) return `+${text(n)}`;
  if (n < 0) return `−${text(-n)}`;
  return "0";
}

/** Purpose: a file name part from a scenario name. */
function slug(s: string): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "scenario"
  );
}

/** The bands of the noise map from the lowest shown, as export classes. */
function bandClasses(indicator: Indicator): ExportClass[] {
  const bands = LEGEND.filter((l) => l.from_db >= FROM_DB[indicator]);
  return bands.map((b, i) => {
    const to = bands[i + 1]?.from_db ?? null;
    return {
      test: (v: number) => v >= b.from_db && (to === null || v < to),
      properties: { from_db: b.from_db, to_db: to },
    };
  });
}

/** The classes of the difference map that are drawn, as export classes. */
function differenceClasses(): ExportClass[] {
  return DIFFERENCE.flatMap((c, i) =>
    c.color
      ? [
          {
            test: (v: number) => differenceClass(v) === i,
            properties: { change_from_db: c.from_db, change_to_db: DIFFERENCE[i + 1]?.from_db ?? null },
          },
        ]
      : [],
  );
}

/**
 * Purpose: the noise map's result in the side panel: the legend with the input level, buildings and residents
 * per band (in both scenarios and the change when comparing), notes, and the exports: contours as GeoJSON and
 * the table as CSV.
 * Side effects: the export buttons start downloads.
 */
export function NoiseResult({ result, indicator }: { result: Done; indicator: Indicator }) {
  const { t } = useI18n();
  const { main, other, difference } = result;
  const exposure = main.view.buildings ?? null;
  const otherExposure = other?.view.buildings ?? null;
  const rows = exposure ? exposure[indicator] : null;
  const compared = !!(difference && other);
  const levelText = t(`noise.level.${main.view.input_level ?? result.level}`);
  const band = (from: number, i: number, n: number) =>
    i === n - 1 ? t("noise.dbOrMore", { db: from }) : t("noise.dbRange", { from, to: from + 4 });

  function exportContours() {
    const img = main.view.image;
    if (!img) return;
    const values = compared ? difference!.levels[indicator] : main.levels?.[indicator];
    if (!values) return;
    const fc = contoursGeoJson(
      { values, width: img.width, height: img.height, corners: img.coordinates },
      compared ? differenceClasses() : bandClasses(indicator),
      {
        indicator: NAMES[indicator],
        scenario: main.name,
        compared_to: compared ? other!.name : null,
        input_level: main.view.input_level ?? result.level,
      },
    );
    const name = compared ? `${slug(main.name)}-vs-${slug(other!.name)}` : slug(main.name);
    download(
      new Blob([JSON.stringify(fc)], { type: "application/geo+json" }),
      `noise-${name}-${NAMES[indicator].replace("_", "")}.geojson`,
    );
  }

  function exportTable() {
    if (!exposure) return;
    const level = main.view.input_level ?? result.level;
    const header = compared
      ? [
          "indicator",
          "band_from_db",
          "band_to_db",
          "buildings",
          "buildings_compared",
          "buildings_change",
          "residents",
          "residents_compared",
          "residents_change",
          "input_level",
          "scenario",
          "compared_to",
        ]
      : ["indicator", "band_from_db", "band_to_db", "buildings", "residents", "input_level", "scenario"];
    const out: (string | number | null)[][] = [];
    for (const ind of ["lden", "lnight"] as const) {
      const bands = exposure[ind].from_db;
      const to = (i: number) => bands[i + 1] ?? null;
      if (compared && otherExposure)
        exposureRows(exposure, otherExposure, ind).forEach((r, i) =>
          out.push([
            NAMES[ind],
            r.from_db,
            to(i),
            r.buildings[0],
            r.buildings[1],
            r.buildings[0] - r.buildings[1],
            r.people?.[0] ?? null,
            r.people?.[1] ?? null,
            r.people ? r.people[0] - r.people[1] : null,
            level,
            main.name,
            other!.name,
          ]),
        );
      else
        bands.forEach((from, i) =>
          out.push([
            NAMES[ind],
            from,
            to(i),
            exposure[ind].buildings[i] ?? 0,
            exposure.people ? (exposure[ind].people[i] ?? 0) : null,
            level,
            main.name,
          ]),
        );
    }
    const name = compared ? `${slug(main.name)}-vs-${slug(other!.name)}` : slug(main.name);
    download(new Blob([csv(header, out)], { type: "text/csv" }), `noise-table-${name}.csv`);
  }

  return (
    <>
      <p className="text-xs text-slate-600">
        {compared
          ? t("noise.comparing", { name: main.name, other: other!.name, level: levelText })
          : t("noise.inputUsed", { name: main.name, level: levelText })}
      </p>
      <div
        className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600"
        aria-label={t("noise.mapLegend")}
      >
        {compared
          ? DIFFERENCE.map((c, i) =>
              c.color ? (
                <span key={i} className="flex items-center gap-1">
                  <span
                    className="inline-block h-3 w-3 rounded-sm border border-slate-300"
                    style={{ background: c.color }}
                  />
                  {differenceLabel(i)}
                </span>
              ) : null,
            )
          : LEGEND.filter((l) => l.from_db >= FROM_DB[indicator]).map((l) => (
              <span key={l.from_db} className="flex items-center gap-1">
                <span
                  className="inline-block h-3 w-3 rounded-sm border border-slate-300"
                  style={{ background: l.color }}
                />
                {l.from_db}
              </span>
            ))}
        <span>dB</span>
      </div>
      {compared && <p className="text-xs text-slate-500">{t("noise.differenceNote")}</p>}
      {exposure && rows && compared && otherExposure && (
        <ComparisonTable
          exposure={exposure}
          other={otherExposure}
          indicator={indicator}
          names={[main.name, other!.name]}
          band={band}
        />
      )}
      {exposure && rows && !compared && (
        <table className="w-full text-xs" aria-label={t("noise.table")}>
          <caption className="pb-1 text-start text-slate-600">
            {t("noise.tableCaption", { reached: exposure.reached, count: exposure.count })}
          </caption>
          <thead>
            <tr className="text-start text-slate-500">
              <th className="font-normal">{NAMES[indicator]}</th>
              <th className="text-end font-normal">{t("noise.buildings")}</th>
              {exposure.people && <th className="text-end font-normal">{t("noise.residents")}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.from_db.map((from, i) => (
              <tr key={from} className="border-t border-slate-100">
                <td>{band(from, i, rows.from_db.length)}</td>
                <td className="text-end tabular-nums">{rows.buildings[i]}</td>
                {exposure.people && (
                  <td className="text-end tabular-nums">{peopleText(rows.people[i] ?? 0)}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {exposure?.people && (
        <p className="text-xs text-slate-600">
          {exposure.people.source === "grid" && result.people && result.people.id?.startsWith("layer:")
            ? t("noise.popLayer", {
                name: result.people.name,
                year: result.people.year ?? "–",
                reached: peopleText(exposure.people.reached),
                total: peopleText(exposure.people.total),
              })
            : exposure.people.source === "grid" && result.people
              ? t("noise.popGrid", {
                  year: result.people.year ?? "",
                  countries: result.people.countries.join(", "),
                  reached: peopleText(exposure.people.reached),
                  total: peopleText(exposure.people.total),
                })
              : t("noise.popSize", {
                  reached: peopleText(exposure.people.reached),
                  total: peopleText(exposure.people.total),
                })}
          {exposure.people.source === "grid" && exposure.people.unplaced >= 1
            ? ` ${t("noise.popUnplaced", { n: peopleText(exposure.people.unplaced) })}`
            : ""}{" "}
          {t("noise.popNoHomes")}
        </p>
      )}
      {result.notes.map((n) => (
        <p key={n} className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
          {n}
        </p>
      ))}
      <p className="text-xs text-slate-500">
        {t("noise.mapNote")} {t(main.view.terrain ? "noise.onTerrain" : "noise.flat")}
        {result.people
          ? ` ${
              result.people.id?.startsWith("layer:")
                ? t("noise.popLayerCredit", { name: result.people.name, licence: result.people.licence })
                : t("noise.popCredit")
            }`
          : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn min-h-10 flex-1"
          disabled={!main.view.image || !(compared ? difference : main.levels)}
          onClick={exportContours}
        >
          {t("noise.exportContours")}
        </button>
        <button type="button" className="btn min-h-10 flex-1" disabled={!exposure} onClick={exportTable}>
          {t("noise.exportTable")}
        </button>
      </div>
    </>
  );

  /** Purpose: a difference class as text, "−10 to −5 dB", "10 dB or more louder". */
  function differenceLabel(i: number): string {
    const from = DIFFERENCE[i]!.from_db;
    const to = DIFFERENCE[i + 1]?.from_db ?? null;
    const n = (x: number) => signed(x, (y) => formatInt(y));
    if (from === null && to !== null) return t("noise.changeBelow", { db: n(to) });
    if (to === null && from !== null) return t("noise.changeAbove", { db: n(from) });
    return t("noise.changeRange", { from: n(from!), to: n(to!) });
  }
}

/** Purpose: buildings and residents per band in both scenarios compared, and the change. */
function ComparisonTable({
  exposure,
  other,
  indicator,
  names,
  band,
}: {
  exposure: NoiseExposure;
  other: NoiseExposure;
  indicator: Indicator;
  names: [string, string];
  band: (from: number, i: number, n: number) => string;
}) {
  const { t } = useI18n();
  const rows = exposureRows(exposure, other, indicator);
  const people = rows.every((r) => r.people);
  const value = (r: (typeof rows)[number], k: 0 | 1) =>
    people ? peopleText(r.people![k]) : formatInt(r.buildings[k]);
  const change = (r: (typeof rows)[number]) =>
    people
      ? signed(r.people![0] - r.people![1], (x) => peopleText(x))
      : signed(r.buildings[0] - r.buildings[1], (x) => formatInt(x));
  return (
    <table className="w-full text-xs" aria-label={t("noise.comparisonTable")}>
      <caption className="pb-1 text-start text-slate-600">
        {t(people ? "noise.comparisonCaptionPeople" : "noise.comparisonCaptionBuildings")}
      </caption>
      <thead>
        <tr className="text-start text-slate-500">
          <th className="font-normal">{NAMES[indicator]}</th>
          <th className="text-end font-normal">{names[0]}</th>
          <th className="text-end font-normal">{names[1]}</th>
          <th className="text-end font-normal">{t("noise.change")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.from_db} className="border-t border-slate-100">
            <td>{band(r.from_db, i, rows.length)}</td>
            <td className="text-end tabular-nums">{value(r, 0)}</td>
            <td className="text-end tabular-nums">{value(r, 1)}</td>
            <td className="text-end tabular-nums">{change(r)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
