/**
 * The assumptions report (FR-ASM-04): every assumption library value the project uses, where it comes from and
 * whether the project changed it, plus the project's other choices (currency, vehicles, switches, default
 * turnouts). Pure functions; the Preferences section renders them and exports them as CSV or for printing.
 */
import {
  CATALOGUE_SWITCHES,
  choiceValue,
  LIBRARY_DEFAULT_TURNOUT,
  LIBRARY_PARAMS,
  type LibraryParam,
  paramLibrary,
  paramPrefId,
  type PreferencesDoc,
  prefValue,
  reasonOf,
  switchChoiceFrom,
  vehiclesOffFrom,
} from "./preferences";

/** Where one library entry comes from (tools/assumptions-report/export_sources.py). */
export interface SourceEntry {
  basis: "cited" | "documented" | "educated-guess";
  check: "read" | "secondary" | "unverified";
  sources: string[];
  rationale: string;
}

/** One cited document of the source register. */
export interface Source {
  title: string;
  publisher: string;
  url: string;
  access: string;
}

/** The generated sources data: per parameter, the entry that applies for each mode and traction. */
export interface ReportSources {
  sources: Record<string, Source>;
  params: Record<
    string,
    {
      used_by: string[];
      entries: SourceEntry[];
      modes: Record<string, number>;
      traction?: Record<string, number>;
    }
  >;
}

/** Project mode ids that the library knows by another id. */
const LIBRARY_MODE_OF: Record<string, string> = { intercity_rail: "long_distance_rail" };

/** Modes the assumption library knows (tools/assumptions/check.py MODES). */
const LIBRARY_MODES = [
  "bus",
  "brt",
  "trolleybus",
  "intercity_bus",
  "tram",
  "light_rail",
  "metro",
  "commuter_rail",
  "regional_rail",
  "long_distance_rail",
  "high_speed_rail",
];

/** One line of the report: a parameter's value for every mode ("*"), one mode, or one traction. */
export interface ReportRow {
  param: LibraryParam;
  /** "*" for every mode, else the library mode id; with `traction`, "*". */
  mode: string;
  traction?: string;
  /** The value the project's tools use. */
  value: number | string;
  /** The library's [low, central, high] (numbers) or value (enum, text). */
  library: [number, number, number] | string;
  /** Whether the project set its own value. */
  changed: boolean;
  /** For a mode line: the value comes from the project's value for every mode. */
  fromAll: boolean;
  /** The preference id whose value applies when changed (the mode's, the traction's or every mode's). */
  prefId: string;
  /** Why the project changed the value, or "" when no reason was given. */
  reason: string;
  /** Where the library's value comes from; null when the sources data has no entry. */
  source: SourceEntry | null;
  usedBy: string[];
}

/** Purpose: the library modes of a project's modes (intercity_rail is long_distance_rail), in library order. */
export function reportModes(projectModes: readonly string[]): string[] {
  const own = new Set(projectModes.map((m) => LIBRARY_MODE_OF[m] ?? m));
  return LIBRARY_MODES.filter((m) => own.has(m));
}

/**
 * Purpose: the report's lines: for each library parameter, its value for every mode, one line per mode the
 * project uses, and one per traction that has its own library entry.
 * Inputs: the sources data, the project's preferences and its modes (project ids).
 */
