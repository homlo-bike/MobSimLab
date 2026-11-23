import { useState } from "react";
import { card, num, td, th } from "../../features/costs/CostTables";
import { useI18n } from "../../i18n/i18n";
import { componentCalculations, type Plugin, type PluginCalculation } from "../registry";
import { pluginRuntime } from "./context";
import { calculationInput, type PluginOutput, type PluginProjectData, readOutput } from "./inputs";
import { runPluginCode, type WorkerFactory } from "./runtime";
import { engineErrorText } from "../../i18n/engine";

type Calc = PluginCalculation & { plugin: Plugin };

/**
 * Purpose: run an installed plugin's calculation on the project's data in the browser sandbox.
 * Output: the checked output, or throws Error with the plugin's message.
 */
export async function runCalculation(
  calc: Calc,
  data: PluginProjectData,
  options: unknown = {},
  createWorker?: WorkerFactory,
): Promise<{ output: PluginOutput; logs: [string, string][] }> {
  const rt = pluginRuntime();
  if (!rt.projectId || !calc.component) throw new Error("no project is open");
  const r = await runPluginCode(
    {
      projectId: rt.projectId,
      pluginId: calc.plugin.id,
      component: calc.component,
      world: "calculation",
      id: calc.id,
      input: calculationInput(calc.plugin, calc, data, options),
      limits: rt.limits,
    },
    createWorker,
  );
  if (!r.ok) throw new Error(r.error);
  if (typeof r.value !== "string") throw new Error("the plugin returned no text");
  return { output: readOutput(r.value), logs: r.logs };
}

/** Purpose: a calculation's output as KPI tiles, findings and a table. Text is shown as text. */
export function PluginOutputView({ output }: { output: PluginOutput }) {
  const { t } = useI18n();
  return (
    <div className="mt-3 space-y-3">
      {output.kpis && output.kpis.length > 0 && (
        <dl className="m-0 flex flex-wrap gap-4">
          {output.kpis.map((k) => (
            <div key={k.id || k.label}>
              <dt className="caps">{k.label}</dt>
              <dd className="m-0 text-xl font-semibold tabular-nums">
                {k.value === null ? "–" : String(k.value)}
                {k.unit ? ` ${k.unit}` : ""}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {output.findings && output.findings.length > 0 && (
        <ul className="m-0 list-none space-y-1 p-0 text-sm">
          {output.findings.map((f, i) => (
            <li
              key={i}
              className={
                f.level === "error"
                  ? "text-red-700"
                  : f.level === "warning"
                    ? "text-amber-700"
                    : "text-slate-700"
              }
            >
              {f.message}
              {f.rule ? <span className="text-slate-500"> ({f.rule})</span> : null}
            </li>
          ))}
        </ul>
      )}
      {output.table && (
        <div className="overflow-x-auto">
          {output.table.rows.length === 0 ? (
            <p className="text-sm text-slate-500">{t("pcode.noRows")}</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  {output.table.columns.map((c, i) => (
                    <th key={i} className={th}>
                      {c.unit ? `${c.label} (${c.unit})` : c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {output.table.rows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    {r.map((v, j) => (
                      <td key={j} className={typeof v === "number" ? num : td}>
                        {v === null || v === undefined ? "–" : String(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Purpose: the Tables tab's section for installed plugins' calculations (`where: tables`): one card each with a
 * Calculate button, its output and the plugin's log. Renders nothing when no such calculation is on.
 * Inputs: the project's data the calculations may be given; `createWorker` for tests.
 */
export function PluginCalculations({
  data,
  createWorker,
}: {
  data: PluginProjectData;
  createWorker?: WorkerFactory;
}) {
  const { t } = useI18n();
  const calcs = componentCalculations("tables");
  const [state, setState] = useState<
    Record<string, { busy?: boolean; output?: PluginOutput; error?: string; logs?: [string, string][] }>
  >({});
  if (calcs.length === 0) return null;
  const key = (c: Calc) => `${c.plugin.id}/${c.id}`;
  const run = async (c: Calc) => {
    setState((s) => ({ ...s, [key(c)]: { busy: true } }));
    try {
      const r = await runCalculation(c, data, {}, createWorker);
      setState((s) => ({ ...s, [key(c)]: { output: r.output, logs: r.logs } }));
    } catch (e) {
      setState((s) => ({ ...s, [key(c)]: { error: engineErrorText(e) } }));
    }
  };
  return (
    <section aria-labelledby="plugin-calcs" className={card}>
      <h2 id="plugin-calcs" className="m-0 text-lg font-semibold">
        {t("pcode.title")}
      </h2>
      <p className="mt-1 text-sm text-slate-600">{t("pcode.intro")}</p>
      {calcs.map((c) => {
        const s = state[key(c)] ?? {};
        return (
          <article key={key(c)} className="mt-4 border-t border-slate-200 pt-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h3 className="m-0 text-base font-semibold">{c.label}</h3>
                <p className="m-0 text-xs text-slate-500">
                  {t("pcode.by", { plugin: c.plugin.name, publisher: c.plugin.publisher.name })}
                </p>
                {c.description && <p className="m-0 mt-1 text-sm text-slate-600">{c.description}</p>}
              </div>
              <button type="button" className="btn" disabled={s.busy} onClick={() => void run(c)}>
                {s.busy ? t("pcode.running") : t("pcode.run")}
              </button>
            </div>
            {s.error && (
              <p role="alert" className="mt-2 text-sm text-red-700">
                {t("pcode.failed", { plugin: c.plugin.name, error: s.error })}
              </p>
            )}
            {s.output && <PluginOutputView output={s.output} />}
            {s.logs && s.logs.length > 0 && (
              <details className="mt-2 text-xs text-slate-500">
                <summary>{t("pcode.log", { count: s.logs.length })}</summary>
                <pre className="m-0 whitespace-pre-wrap">
                  {s.logs.map(([l, m]) => `${l}: ${m}`).join("\n")}
                </pre>
              </details>
            )}
          </article>
        );
      })}
    </section>
  );
}
