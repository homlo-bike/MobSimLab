import type { Plugin, PluginCalculation } from "../registry";

/**
 * The project's data a plugin calculation may be given (ADR-0036 §5), assembled by the app, never fetched by the
 * plugin. Only the kinds the calculation declares and the plugin's permissions allow are passed in.
 */
export interface PluginProjectData {
  /** The published network: every line of the project as a published timetable. */
  timetable: unknown;
  /** The street line tool's lines. */
  streetLines: unknown;
}

/** Which permission each input kind needs (as in the API's install check). */
const NEEDS: Record<string, string> = {
  network: "read:network",
  street_lines: "read:network",
  rail_design: "read:network",
  timetable: "read:timetable",
  fleet: "read:fleet",
  geodata: "read:geodata",
};

/**
 * Purpose: the JSON input of one calculation call: `{ inputs, parameters, options }`.
 * Inputs: the plugin, the calculation, the project's data and the caller's options. Input kinds this version of
 * the app cannot give yet (network, rail_design, fleet, geodata) are passed as null.
 */
export function calculationInput(
  plugin: Plugin,
  calc: PluginCalculation,
  data: PluginProjectData,
  options: unknown = {},
): string {
  const inputs: Record<string, unknown> = {};
  for (const kind of calc.inputs) {
    const need = NEEDS[kind];
    if (need && !plugin.permissions.includes(need)) continue;
    inputs[kind] = kind === "timetable" ? data.timetable : kind === "street_lines" ? data.streetLines : null;
  }
  const parameters = calc.inputs.includes("parameters") ? plugin.defaults : {};
  return JSON.stringify({ inputs, parameters, options });
}

/** A table, KPIs and findings as a calculation returns them (contracts/plugin-output.schema.json). */
export interface PluginOutput {
  table?: { columns: { id: string; label: string; unit?: string }[]; rows: unknown[][] };
  kpis?: { id: string; label: string; value: unknown; unit?: string }[];
  findings?: { level: string; message: string; rule?: string }[];
}

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");

/**
 * Purpose: read a calculation's JSON answer defensively: keep only well-formed tables, KPIs and findings, cut
 * long text, and refuse anything that is not an object. Throws Error with a message for the person.
 */
export function readOutput(text: string): PluginOutput {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new Error("the plugin did not return JSON");
  }
  if (typeof v !== "object" || v === null || Array.isArray(v))
    throw new Error("the plugin returned no result");
  const o = v as Record<string, unknown>;
  const out: PluginOutput = {};
  const t = o.table as { columns?: unknown; rows?: unknown } | undefined;
  if (t && Array.isArray(t.columns) && Array.isArray(t.rows))
    out.table = {
      columns: t.columns.slice(0, 50).map((c: Record<string, unknown>) => ({
        id: str(c?.id),
        label: str(c?.label, 100),
        ...(typeof c?.unit === "string" ? { unit: str(c.unit, 30) } : {}),
      })),
      rows: t.rows
        .slice(0, 10_000)
        .filter(Array.isArray)
        .map((r: unknown[]) =>
          r
            .slice(0, 50)
            .map((x) => (typeof x === "object" && x !== null ? JSON.stringify(x).slice(0, 200) : x)),
        ),
    };
  if (Array.isArray(o.kpis))
    out.kpis = o.kpis.slice(0, 50).map((k: Record<string, unknown>) => ({
      id: str(k?.id),
      label: str(k?.label, 100),
      value: typeof k?.value === "number" || typeof k?.value === "string" ? k.value : null,
      ...(typeof k?.unit === "string" ? { unit: str(k.unit, 30) } : {}),
    }));
  if (Array.isArray(o.findings))
    out.findings = o.findings.slice(0, 1000).map((f: Record<string, unknown>) => ({
      level: ["ok", "warning", "error"].includes(f?.level as string) ? (f.level as string) : "warning",
      message: str(f?.message, 500),
      ...(typeof f?.rule === "string" ? { rule: str(f.rule) } : {}),
    }));
  return out;
}