export function reportRows(
  data: ReportSources,
  doc: PreferencesDoc | null | undefined,
  projectModes: readonly string[],
): ReportRow[] {
  const modes = reportModes(projectModes);
  const rows: ReportRow[] = [];
  for (const p of LIBRARY_PARAMS) {
    const src = data.params[p.id];
    const entry = (i: number | undefined) => (i === undefined ? null : (src?.entries[i] ?? null));
    const isNumber = p.kind === "number";
    const own = (id: string) => (isNumber ? prefValue(doc, id) : choiceValue(doc, id));
    const central = (lib: [number, number, number] | string) => (Array.isArray(lib) ? lib[1] : lib);
    const all = own(paramPrefId(p.id, "*"));
    const line = (mode: string, traction?: string): ReportRow => {
      const lib = paramLibrary(p, mode, traction);
      const mine = mode === "*" && !traction ? all : own(paramPrefId(p.id, mode, traction));
      const fromAll = mine === undefined && mode !== "*" && !traction && all !== undefined;
      const used = mine ?? (fromAll ? all : undefined);
      const id = fromAll ? paramPrefId(p.id, "*") : paramPrefId(p.id, mode, traction);
      return {
        param: p,
        mode,
        traction,
        value: used ?? central(lib),
        library: lib,
        changed: used !== undefined,
        fromAll,
        prefId: id,
        reason: used !== undefined ? reasonOf(doc, id) : "",
        source: entry(traction ? src?.traction?.[traction] : (src?.modes[mode] ?? src?.modes["*"])),
        usedBy: src?.used_by ?? [],
      };
    };
    rows.push(line("*"));
    for (const m of modes) rows.push(line(m));
    for (const tr of Object.keys(p.traction ?? {})) rows.push(line("*", tr));
  }
  return rows;
}

/** The project's choices besides library values. */
export interface OtherChoices {
  /** ISO code, or null when each tool shows the country's own currency. */
  currency: string | null;
  /** The project's own exchange rate (units per US$), or null for the World Bank's. */
  perUsd: number | null;
  /** Catalogue vehicles the project does not use, by name. */
  vehiclesOff: string[];
  /** Catalogue switches the project does not use, by name. */
  switchesOff: string[];
  /** Default turnout per rail mode the project uses (library mode id), the project's or the library's. */
  turnouts: { mode: string; turnout: string; changed: boolean }[];
}

/**
 * Purpose: the project's other choices.
 * Inputs: the preferences, the project's modes, and the catalogue vehicle names by id.
 */
export function otherChoices(
  doc: PreferencesDoc | null | undefined,
  projectModes: readonly string[],
  vehicleNames: ReadonlyMap<string, string>,
  currency: string | null,
  ratePref: string,
): OtherChoices {
  const sw = switchChoiceFrom(doc);
  const label = (id: string) => CATALOGUE_SWITCHES.find((s) => s.id === id)?.label ?? id;
  const turnouts = reportModes(projectModes)
    .filter((m) => LIBRARY_DEFAULT_TURNOUT[m] || sw.default_turnout[m])
    .map((m) => {
      const own = sw.default_turnout[m];
      return { mode: m, turnout: label(own ?? LIBRARY_DEFAULT_TURNOUT[m] ?? ""), changed: own !== undefined };
    });
  return {
    currency,
    perUsd: currency ? (prefValue(doc, ratePref) ?? null) : null,
    vehiclesOff: [...vehiclesOffFrom(doc)].map((id) => vehicleNames.get(id) ?? id).sort(),
    switchesOff: sw.off.map(label).sort(),
    turnouts,
  };
}

/** Purpose: a number as the report shows it (up to six significant digits). */
export const fmtNum = (v: number) => String(Number(v.toPrecision(6)));

/** Purpose: one CSV field, quoted when it holds a comma, quote or line break (RFC 4180). */
export function csvField(v: string | number): string {
  const s = typeof v === "number" ? fmtNum(v) : v;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Purpose: CSV text from a header and lines, CRLF line ends (RFC 4180). */
export function toCsv(lines: readonly (readonly (string | number)[])[]): string {
  return lines.map((l) => l.map(csvField).join(",")).join("\r\n") + "\r\n";
}

/** Who last changed a value, and when (from the project's value history). */
export interface LastChange {
  at: string;
  by: string | null;
}

/**
 * Purpose: the latest change of each value, by preference id, from the value history (newest first). Only
 * changes of the value count; a reason given later does not move who changed it or when.
 */
export function lastChanges(
  history: readonly { id: string; kind: string; at: string; by: { displayName: string | null } | null }[],
): Map<string, LastChange> {
  const out = new Map<string, LastChange>();
  for (const h of history)
    if (h.kind === "changed" && !out.has(h.id)) out.set(h.id, { at: h.at, by: h.by?.displayName ?? null });
  return out;
}
