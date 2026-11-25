import {
  type FormEvent,
  type MutableRefObject,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AreaSection } from "../features/area/AreaSection";
import { useI18n } from "../i18n/i18n";
import type { MessageKey } from "../i18n/messages";
import { DELAY_PREFS, MAX_DELAY_SHARE, type PreferencesDoc, prefValue, withPref } from "./preferences";
import { can, type Project, type ProjectsApi } from "../projects/api";
import { ModePicker } from "../projects/ProjectDialogs";
import type { ProjectPlugin } from "../plugins/registry";
import { ProjectPlugins } from "./ProjectPlugins";
import { ReasonField } from "./ReasonField";
import { DesignRulesSection } from "./DesignRules";
import { VehicleChoiceSection } from "./VehicleChoice";
import { SwitchChoiceSection } from "./SwitchChoice";
import { OwnVehiclesSection } from "./OwnVehicles";
import { FleetSection } from "./Fleet";
import { EMPTY_FLEET, type FleetDoc } from "../features/fleet/model";
import type { SavedDepot } from "../features/depots/types";
import { CalendarSection } from "./CalendarSection";
import { ClimateSection } from "./ClimateSection";
import { ParametersSection } from "./Parameters";
import { AssumptionsReportSection } from "./AssumptionsReport";
import { roadValue } from "../features/road-sim/params";
import { DemandParamsSection } from "./DemandParams";
import { StationsSection } from "./StationsSection";
import { VisualsSection } from "./VisualsSection";
import { SavedFilesSection } from "./SavedFilesSection";
import type { UpdateTarget } from "./savedFiles";
import type { Tab } from "../shell/route";
import { CURRENCY_CODES } from "../features/costs/currencies";
import { type CurrencyState, NO_CURRENCY, RATE_PREF, withCurrency } from "../features/costs/currency";
import { OFF_PEAK_PREF } from "./editedElsewhere";
import { engineErrorText } from "../i18n/engine";

/**
 * Preferences tab (mockup "Project preferences"): the project's name, description, study area and modes, which
 * Owners and Editors can change, the design rules per rail mode, the catalogue vehicles and switches used and the
 * demand model's values, among others. The sections are shown one group at a time, with a navigation and a search.
 */
