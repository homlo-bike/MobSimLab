import type { MessageKey } from "../../i18n/messages";
import type { Translate } from "../../i18n/i18n";
import { energyInTables } from "../energy/params";

/** A name in the Tables tab's side panel, as a message key. */
interface TableLabel {
  key: MessageKey;
}
/**
 * The groups of the Tables tab, shown one at a time, and the sections of each group, listed under the open group in the side panel like Project preferences and shown one
 * at a time (`TablePart` in the groups' tables); the first shows when a group opens. Ids are `<group>.<section>`.
 */
export const TABLE_GROUPS: (TableLabel & { id: string; sections: (TableLabel & { id: string })[] })[] = [
  {
    id: "network",
    key: "net.summary",
    sections: [
      { id: "network.summary", key: "tables.sec.overview" },
      { id: "network.infrastructure", key: "net.infra" },
      { id: "network.service", key: "net.service" },
      { id: "network.energy", key: "nrg.title" },
    ],
  },
  {
    id: "timetables",
    key: "tt.tbl.title",
    sections: [
      { id: "timetables.blocks", key: "tables.sec.blocks" },
      { id: "timetables.departures", key: "tables.sec.departures" },
    ],
  },
  {
    id: "costs",
    key: "cost.title",
    sections: [
      { id: "costs.overview", key: "tables.sec.overview" },
      { id: "costs.construction", key: "cost.constructionByType" },
      { id: "costs.operating", key: "cost.operatingYear" },
      { id: "costs.prices", key: "tables.sec.prices" },
    ],
  },
  {
    id: "benefits",
    key: "tnav.benefits",
    sections: [
      { id: "benefits.summary", key: "tnav.benefits.summary" },
      { id: "benefits.access", key: "tnav.benefits.access" },
      { id: "benefits.lines", key: "tnav.benefits.lines" },
      { id: "benefits.settings", key: "tnav.benefits.settings" },
    ],
  },
  {
    id: "demand",
    key: "tnav.demand",
    sections: [
      { id: "demand.zones", key: "tnav.demand.zones" },
      { id: "demand.run", key: "tnav.demand.run" },
      { id: "demand.results", key: "tnav.results" },
    ],
  },
  {
    id: "fares",
    key: "tnav.fares",
    sections: [
      { id: "fares.revenue", key: "tnav.fares.revenue" },
      { id: "fares.settings", key: "tnav.fares.settings" },
    ],
  },
  {
    id: "appraisal",
    key: "tnav.appraisal",
    sections: [
      { id: "appraisal.results", key: "tnav.results" },
      { id: "appraisal.uncertainty", key: "tnav.appraisal.uncertainty" },
      { id: "appraisal.mca", key: "tnav.appraisal.mca" },
      { id: "appraisal.settings", key: "tnav.appraisal.settings" },
    ],
  },
  { id: "scenarios", key: "scn.title", sections: [] },
];

/** Purpose: the sections of a group the side panel lists (the energy section only when its plugin is on). */
export function groupParts(group: string): { id: string; key: MessageKey }[] {
  const g = TABLE_GROUPS.find((x) => x.id === group);
  return (g?.sections ?? []).filter((s) => s.id !== "network.energy" || energyInTables());
}

/**
 * Purpose: the section of a group on show: the one chosen last, else the group's first; null for a group
 * without sections (every part shows).
 */
export function shownPart(group: string, parts: Readonly<Record<string, string>>): string | null {
  const list = groupParts(group);
  const chosen = parts[group];
  return list.find((s) => s.id === chosen)?.id ?? list[0]?.id ?? null;
}

/**
 * Purpose: the Tables tab's side panel, laid out like Project preferences: the groups in a column, the open group
 * listing its sections beneath it, one shown at a time. On phones the groups and the open group's sections are two
 * rows of buttons on top.
 * Inputs: the translator, the open group, the section chosen in each group, and what to do when a group or a
 * section is chosen. Output: the navigation.
 */
export function TablesNav({
  t,
  view,
  parts,
  onGroup,
  onPart,
}: {
  t: Translate;
  view: string;
  parts: Readonly<Record<string, string>>;
  onGroup: (group: string) => void;
  onPart: (group: string, part: string) => void;
}) {
  const name = (l: TableLabel) => t(l.key);
  const current = shownPart(view, parts);
  const partButton = (group: string, s: { id: string } & TableLabel, phone: boolean) => (
    <button
      type="button"
      aria-current={s.id === current ? "true" : undefined}
      onClick={() => onPart(group, s.id)}
      className={
        phone
          ? `flex min-h-9 items-center whitespace-nowrap rounded-full border px-3 text-sm ${
              s.id === current
                ? "border-blue-300 bg-blue-50 font-semibold text-blue-800"
                : "border-slate-300 bg-white text-slate-700"
            }`
          : `block min-h-9 w-full rounded-e-lg px-3 py-1.5 text-start text-sm ${
              s.id === current
                ? "border-s-2 border-slate-800 -ms-px font-semibold text-slate-900"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`
      }
    >
      {name(s)}
    </button>
  );
  const open = groupParts(view);
  return (
    <nav
      aria-label={t("tables.title")}
      className="sticky top-0 z-10 -mx-4 mb-4 border-b border-slate-200 bg-slate-50 px-4 pb-2 pt-1 md:top-0 md:mx-0 md:mb-0 md:w-60 md:shrink-0 md:border-0 md:px-0 md:pb-0 md:pt-0"
    >
      <ul className="m-0 flex list-none gap-1.5 overflow-x-auto p-0 pb-1 md:flex-col md:gap-0.5 md:overflow-visible md:pb-0">
        {TABLE_GROUPS.map((g) => {
          const here = g.id === view;
          const list = groupParts(g.id);
          return (
            <li key={g.id} className="shrink-0">
              <button
                type="button"
                id={`tables-tab-${g.id}`}
                aria-current={here ? "true" : undefined}
                aria-controls={`tables-${g.id}`}
                onClick={() => onGroup(g.id)}
                className={`flex min-h-10 w-full items-center whitespace-nowrap rounded-full border px-3.5 text-start text-sm md:rounded-lg md:border-0 md:px-3 md:whitespace-normal ${
                  here
                    ? "border-slate-800 bg-slate-800 font-semibold text-white"
                    : "border-slate-300 bg-white text-slate-800 hover:bg-slate-100 md:bg-transparent"
                }`}
              >
                {name(g)}
              </button>
              {here && list.length > 0 && (
                <ul
                  aria-label={name(g)}
                  className="m-0 hidden list-none border-s border-slate-200 py-1 ps-0 ms-3 md:block"
                >
                  {list.map((s) => (
                    <li key={s.id}>{partButton(g.id, s, false)}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {open.length > 0 && (
        <ul
          aria-label={name(TABLE_GROUPS.find((g) => g.id === view)!)}
          className="m-0 mt-1 flex list-none gap-1.5 overflow-x-auto p-0 pb-1 md:hidden"
        >
          {open.map((s) => (
            <li key={s.id} className="shrink-0">
              {partButton(view, s, true)}
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
