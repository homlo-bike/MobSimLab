import { useMemo } from "react";
import { useI18n } from "../../i18n/i18n";
import { type StreetLinesDoc, unroutedParts } from "../street-lines/saved";

// The cost tables' cell styles and number format, kept here so the notice does not load the cost tables with it.
const th = "px-2 py-1.5 text-left font-medium";
const td = "px-2 py-1.5 align-top";
const num = "px-2 py-1.5 text-right align-top tabular-nums whitespace-nowrap";
const km = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

/**
 * A warning above the Tables groups: street lines whose saved route has legs or depot runs that were not found.
 * Tables, costs and the appraisal read the saved route, where such a part counts 0 m; the warning names the lines,
 * how many parts are missing and the straight-line distance they leave out at least. Nothing when every route is
 * complete.
 */
export function UnroutedNotice({ streetLines }: { streetLines: StreetLinesDoc | null | undefined }) {
  const { t } = useI18n();
  const rows = useMemo(
    () =>
      (streetLines?.lines ?? []).flatMap((l, i) => {
        if (l.view.points.length < 2) return [];
        const parts = unroutedParts(l.view);
        return parts
          ? [{ key: l.id ?? String(i), name: l.name || t("tbl.streetLineName", { n: i + 1 }), parts }]
          : [];
      }),
    [streetLines, t],
  );
  if (!rows.length) return null;
  return (
    <section
      role="note"
      aria-labelledby="unrouted-title"
      className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
    >
      <h2 id="unrouted-title" className="m-0 text-base font-semibold">
        {t("tbl.unrouted.title")}
      </h2>
      <p className="mt-1 max-w-3xl">{t("tbl.unrouted.intro")}</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[30rem]">
          <thead>
            <tr className="border-b border-amber-200">
              <th className={th}>{t("tbl.line")}</th>
              <th className={`${th} text-right`}>{t("tbl.unrouted.legs")}</th>
              <th className={`${th} text-right`}>{t("tbl.unrouted.runs")}</th>
              <th className={`${th} text-right`}>{t("tbl.unrouted.leftOut")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-amber-100 last:border-0">
                <td className={td}>{r.name}</td>
                <td className={num}>{r.parts.legs}</td>
                <td className={num}>{r.parts.depotRuns}</td>
                <td className={num}>{t("tbl.u.km", { v: km.format(r.parts.straightM / 1000) })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