export function ProjectPreferences({
  api,
  project,
  onSaved,
  preferences = null,
  onPreferences,
  plugins = null,
  onSetPlugin,
  currency = NO_CURRENCY,
  fleet = null,
  onFleet,
  depots = [],
  country = null,
  place = null,
  climateLines,
  mapExports = null,
  onRecalculate = null,
  onTab,
}: {
  api: ProjectsApi;
  project: Project;
  onSaved: (p: Project) => void;
  /** The project's preferences document (assumption values it changes); saved with the project's drawings. */
  preferences?: PreferencesDoc | null;
  /** Told about each change to the preferences; the project saves it. */
  onPreferences?: (doc: PreferencesDoc) => void;
  /** The plugins the project can use (ADR-0036 §9); null while loading. */
  plugins?: readonly ProjectPlugin[] | null;
  /** Turn a plugin on or off for the project (Owners). */
  onSetPlugin?: (pluginId: string, enabled: boolean, version?: string) => Promise<void>;
  /** The project's currency and its exchange rate. */
  currency?: CurrencyState;
  /** The project's own vehicles and its fleet; null while loading. */
  fleet?: FleetDoc | null;
  /** Told about each change to the own vehicles or the fleet; the project saves it. */
  onFleet?: (doc: FleetDoc) => void;
  /** The road depots (depot tool), as homes for fleet vehicles. */
  depots?: readonly SavedDepot[];
  /** ISO alpha-2 code of the country at the project's location, when known (public holidays). */
  country?: string | null;
  /** The project's location [lon, lat], for its climate; null when nothing is drawn yet. */
  place?: readonly [number, number] | null;
  /** The network's drawn lines in degrees, for the share of each climate zone of a large area. */
  climateLines?: readonly (readonly [number, number])[][];
  /** The Export section: the project's schematic maps to download or print. */
  mapExports?: ReactNode;
  /** Set while worked-out results are out of date: works them out again from the project as it is now. */
  onRecalculate?: (() => void) | null;
  /** Open another tab (the Update links of Saved project files). */
  onTab?: (tab: Tab) => void;
}) {
  const { t } = useI18n();
  const editable = can.edit(project);
  const loadHistory = useCallback(() => allValueHistory(api, project.id), [api, project.id]);
  const areaApi = useMemo(() => api.area?.(project.id) ?? null, [api, project.id]);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [modes, setModes] = useState(project.modes);
  const [state, setState] = useState<"idle" | "saving" | "saved" | { error: string }>("idle");
  const dirty =
    name.trim() !== project.name ||
    description.trim() !== project.description ||
    [...modes].sort().join() !== [...project.modes].sort().join();
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setState("saving");
    try {
      onSaved(
        await api.update(project.id, {
          name: name.trim(),
          description: description.trim(),
          modes,
        }),
      );
      setState("saved");
    } catch (err) {
      setState({ error: engineErrorText(err) });
    }
  };
  const label = "mt-4 mb-1.5 block font-semibold";
  const prefsEditable = editable && !!onPreferences;
  const fleetEditable = editable && !!onFleet && !!fleet;
  const setPrefs = (d: PreferencesDoc) => onPreferences?.(d);
  // Set by the layout: show one section of Project preferences (the Update links of Saved project files).
  const showSection = useRef<((id: string) => void) | null>(null);
  const go = (target: UpdateTarget) => {
    if ("tab" in target) onTab?.(target.tab);
    else showSection.current?.(target.section);
  };
  const sections: readonly PrefSection[] = [
    {
      id: "project",
      group: "project",
      title: "prefs.details",
      node: (
        <form
          onSubmit={(e) => void save(e)}
          className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 md:p-6"
        >
          <h2 className="caps m-0">{t("prefs.project")}</h2>
          <fieldset disabled={!editable} className="m-0 border-0 p-0">
            <label className={label} htmlFor="pp-name">
              {t("new.name")}
            </label>
            <div className="field">
              <input
                id="pp-name"
                required
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <label className={label} htmlFor="pp-desc">
              {t("prefs.description")}
            </label>
            <textarea
              id="pp-desc"
              maxLength={2000}
              rows={3}
              className="w-full rounded-[10px] border border-slate-300 px-3 py-2 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className={label}>{t("new.modes")}</div>
            <ModePicker value={modes} onChange={setModes} />
          </fieldset>
          {editable ? (
            <div className="mt-5 flex items-center gap-3">
              <button
                type="submit"
                className="btn btn-pri"
                disabled={!dirty || !name.trim() || state === "saving"}
              >
                {t("prefs.save")}
              </button>
              <span role="status" className="text-sm text-slate-600">
                {state === "saved" && !dirty
                  ? t("prefs.saved")
                  : typeof state === "object"
                    ? state.error
                    : ""}
              </span>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">{t("prefs.readOnly")}</p>
          )}
        </form>
      ),
    },
    ...(areaApi
      ? [
          {
            id: "area",
            group: "project",
            title: "area.title",
            node: <AreaSection api={areaApi} editable={editable} />,
          } satisfies PrefSection,
        ]
      : []),
    {
      id: "currency",
      group: "project",
      title: "prefs.currencyTitle",
      node: (
        <CurrencySection
          state={currency}
          preferences={preferences}
          editable={prefsEditable}
          onPreferences={setPrefs}
        />
      ),
    },
    {
      id: "saved-files",
      group: "project",
      title: "savedFiles.title",
      node: (
        <SavedFilesSection
          api={api}
          projectId={project.id}
          preferences={preferences}
          editable={prefsEditable}
          onPreferences={setPrefs}
          onGo={go}
          onRecalculate={onRecalculate}
        />
      ),
    },
    ...(onSetPlugin
      ? [
          {
            id: "plugins",
            group: "project",
            title: "plugins.title",
            node: <ProjectPlugins plugins={plugins} manage={can.manage(project)} onSet={onSetPlugin} />,
          } as const,
        ]
      : []),
    {
      id: "rules",
      group: "network",
      title: "prefs.rulesTitle",
      node: (
        <DesignRulesSection
          projectModes={project.modes}
          preferences={preferences}
          editable={prefsEditable}
          onPreferences={setPrefs}
        />
      ),
    },
    {
      id: "switches",
      group: "network",
      title: "prefs.switchesTitle",
      node: (
        <SwitchChoiceSection
          projectModes={project.modes}
          preferences={preferences}
          editable={prefsEditable}
          onPreferences={setPrefs}
        />
      ),
    },
    {
      id: "stations",
      group: "network",
      title: "prefs.stationsTitle",
      node: <StationsSection preferences={preferences} editable={prefsEditable} onPreferences={setPrefs} />,
    },
    {
      id: "vehicles",
      group: "vehicles",
      title: "prefs.vehiclesTitle",
      node: (
        <VehicleChoiceSection
          projectModes={project.modes}
          preferences={preferences}
          editable={prefsEditable}
          onPreferences={setPrefs}
        />
      ),
    },
    {
      id: "own",
      group: "vehicles",
      title: "fleet.ownTitle",
      node: (
        <OwnVehiclesSection
          fleet={fleet ?? EMPTY_FLEET}
          editable={fleetEditable}
          onFleet={(d) => onFleet?.(d)}
        />
      ),
    },
    {
      id: "fleet",
      group: "vehicles",
      title: "fleet.title",
      node: (
        <FleetSection
          fleet={fleet ?? EMPTY_FLEET}
          preferences={preferences}
          projectModes={project.modes}
          depots={depots}
          editable={fleetEditable}
          onFleet={(d) => onFleet?.(d)}
        />
      ),
    },
    {
      id: "demand",
      group: "demand",
      title: "prefs.demandTitle",
      node: (
        <DemandParamsSection preferences={preferences} editable={prefsEditable} onPreferences={setPrefs} />
      ),
    },
    {
      id: "delay",
      group: "demand",
      title: "prefs.delayTitle",
      node: (
        <section
          aria-labelledby="pp-delay"
          className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 md:p-6"
        >
          <h2 id="pp-delay" className="caps m-0">
            {t("prefs.delayTitle")}
          </h2>
          <p className="mt-1 text-sm text-slate-600">{t("prefs.delayIntro")}</p>
          <div className="mt-2 flex flex-col gap-1">
            {DELAY_PREFS.map((p) => (
              <ShareField
                key={p.id}
                label={t(p.label)}
                library={p.library}
                value={prefValue(preferences, p.id)}
                editable={prefsEditable}
                onChange={(v) => onPreferences?.(withPref(preferences, p.id, v))}
                reason={
                  <ReasonField
                    valueId={p.id}
                    preferences={preferences}
                    editable={prefsEditable}
                    onPreferences={setPrefs}
                  />
                }
              />
            ))}
          </div>
          {!editable && <p className="mt-3 text-sm text-slate-500">{t("prefs.readOnly")}</p>}
        </section>
      ),
    },
    {
      id: "road",
      group: "demand",
      title: "prefs.roadTitle",
      node: (
        <section
          aria-labelledby="pp-road"
          className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 md:p-6"
        >
          <h2 id="pp-road" className="caps m-0">
            {t("prefs.roadTitle")}
          </h2>
          <p className="mt-1 text-sm text-slate-600">{t("prefs.roadIntro")}</p>
          <div className="mt-2 flex flex-col gap-1">
            <ShareField
              label={t("prefs.offPeakTraffic")}
              library={OFF_PEAK_LIBRARY}
              max={1}
              value={prefValue(preferences, OFF_PEAK_PREF)}
              editable={prefsEditable}
              onChange={(v) => onPreferences?.(withPref(preferences, OFF_PEAK_PREF, v))}
              reason={
                <ReasonField
                  valueId={OFF_PEAK_PREF}
                  preferences={preferences}
                  editable={prefsEditable}
                  onPreferences={setPrefs}
                />
              }
            />
          </div>
          {!editable && <p className="mt-3 text-sm text-slate-500">{t("prefs.readOnly")}</p>}
        </section>
      ),
    },
    {
      id: "calendar",
      group: "time",
      title: "cal.title",
      node: (
        <CalendarSection
          preferences={preferences}
          editable={prefsEditable}
          onPreferences={setPrefs}
          detectedCountry={country}
        />
      ),
    },
    {
      id: "climate",
      group: "time",
      title: "climate.title",
      node: (
        <ClimateSection
          preferences={preferences}
          editable={prefsEditable}
          onPreferences={setPrefs}
          place={place}
          lines={climateLines}
        />
      ),
    },
    {
      id: "visuals",
      group: "visuals",
      title: "visuals.vehiclesTitle",
      node: <VisualsSection preferences={preferences} editable={prefsEditable} onPreferences={setPrefs} />,
    },
    {
      id: "params",
      group: "assumptions",
      title: "prefs.paramsTitle",
      node: <ParametersSection preferences={preferences} editable={prefsEditable} onPreferences={setPrefs} />,
    },
    {
      id: "report",
      group: "assumptions",
      title: "report.title",
      node: (
        <AssumptionsReportSection
          projectName={project.name}
          projectModes={project.modes}
          preferences={preferences}
          currency={currency.chosen}
          loadHistory={loadHistory}
        />
      ),
    },
    ...(mapExports
      ? [{ id: "export", group: "project", title: "schematic.exportTitle", node: mapExports } as const]
      : []),
  ];
  return <PreferencesLayout projectId={project.id} sections={sections} showSection={showSection} />;
}

