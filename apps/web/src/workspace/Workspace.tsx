import type { Map as MapLibreMap } from "maplibre-gl";
import { type ReactNode, useEffect, useState } from "react";
import { JourneyPlanner } from "../features/journey-planner/JourneyPlanner";
import type { PluginLineInput, StreetLineInput } from "../features/journey-planner/network";
import { RailwayEditor } from "../features/railways/RailwayEditor";
import { StreetLineEditor } from "../features/street-lines/StreetLineEditor";
import { loadSetups, saveSetups } from "../features/street-setup/model";
import { StreetSetupEditor } from "../features/street-setup/StreetSetupEditor";
import type { StreetSetup } from "../features/street-setup/types";
import { useI18n } from "../i18n/i18n";
import type { MessageKey } from "../i18n/messages";
import { SpanLineEditor } from "../kits/SpanLineEditor";
import { WaterRouteEditor } from "../kits/WaterRouteEditor";
import { MapView } from "../map/MapView";
import { pluginTools } from "../plugins/registry";
import { can, type Project, type ProjectsApi } from "../projects/api";
import {
  BackIcon,
  BusIcon,
  CableIcon,
  FerryIcon,
  GearIcon,
  LayersIcon,
  PenIcon,
  PlayIcon,
  SchematicIcon,
  TableIcon,
  TrainIcon,
} from "../shell/icons";
import { type Tab, TABS } from "../shell/route";
import { TopBar } from "../shell/TopBar";
import { Placeholder } from "./Placeholder";
import { ProjectPreferences } from "./ProjectPreferences";

const TAB_ICONS: Record<Tab, (p: { size?: number }) => ReactNode> = {
  simulator: PlayIcon,
  create: PenIcon,
  schematic: SchematicIcon,
  gis: LayersIcon,
  tables: TableIcon,
  preferences: GearIcon,
};
/** Tabs drawn over the map; the others are full pages. */
const MAP_TABS: readonly Tab[] = ["simulator", "create", "gis"];

type SimView = "test" | "journey";
/** "street", "rail", or the id of a plugin tool (cable car, ferry…). */
type Build = string;
const PLUGIN_TOOLS = pluginTools();

/**
 * One open project (mockups "Project app"): the project name and the six tabs in the top bar (a bottom tab bar on
 * phones), the map, and a side panel (a bottom sheet on phones). Simulator holds the journey planner; Create holds
 * the street line tool and the railway editor; the other tabs are placeholders until their tools exist.
 */