/** The groups of Project preferences, in the order the navigation lists them. */
const GROUPS = [
  { id: "project", title: "prefs.project" },
  { id: "network", title: "prefs.groupNetwork" },
  { id: "vehicles", title: "prefs.groupVehicles" },
  { id: "demand", title: "prefs.groupDemand" },
  { id: "time", title: "prefs.groupTime" },
  { id: "visuals", title: "prefs.groupVisuals" },
  { id: "assumptions", title: "prefs.groupAssumptions" },
] as const satisfies readonly { id: string; title: MessageKey }[];

type GroupId = (typeof GROUPS)[number]["id"];

/** One section of Project preferences: the group it is listed under, its name in the navigation and its content. */
interface PrefSection {
  id: string;
  group: GroupId;
  title: MessageKey;
  node: ReactNode;
}

/** The group each project showed last, so saving the project (which draws the page anew) keeps it. */
const lastGroup = new Map<string, GroupId>();

/** Purpose: text for searching: lower case, without accents, spaces collapsed. */
function searchText(text: string, language: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase(language).replace(/\s+/g, " ").trim();
}

/**
 * Purpose: Project preferences one group at a time, with a navigation of the groups and their sections (a side
 * column on wide screens, a row along the top on phones) and a search through the text of every section. Every
 * section stays drawn while hidden, so what is typed in one is kept when the planner moves to another group.
 */
function PreferencesLayout({
  projectId,
  sections,
  showSection,
}: {
  projectId: string;
  sections: readonly PrefSection[];
  /** Set to a function that shows one section: its group, scrolled to it. */
  showSection?: MutableRefObject<((id: string) => void) | null>;
}) {
  const { t, language } = useI18n();
  const [group, setGroupState] = useState<GroupId>(() => lastGroup.get(projectId) ?? "project");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<ReadonlySet<string>>(() => new Set());
  const scroller = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const bodies = useRef(new Map<string, HTMLElement>());
  const searchId = useId();
  const needle = searchText(query, language);
  const searching = needle !== "";

  // Which sections hold the searched text, read from the drawn sections so it works in every language. Runs after
  // every render, as a section's text changes with the project's values; the set is only replaced when it differs.
  useLayoutEffect(() => {
    if (!searching) return;
    const found = new Set<string>();
    for (const s of sections) {
      const el = bodies.current.get(s.id);
      if (el && searchText(el.textContent ?? "", language).includes(needle)) found.add(s.id);
    }
    setMatches((old) => (old.size === found.size && [...found].every((id) => old.has(id)) ? old : found));
  });

  const toTop = () => {
    const box = scroller.current;
    const start = top.current;
    if (box && start && box.scrollTop > start.offsetTop) box.scrollTop = start.offsetTop;
  };
  const setGroup = (g: GroupId) => {
    lastGroup.set(projectId, g);
    setGroupState(g);
    setQuery("");
    toTop();
  };
  const jump = (id: string) => {
    bodies.current.get(id)?.parentElement?.scrollIntoView({ block: "start" });
  };
  useEffect(() => {
    if (!showSection) return;
    showSection.current = (id: string) => {
      const s = sections.find((x) => x.id === id);
      if (!s) return;
      setGroup(s.group);
      // After the group is drawn.
      requestAnimationFrame(() => jump(id));
    };
  });
  const shown = (s: PrefSection) => (searching ? matches.has(s.id) : s.group === group);
  const count = (g: GroupId) => sections.filter((s) => s.group === g && matches.has(s.id)).length;
  const groupTitle = (g: GroupId) => t(GROUPS.find((x) => x.id === g)!.title);

  return (
    <div ref={scroller} className="h-full overflow-y-auto bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 pb-10 pt-6 md:px-8 md:pt-10">
        <p className="text-slate-600">{t("prefs.intro")}</p>
        <div ref={top} className="md:mt-2 md:flex md:items-start md:gap-8">
          <nav
            aria-label={t("prefs.navLabel")}
            className="sticky top-0 z-10 -mx-4 border-b border-slate-200 bg-slate-50 px-4 pb-2 pt-3 md:top-0 md:mx-0 md:w-60 md:shrink-0 md:border-0 md:px-0 md:pt-6 md:pb-0"
          >
            <label htmlFor={searchId} className="sr-only">
              {t("prefs.search")}
            </label>
            <div className="field">
              <input
                id={searchId}
                type="search"
                value={query}
                placeholder={t("prefs.search")}
                onChange={(e) => {
                  setQuery(e.target.value);
                  toTop();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setQuery("");
                }}
              />
            </div>
            <ul className="m-0 mt-2 flex list-none gap-1.5 overflow-x-auto p-0 pb-1 md:mt-3 md:flex-col md:gap-0.5 md:overflow-visible md:pb-0">
              {GROUPS.map((g) => {
                const current = !searching && g.id === group;
                const n = searching ? count(g.id) : 0;
                return (
                  <li key={g.id} className="shrink-0">
                    <button
                      type="button"
                      aria-current={current ? "true" : undefined}
                      onClick={() => setGroup(g.id)}
                      className={`flex min-h-10 w-full items-center gap-2 whitespace-nowrap rounded-full border px-3.5 text-start text-sm md:rounded-lg md:border-0 md:px-3 md:whitespace-normal ${
                        current
                          ? "border-slate-800 bg-slate-800 font-semibold text-white"
                          : searching && n === 0
                            ? "border-slate-200 bg-white text-slate-400 md:bg-transparent"
                            : "border-slate-300 bg-white text-slate-800 hover:bg-slate-100 md:bg-transparent"
                      }`}
                    >
                      <span className="flex-1">{t(g.title)}</span>
                      {searching && n > 0 && (
                        <span className="rounded-full bg-blue-100 px-2 text-xs font-semibold text-blue-800">
                          {n}
                        </span>
                      )}
                    </button>
                    {current && (
                      <ul className="m-0 hidden list-none border-s border-slate-200 py-1 ps-0 ms-3 md:block">
                        {sections
                          .filter((s) => s.group === g.id)
                          .map((s) => (
                            <li key={s.id}>
                              <button
                                type="button"
                                onClick={() => jump(s.id)}
                                className="block min-h-9 w-full rounded-e-lg px-3 py-1.5 text-start text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                              >
                                {t(s.title)}
                              </button>
                            </li>
                          ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="min-w-0 max-w-3xl flex-1">
            {searching && matches.size === 0 && (
              <p
                role="status"
                className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 text-slate-600 md:p-6"
              >
                {t("prefs.searchNone", { query: query.trim() })}
              </p>
            )}
            {sections.map((s) => (
              <div key={s.id} hidden={!shown(s)} className="scroll-mt-32 md:scroll-mt-0">
                {searching && (
                  <p className="mt-6 -mb-4 text-xs font-semibold text-slate-500">{groupTitle(s.group)}</p>
                )}
                <div
                  ref={(el) => {
                    if (el) bodies.current.set(s.id, el);
                    else bodies.current.delete(s.id);
                  }}
                >
                  {s.node}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Off-peak traffic of the road simulation, as a share of each street's peak value. */
const OFF_PEAK_LIBRARY = roadValue(OFF_PEAK_PREF, "*", undefined)[1];

const pct = (share: number) => String(Math.round(share * 1000) / 10);

/**
 * Purpose: one share entered in percent, with the assumption library's value beside it and a way back to it.
 * `value` undefined means the library's applies; `onChange(null)` returns to it.
 */
function ShareField({
  label,
  library,
  max = MAX_DELAY_SHARE,
  value,
  editable,
  onChange,
  reason,
}: {
  label: string;
  library: number;
  /** Largest share accepted. */
  max?: number;
  value: number | undefined;
  editable: boolean;
  onChange: (share: number | null) => void;
  /** The optional reason for the project's own value, shown below it. */
  reason?: ReactNode;
}) {
  const { t } = useI18n();
  const id = useId();
  const shown = pct(value ?? library);
  // What the planner is typing; the saved value shows again once the field is left.
  const [text, setText] = useState<string | null>(null);
  const commit = (raw: string) => {
    const n = Number(raw.replace(",", "."));
    if (raw.trim() === "" || !Number.isFinite(n) || n < 0 || n > max * 100) return;
    const share = Math.round(n * 10) / 1000;
    onChange(Math.abs(share - library) < 1e-9 ? null : share);
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 py-3 first:border-t-0">
      <label htmlFor={id} className="min-w-48 flex-1 font-semibold">
        {label}
      </label>
      <div className="flex items-center gap-1.5">
        <div className="field w-24">
          <input
            id={id}
            type="number"
            inputMode="decimal"
            min={0}
            max={max * 100}
            step={1}
            disabled={!editable}
            value={text ?? shown}
            onChange={(e) => {
              setText(e.target.value);
              commit(e.target.value);
            }}
            onBlur={() => setText(null)}
            className="text-end"
          />
        </div>
        <span aria-hidden="true">%</span>
      </div>
      <div className="flex w-full items-center gap-2 text-sm text-slate-500">
        <span>{t("prefs.delayDefault", { value: pct(library) })}</span>
        {editable && value !== undefined && (
          <button
            type="button"
            className="min-h-10 text-blue-700 underline"
            onClick={() => {
              setText(null);
              onChange(null);
            }}
          >
            {t("prefs.delayReset")}
          </button>
        )}
      </div>
      {reason}
    </div>
  );
}

const sig = (v: number) => String(Number(v.toPrecision(6)));

/**
 * Purpose: the currency all money in the project is shown in, and its rate per US$: the World Bank's official
 * exchange rate, or the project's own.
 */
function CurrencySection({
  state,
  preferences,
  editable,
  onPreferences,
}: {
  state: CurrencyState;
  preferences: PreferencesDoc | null;
  editable: boolean;
  onPreferences: (doc: PreferencesDoc) => void;
}) {
  const { t, language } = useI18n();
  const rateId = useId();
  const [text, setText] = useState<string | null>(null);
  const names = (() => {
    try {
      return new Intl.DisplayNames([language, "en"], { type: "currency" });
    } catch {
      return null;
    }
  })();
  const nameOf = (code: string) => {
    const n = names?.of(code);
    return n && n !== code ? `${code} · ${n}` : code;
  };
  const chosen = state.chosen;
  const own = prefValue(preferences, RATE_PREF);
  const shown = own ?? state.worldBank?.value;
  const commit = (raw: string) => {
    const n = Number(raw.replace(",", "."));
    if (raw.trim() === "" || !Number.isFinite(n) || n <= 0) return;
    onPreferences(withPref(preferences, RATE_PREF, n));
  };
  return (
    <section
      aria-labelledby="pp-currency"
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 md:p-6"
    >
      <h2 id="pp-currency" className="caps m-0">
        {t("prefs.currencyTitle")}
      </h2>
      <p className="mt-1 text-sm text-slate-600">{t("prefs.currencyIntro")}</p>
      <label className="mt-4 mb-1.5 block font-semibold" htmlFor="pp-currency-code">
        {t("prefs.currencyLabel")}
      </label>
      <div className="field">
        <select
          id="pp-currency-code"
          disabled={!editable}
          value={chosen ?? ""}
          onChange={(e) => {
            setText(null);
            onPreferences(withCurrency(preferences, e.target.value || null));
          }}
        >
          <option value="">{t("prefs.currencyCountry")}</option>
          {CURRENCY_CODES.map((c) => (
            <option key={c} value={c}>
              {nameOf(c)}
            </option>
          ))}
        </select>
      </div>
      {chosen && chosen !== "USD" && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 pt-3">
          <label htmlFor={rateId} className="min-w-48 flex-1 font-semibold">
            {t("prefs.currencyRate", { code: chosen })}
          </label>
          <div className="field w-36">
            <input
              id={rateId}
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              disabled={!editable}
              value={text ?? (shown !== undefined ? sig(shown) : "")}
              onChange={(e) => {
                setText(e.target.value);
                commit(e.target.value);
              }}
              onBlur={() => setText(null)}
              className="text-end"
            />
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 text-sm text-slate-500">
            <span>
              {state.worldBank
                ? t("prefs.currencyWorldBank", {
                    year: state.worldBank.year,
                    value: sig(state.worldBank.value),
                  })
                : state.status === "loading"
                  ? t("common.loading")
                  : own === undefined
                    ? t("prefs.currencyMissing", { code: chosen })
                    : ""}
            </span>
            {editable && own !== undefined && (
              <button
                type="button"
                className="min-h-10 text-blue-700 underline"
                onClick={() => {
                  setText(null);
                  onPreferences(withPref(preferences, RATE_PREF, null));
                }}
              >
                {t("prefs.currencyReset")}
              </button>
            )}
          </div>
          <ReasonField
            valueId={RATE_PREF}
            preferences={preferences}
            editable={editable}
            onPreferences={onPreferences}
          />
        </div>
      )}
      {chosen && <p className="mt-3 text-sm text-slate-500">{t("prefs.currencyHow")}</p>}
      {!editable && <p className="mt-3 text-sm text-slate-500">{t("prefs.readOnly")}</p>}
    </section>
  );
}

/**
 * Purpose: the project's whole value history, newest first, read page by page (at most 10 000 changes), then the
 * history it was opened with from a .mslab file, marked as from the file.
 */
async function allValueHistory(api: ProjectsApi, projectId: string) {
  const out = [];
  let before: number | undefined;
  for (let page = 0; page < 20; page++) {
    const h = await api.valueHistory(projectId, { before, limit: 500 });
    out.push(...h);
    if (h.length < 500) break;
    before = h[h.length - 1]!.seq;
  }
  if (typeof api.fileValueHistory === "function")
    out.push(...(await api.fileValueHistory(projectId).catch(() => [])));
  return out;
}