export function Workspace({
  api,
  projectId,
  tab,
  fresh,
  brand,
  account,
  onTab,
  onHome,
  onAbout,
}: {
  api: ProjectsApi;
  projectId: string;
  tab: Tab;
  fresh: boolean;
  brand: string;
  account: ReactNode;
  onTab: (t: Tab) => void;
  onHome: () => void;
  onAbout: () => void;
}) {
  const { t } = useI18n();
  const [project, setProject] = useState<Project | null>(null);
  const [missing, setMissing] = useState(false);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const [sim, setSim] = useState<SimView>("test");
  const [build, setBuild] = useState<Build | null>(null);
  // The street line last drawn, so the journey planner can ride it.
  const [line, setLine] = useState<StreetLineInput | null>(null);
  // Cable car and ferry lines from the plugin tools, per tool, for the journey planner.
  const [pluginLines, setPluginLines] = useState<Record<string, PluginLineInput | null>>({});
  // Street setups from the GIS tab: they override OSM in the street line tool and the railway editor.
  const [setups, setSetups] = useState<StreetSetup[]>(() => loadSetups(projectId));
  useEffect(() => setSetups(loadSetups(projectId)), [projectId]);
  const changeSetups = (next: StreetSetup[]) => {
    setSetups(next);
    saveSetups(projectId, next);
  };
  if (import.meta.env.DEV) Object.assign(window, { mobsimMap: map });

  useEffect(() => {
    setProject(null);
    setMissing(false);
    api.get(projectId).then(setProject, () => setMissing(true));
  }, [api, projectId]);

  useEffect(() => {
    if (project) document.title = `${project.name} · ${brand}`;
    return () => {
      document.title = brand;
    };
  }, [project, brand]);

  const onMap = MAP_TABS.includes(tab);
  const editable = project ? can.edit(project) : false;
  const hasPanel = onMap && project !== null;
  const tabLabel = (x: Tab) => t(`tab.${x}` as MessageKey);

  const tabs = (
    <nav
      aria-label={t("tab.label")}
      className="hidden h-full items-stretch gap-0.5 self-stretch md:ml-2 md:flex"
    >
      {TABS.map((x) => {
        const Icon = TAB_ICONS[x];
        return (
          <a
            key={x}
            href={`/projects/${projectId}/${x}`}
            aria-current={tab === x ? "page" : undefined}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              onTab(x);
            }}
            className={`flex items-center gap-1.5 border-y-[3px] border-transparent px-2.5 font-medium whitespace-nowrap text-slate-700 no-underline hover:text-slate-900 lg:px-3.5 ${tab === x ? "border-b-blue-700 text-blue-700" : ""}`}
          >
            <span className="hidden xl:inline">
              <Icon size={18} />
            </span>
            {tabLabel(x)}
          </a>
        );
      })}
    </nav>
  );

  const top = (
    <TopBar brand={brand} onHome={onHome} onAbout={onAbout} account={account}>
      <button type="button" className="icon-btn md:hidden" aria-label={t("project.back")} onClick={onHome}>
        <BackIcon />
      </button>
      <span className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-slate-700">
        <span className="truncate font-medium">{project?.name ?? "…"}</span>
        {project && !editable && (
          <span className="tag bg-slate-100 text-slate-700">{t("project.viewOnly")}</span>
        )}
      </span>
      {tabs}
    </TopBar>
  );

  const bottomTabs = (
    <nav
      aria-label={t("tab.label")}
      className="flex h-16 shrink-0 border-t border-slate-200 bg-white md:hidden"
    >
      {TABS.map((x) => {
        const Icon = TAB_ICONS[x];
        return (
          <button
            key={x}
            type="button"
            aria-current={tab === x ? "page" : undefined}
            onClick={() => onTab(x)}
            className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${tab === x ? "text-blue-700" : "text-slate-500"}`}
          >
            <Icon size={22} />
            <span className="max-w-full truncate px-0.5">{tabLabel(x)}</span>
          </button>
        );
      })}
    </nav>
  );

  if (missing)
    return (
      <div className="flex h-full flex-col">
        {top}
        <main className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <h1 className="text-xl font-semibold">{t("project.notFound")}</h1>
          <p className="max-w-md text-slate-600">{t("project.notFoundHint")}</p>
          <button type="button" className="btn btn-pri" onClick={onHome}>
            {t("project.toHome")}
          </button>
        </main>
      </div>
    );

  // Create: a new project starts with the chooser; an existing one with the rail or street tool last used.
  const chosen: Build | null = build ?? (fresh ? null : "street");
  const chosenPlugin = PLUGIN_TOOLS.find((x) => x.id === chosen) ?? null;
  const panelLabel =
    tab === "simulator"
      ? tabLabel("simulator")
      : tab === "create"
        ? chosen === "rail"
          ? t("create.rail")
          : chosenPlugin
            ? chosenPlugin.label
            : t("create.street")
        : tabLabel("gis");
  const pluginLineList = Object.values(pluginLines).filter((l): l is PluginLineInput => l !== null);

  return (
    <div className="flex h-full flex-col">
      {top}
      <main className="relative flex min-h-0 flex-1 flex-col md:flex-row">
        <div className={`relative min-h-0 min-w-0 flex-1 ${onMap ? "" : "hidden"}`}>
          <MapView onReady={setMap} />
          {project && tab === "create" && editable && chosen === "street" && (
            <StreetLineEditor map={map} panel={panel} onLineChange={setLine} streetSetups={setups} />
          )}
          {project && tab === "create" && editable && chosen === "rail" && (
            <RailwayEditor map={map} panel={panel} streetSetups={setups} />
          )}
          {project && tab === "create" && editable && chosenPlugin?.kit === "straight-spans" && (
            <SpanLineEditor
              map={map}
              panel={panel}
              tool={chosenPlugin}
              storageKey={`mobsimlab:${chosenPlugin.id}:${projectId}`}
              onLineChange={(l) => setPluginLines((p) => ({ ...p, [chosenPlugin.id]: l }))}
            />
          )}
          {project && tab === "create" && editable && chosenPlugin?.kit === "water-route" && (
            <WaterRouteEditor
              map={map}
              panel={panel}
              tool={chosenPlugin}
              storageKey={`mobsimlab:${chosenPlugin.id}:${projectId}`}
              onLineChange={(l) => setPluginLines((p) => ({ ...p, [chosenPlugin.id]: l }))}
            />
          )}
          {project && tab === "gis" && (
            <StreetSetupEditor
              map={map}
              panel={panel}
              setups={setups}
              onChange={changeSetups}
              editable={editable}
            />
          )}
          {project && tab === "simulator" && sim === "journey" && (
            <JourneyPlanner
              map={map}
              panel={panel}
              streetLine={line && line.view.points.length >= 2 ? line : null}
              pluginLines={pluginLineList}
            />
          )}
          {project && tab === "create" && editable && chosen === null && (
            <div className="absolute inset-0 z-20 flex items-start justify-center overflow-y-auto bg-slate-50/70 p-4 md:pt-16">
              <section
                aria-label={t("create.chooseTitle")}
                className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl md:p-7"
              >
                <h2 className="text-2xl font-semibold tracking-tight">{t("create.chooseTitle")}</h2>
                <p className="mt-1 text-slate-600">{t("create.chooseIntro")}</p>
                <div className="mt-5 grid gap-3.5 sm:grid-cols-2">
                  {[
                    ...([
                      [
                        "street",
                        BusIcon,
                        t("create.street"),
                        t("create.streetHint"),
                        "bg-blue-100 text-blue-900",
                      ],
                      ["rail", TrainIcon, t("create.rail"), t("create.railHint"), "bg-red-100 text-red-900"],
                    ] as const),
                    // Tools contributed by plugins (ADR-0036 §6): cable car and ferry are bundled.
                    ...PLUGIN_TOOLS.map(
                      (x) =>
                        [
                          x.id,
                          x.kit === "water-route" ? FerryIcon : CableIcon,
                          x.label,
                          x.hint ?? "",
                          x.kit === "water-route"
                            ? "bg-cyan-100 text-cyan-900"
                            : "bg-violet-100 text-violet-900",
                        ] as const,
                    ),
                  ].map(([kind, Icon, title, hint, colour]) => (
                    <button
                      key={kind}
                      type="button"
                      className="flex flex-col gap-2.5 rounded-2xl border-[1.5px] border-slate-200 bg-white p-4 text-left hover:border-blue-700 hover:ring-[3px] hover:ring-blue-100 focus-visible:border-blue-700 focus-visible:ring-[3px] focus-visible:ring-blue-100 focus-visible:outline-none"
                      onClick={() => setBuild(kind)}
                    >
                      <span className={`flex h-12 w-12 items-center justify-center rounded-xl ${colour}`}>
                        <Icon size={26} />
                      </span>
                      <span className="text-base font-semibold">{title}</span>
                      <span className="text-xs text-slate-500">{hint}</span>
                    </button>
                  ))}
                </div>
                {!project.areaName && (
                  <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
                    <p className="min-w-48 flex-1 text-xs text-slate-700">{t("create.noArea")}</p>
                    <button type="button" className="btn min-h-10" onClick={() => onTab("gis")}>
                      {t("create.setArea")}
                    </button>
                  </div>
                )}
              </section>
            </div>
          )}
        </div>

        {!onMap && project && tab === "preferences" && (
          <div className="min-h-0 flex-1">
            <ProjectPreferences key={project.updatedAt} api={api} project={project} onSaved={setProject} />
          </div>
        )}
        {!onMap && tab === "schematic" && (
          <div className="min-h-0 flex-1">
            <Placeholder
              page
              title="schematic.title"
              intro="schematic.intro"
              items={["schematic.network", "schematic.line", "schematic.layers", "schematic.export"]}
            />
          </div>
        )}
        {!onMap && tab === "tables" && (
          <div className="min-h-0 flex-1">
            <Placeholder
              page
              title="tables.title"
              intro="tables.intro"
              items={[
                "tables.summary",
                "tables.infrastructure",
                "tables.service",
                "tables.costs",
                "tables.compare",
              ]}
            />
          </div>
        )}
        {!project && !missing && (
          <p role="status" className="absolute inset-x-0 top-4 text-center text-slate-500">
            {t("common.loading")}
          </p>
        )}

        {hasPanel && (
          <aside
            aria-label={panelLabel}
            className={`flex max-h-[55%] shrink-0 flex-col overflow-hidden rounded-t-2xl border-t border-slate-200 bg-white shadow-[0_-4px_20px_rgba(15,23,42,.12)] md:max-h-none md:rounded-none md:border-t-0 md:border-l md:shadow-none ${tab === "simulator" && sim === "journey" ? "md:w-[26rem]" : "md:w-96"}`}
          >
            <div
              className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-slate-300 md:hidden"
              aria-hidden="true"
            />
            {tab === "simulator" && (
              <div className="shrink-0 px-4 pt-3 pb-2 md:px-5 md:pt-5">
                <div className="seg" role="tablist" aria-label={tabLabel("simulator")}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={sim === "test"}
                    onClick={() => setSim("test")}
                  >
                    {t("sim.test")}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={sim === "journey"}
                    onClick={() => setSim("journey")}
                  >
                    {t("sim.journey")}
                  </button>
                </div>
              </div>
            )}
            {tab === "create" && editable && chosen !== null && (
              <div className="shrink-0 px-4 pt-3 pb-2 md:px-5 md:pt-5">
                <div className="seg" role="tablist" aria-label={tabLabel("create")}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={chosen === "street"}
                    onClick={() => setBuild("street")}
                  >
                    {t("create.street")}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={chosen === "rail"}
                    onClick={() => setBuild("rail")}
                  >
                    {t("create.rail")}
                  </button>
                  {PLUGIN_TOOLS.map((x) => (
                    <button
                      key={x.id}
                      type="button"
                      role="tab"
                      aria-selected={chosen === x.id}
                      onClick={() => setBuild(x.id)}
                    >
                      {x.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {tab === "simulator" && sim === "test" && (
                <div className="px-4 pb-5 md:px-5">
                  <Placeholder
                    title="sim.testTitle"
                    intro="sim.testIntro"
                    items={["sim.runPeriod", "sim.verdicts", "sim.playback", "sim.popups"]}
                  />
                  <button type="button" className="btn mt-4 w-full" onClick={() => setSim("journey")}>
                    {t("sim.tryJourney")}
                  </button>
                </div>
              )}
              {tab === "create" && !editable && (
                <div className="px-4 py-5 md:px-5">
                  <h2 className="text-lg font-semibold">{t("create.readOnlyTitle")}</h2>
                  <p className="mt-1 text-slate-600">{t("create.readOnly")}</p>
                </div>
              )}
              {tab === "create" && editable && chosen === null && (
                <p className="px-4 py-5 text-slate-600 md:px-5">{t("create.chooseFirst")}</p>
              )}
              {/* The street line tool, railway editor, journey planner and street setup render their panels here. */}
              <div key={`${tab}-${sim}-${chosen}`} ref={setPanel} />
              {tab === "gis" && (
                <div className="border-t border-slate-200 px-4 py-5 md:px-5">
                  <Placeholder
                    title="gis.title"
                    intro="gis.intro"
                    items={["gis.areas", "gis.walk", "gis.spacing"]}
                  />
                </div>
              )}
            </div>
          </aside>
        )}
      </main>
      {bottomTabs}
    </div>
  );
}
