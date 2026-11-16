import type { Map as MapLibreMap } from "maplibre-gl";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { BenefitTables } from "../features/benefits/BenefitTables";
import { DemandSection } from "../features/demand/DemandSection";
import { DemandZoneEditor } from "../features/demand/ZoneEditor";
import { partStepFree, schematicNetwork } from "../features/schematic/lines";
import { type DemandRidership, demandRidership } from "../features/demand/ridership";
import type { DemandDoc } from "../features/demand/zones";
import type { Estimate as BenefitEstimate } from "../features/benefits/model";
import type { Triple } from "../features/benefits/params";
import type { BenefitsDoc } from "../features/benefits/formulas";
import { RegionEditor } from "../features/benefits/RegionEditor";
import { benefitsApi } from "../features/benefits/data";
import { PopulationPanel } from "../features/population/PopulationPanel";
import type { Region, RegionsDoc } from "../features/benefits/regions";
import { projectTimetable } from "../features/benefits/timetable";
import { CargoBikeTab } from "../features/cargo-bike/CargoBikeTab";
import type { CargoBikeDoc } from "../features/cargo-bike/model";
import { CapacityRun } from "../features/capacity/CapacityRun";
import { RoadSimulation } from "../features/road-sim/RoadSimulation";
import { economyApi, type Prices } from "../features/costs/economy";
import { useProjectCurrency } from "../features/costs/currency";
import type { Estimate as CostEstimate } from "../features/costs/model";
import { CostTables, type CostsDoc } from "../features/costs/CostTables";
import { WalkAnalysis } from "../features/walk/WalkAnalysis";
import { journeySettingsFrom } from "../features/journey-planner/projectSettings";
import { JourneyPlanner } from "../features/journey-planner/JourneyPlanner";
import { NoiseMap } from "../features/noise/NoiseMap";
import { NetworkTables } from "../features/tables/NetworkTables";
import { TimetableTables } from "../features/timetables/TimetableTables";
import { feedHolidays, projectFeed } from "../features/timetables/feed";
import { paramValue } from "../features/costs/params";
import { calendarFrom } from "./calendar";
import { FareTables } from "../features/fares/FareTables";
import type { FaresDoc } from "../features/fares/model";
import { Scenarios } from "../features/tables/Scenarios";
import type { ScenariosDoc } from "../features/tables/scenarioModel";
import { noiseCalculationIn } from "../features/noise/plugin";
import type { PluginLineInput, StreetLineInput } from "../features/journey-planner/network";
import type { GtfsFeed, GtfsNetworkDoc } from "../features/gtfs/types";
import type { Timetable } from "../features/journey-planner/types";
import { RailwayEditor } from "../features/railways/RailwayEditor";
import { Schematic, type SchematicDoc } from "../features/schematic/Schematic";
import type { Network } from "../features/railways/types";
import { LineList } from "../features/street-lines/LineList";
import {
  lineInput,
  newLineId,
  type SavedStreetLine,
  type StreetLinesDoc,
} from "../features/street-lines/saved";
import { StreetLineEditor } from "../features/street-lines/StreetLineEditor";
import { loadWasmEngine as loadStreetEngine } from "../features/street-lines/engine";
import type { Mode as StreetMode } from "../features/street-lines/types";
import { loadRailEngine } from "../features/railways/engine";
import type { RailMode } from "../features/railways/types";
import {
  addStreetLine,
  addTerminalCrossovers,
  kindOf,
  mainPattern,
  toRailLine,
  toStreetLine,
} from "../features/gtfs/toLines";
import { forgetSetups, loadSetups } from "../features/street-setup/model";
import { StreetSetupEditor } from "../features/street-setup/StreetSetupEditor";
import type { StreetSetup } from "../features/street-setup/types";
import { useI18n } from "../i18n/i18n";
import type { MessageKey } from "../i18n/messages";
import { SpanLineEditor } from "../kits/SpanLineEditor";
import { WaterRouteEditor } from "../kits/WaterRouteEditor";
import { type DemandZone, ZoneEditor } from "../kits/ZoneEditor";
import { MapView } from "../map/MapView";
import {
  findMode,
  PLUGINS,
  pluginTabs,
  type ProjectPlugin,
  pluginsOfProject,
  pluginTools,
  setActivePlugins,
} from "../plugins/registry";
import { can, type Project, type ProjectsApi } from "../projects/api";
import {
  BackIcon,
  BusIcon,
  CableIcon,
  CargoBikeIcon,
  FerryIcon,
  GearIcon,
  LayersIcon,
  PenIcon,
  PlayIcon,
  PrintIcon,
  SchematicIcon,
  TableIcon,
  TrainIcon,
} from "../shell/icons";
import { type CoreTab, type Tab, TABS } from "../shell/route";
import { HelpMenu } from "../shell/HelpMenu";
import { TopBar } from "../shell/TopBar";
import { PROJECT_TOUR, Tour } from "../shell/Tour";
import { PrintReport } from "./PrintReport";
import { ProjectPreferences } from "./ProjectPreferences";
import {
  delaysFrom,
  designTextsFrom,
  designValuesFrom,
  type PreferencesDoc,
  paramNumber,
  sameNameStationM,
  switchChoiceFrom,
  vehiclesOffFrom,
} from "./preferences";
import { VehiclesOffContext } from "./projectVehicles";
import { EMPTY_FLEET, fleetFrom, type FleetDoc } from "../features/fleet/model";
import { setOwnVehicles } from "../features/fleet/registry";
import type { DelayShares } from "../features/street-lines/types";
import { type Drawings, useDrawings } from "./useDrawings";
import { CalendarRun } from "../features/calendar-run/CalendarRun";
import type { EnergyEstimate } from "../features/energy/types";
import { setPluginRuntime } from "../plugins/code/context";
import { PluginCalculations } from "../plugins/code/PluginCalculations";
import { PluginFrame } from "../plugins/code/PluginFrame";
import { clearPluginCode } from "../plugins/code/runtime";
import { DepotEditor } from "../features/depots/DepotEditor";
import { CommentsProvider } from "../features/comments/Comments";
import { commentableObjects, CommentsPanel } from "../features/comments/CommentsPanel";
import type { DepotsDoc, SavedDepot } from "../features/depots/types";

type IconFn = (p: { size?: number }) => ReactNode;
const TAB_ICONS: Record<CoreTab, IconFn> = {
  simulator: PlayIcon,
  create: PenIcon,
  schematic: SchematicIcon,
  gis: LayersIcon,
  tables: TableIcon,
  preferences: GearIcon,
};
/** Icons of the views plugin tabs show (the view id of the tab). */
const VIEW_ICONS: Record<string, IconFn> = { "cargo-bike": CargoBikeIcon };
const PLUGIN_TABS = pluginTabs();
const tabIcon = (x: Tab): IconFn =>
  TAB_ICONS[x as CoreTab] ?? VIEW_ICONS[PLUGIN_TABS.find((p) => p.id === x)?.view ?? ""] ?? LayersIcon;
/** Tabs drawn over the map; the others are full pages. The plugins' tabs all use the map. */
const MAP_TABS: readonly Tab[] = ["simulator", "create", "gis", ...PLUGIN_TABS.map((x) => x.id)];
const NO_SETUPS: StreetSetup[] = [];
const NO_STREET_LINES: SavedStreetLine[] = [];

type SimView = "test" | "journey" | "road" | "calendar";
type GisView = "streets" | "regions" | "zones" | "population";
const NO_REGIONS: Region[] = [];
const NO_FEEDS: GtfsFeed[] = [];
const NO_DEPOTS: SavedDepot[] = [];
/** "street", "rail", "depots", or the id of a plugin tool (cable car, ferry…). */
type Build = string;
/** The economy API for the project's currency rate. */
const ECONOMY = economyApi();

/**
 * One open project (mockups "Project app"): the project name and the six tabs in the top bar (a bottom tab bar on
 * phones), the map, and a side panel (a bottom sheet on phones). Simulator holds the capacity run and the journey planner; Create holds
 * the street line tool and the railway editor; Schematic holds the network diagram and strip maps;
 * Tables holds the network and cost tables; the other tabs are placeholders
 * until their tools exist.
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
  existingRailways = false,
  userId = null,
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
  /** Draw existing railways from OpenStreetMap in the railway tool (app setting). */
  existingRailways?: boolean;
  /** The signed-in person, so they can edit and delete their own comments. */
  userId?: string | null;
}) {
  const { t } = useI18n();
  const [project, setProject] = useState<Project | null>(null);
  const [missing, setMissing] = useState(false);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const [sim, setSim] = useState<SimView>("test");
  const [gis, setGis] = useState<GisView>("streets");
  // The cost tables' estimate, currency and country, for the benefit tables.
  const [costInfo, setCostInfo] = useState<{
    estimate: CostEstimate;
    currency: string | null;
    country: string | null;
    rate: number;
    /** Local currency units per international $ (the demand model's fares and car costs). */
    ppp: number;
    /** Units of the currency per 2023 international dollar (PPP factor × price escalation), for fares. */
    perIntl: number;
  } | null>(null);
  const onCostEstimate = useCallback(
    (estimate: CostEstimate, prices: Prices, country: string | null, rate: number) =>
      setCostInfo({
        estimate,
        currency: prices.currency,
        country,
        rate,
        ppp: prices.ppp,
        perIntl: prices.ppp * prices.escalation,
      }),
    [],
  );
  // The benefit estimate: riders a weekday per line (low, medium, high) for the service table, and
  // boardings a year for the fare revenue table.
  const [benefitEst, setBenefitEst] = useState<BenefitEstimate | null>(null);
  const riders = useMemo(
    () =>
      benefitEst
        ? (Object.fromEntries(
            benefitEst.rows.filter((r) => r.scope === "line").map((r) => [r.id, r.values.ridership_daily]),
          ) as Record<string, Triple>)
        : null,
    [benefitEst],
  );
  const onBenefitEstimate = useCallback((e: BenefitEstimate | null) => setBenefitEst(e), []);
  // The energy section's estimate (energy a year), for the calendar runs.
  const [energyEst, setEnergyEst] = useState<EnergyEstimate | null>(null);
  const tableFigures = useMemo(
    () => ({ estimate: costInfo?.estimate ?? null, riders, energy: energyEst }),
    [costInfo?.estimate, riders, energyEst],
  );
  const farePrices = useMemo(
    () => (costInfo ? { currency: costInfo.currency, perIntl: costInfo.perIntl } : null),
    [costInfo?.currency, costInfo?.perIntl],
  );
  const [build, setBuild] = useState<Build | null>(null);
  // The street line being edited, as the tool last routed it, so the journey planner can ride it.
  const [line, setLine] = useState<StreetLineInput | null>(null);
  // Which street line the tool edits (the number of saved lines for a new one), and a count of switches
  // so the tool opens afresh on the right line after a switch or a delete.
  const [streetIndex, setStreetIndex] = useState(0);
  const [streetSwitch, setStreetSwitch] = useState(0);
  // Cable car and ferry lines from the plugin tools, per tool, for the journey planner.
  const [pluginLines, setPluginLines] = useState<Record<string, PluginLineInput | null>>({});
  // On-demand zones from the service zone kit, for the journey planner.
  const [demandZones, setDemandZones] = useState<Record<string, DemandZone | null>>({});
  // The track topology last built in the railway tool, so street lines wait at its level crossings.
  const [railTopology, setRailTopology] = useState<unknown>(null);
  const [touring, setTouring] = useState(false);
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    setLine(null);
    setStreetIndex(0);
    setPluginLines({});
    setRailTopology(null);
  }, [projectId]);
  if (import.meta.env.DEV) Object.assign(window, { mobsimMap: map });

  useEffect(() => {
    setProject(null);
    setMissing(false);
    api.get(projectId).then(setProject, () => setMissing(true));
  }, [api, projectId]);

  // The plugins this project uses (ADR-0036 §9): bundled ones it has not turned off and installed ones it has
  // turned on. Until they load, the bundled plugins are used.
  const [plugins, setPlugins] = useState<ProjectPlugin[] | null>(null);
  useEffect(() => {
    setPlugins(null);
    let live = true;
    api.plugins(projectId).then(
      (list) => live && setPlugins(list),
      () => live && setPlugins([]),
    );
    return () => {
      live = false;
    };
  }, [api, projectId]);
  const activePlugins = useMemo(() => (plugins ? pluginsOfProject(plugins) : PLUGINS), [plugins]);
  // The registry's helpers (modes, tools, calculations) read the open project's plugins.
  setActivePlugins(activePlugins);
  useEffect(() => () => setActivePlugins(PLUGINS), []);
  // Installed plugins' own code and tab pages (ADR-0036 Phase 2) run for this project, by package.
  setPluginRuntime({
    projectId,
    packages: Object.fromEntries((plugins ?? []).flatMap((p) => (p.sha256 ? [[p.id, p.sha256]] : []))),
  });
  useEffect(() => clearPluginCode, [plugins]);
  const PLUGIN_TOOLS = useMemo(() => pluginTools(activePlugins), [activePlugins]);
  // Plugin tabs show only while their plugin is on for the project.
  const activeTabs = useMemo(() => pluginTabs(activePlugins), [activePlugins]);
  const projectTabs = useMemo(() => {
    const on = new Set(activeTabs.map((x) => x.id));
    const bundled = TABS.filter((x) => !PLUGIN_TABS.some((p) => p.id === x) || on.has(x));
    // Then the tabs of installed plugins, which bring their own pages.
    return [...bundled, ...activeTabs.filter((x) => x.ui && !bundled.includes(x.id)).map((x) => x.id)];
  }, [activeTabs]);
  // A tab the project does not have (a plugin turned off, or a mistyped address) falls back to the simulator.
  useEffect(() => {
    if (plugins && !projectTabs.includes(tab)) onTab("simulator");
  }, [plugins, projectTabs, tab, onTab]);
  const setPlugin = async (pluginId: string, enabled: boolean, version?: string) =>
    setPlugins(await api.setPlugin(projectId, pluginId, enabled, version));

  useEffect(() => {
    if (project) document.title = `${project.name} · ${brand}`;
    return () => {
      document.title = brand;
    };
  }, [project, brand]);

  const onMap = MAP_TABS.includes(tab);
  const editable = project ? can.edit(project) : false;
  const projectKey = project?.id ?? null;
  const runs = useMemo(
    () => (projectKey && typeof api.runs === "function" ? api.runs(projectKey) : null),
    [api, projectKey],
  );
  // Comments on the project's objects: everyone who can read the project reads them; Commenters and up write.
  const commentsApi = useMemo(
    () => (projectKey && typeof api.comments === "function" ? api.comments(projectKey) : null),
    [api, projectKey],
  );
  const roadRuns = useMemo(
    () => (projectKey && typeof api.roadRuns === "function" ? api.roadRuns(projectKey) : null),
    [api, projectKey],
  );
  const calendarRuns = useMemo(
    () => (projectKey && typeof api.calendarRuns === "function" ? api.calendarRuns(projectKey) : null),
    [api, projectKey],
  );
  const demandRuns = useMemo(
    () => (projectKey && typeof api.demandRuns === "function" ? api.demandRuns(projectKey) : null),
    [api, projectKey],
  );
  // The project's population layers (GIS tab). `populationVersion` changes when the layer the project uses
  // changes, so the noise map, the walk analysis and the benefit tables fetch their people again.
  const population = useMemo(
    () => (projectKey && typeof api.population === "function" ? api.population(projectKey) : null),
    [api, projectKey],
  );
  const [populationVersion, setPopulationVersion] = useState(0);
  const fetchPeople = useMemo(
    () => (population ? (bbox: [number, number, number, number]) => population.grid(bbox) : undefined),
    [population, populationVersion],
  );
  const benefitsApiOfProject = useMemo(
    () => (population ? benefitsApi(undefined, population.catchments) : undefined),
    [population, populationVersion],
  );

  // What is drawn in the project, saved with it a moment after each change.
  const drawings = useDrawings(api, projectId, editable);
  const streetLines = drawings.doc<StreetLinesDoc>("street-lines");
  const railway = drawings.doc<Network>("railway");
  // The trains of the rail service lines as last published in the railway tool, for the journey planner.
  const railLines = drawings.doc<Timetable>("rail-timetable");
  // Existing networks imported from GTFS feeds (GTFS plugin), for the journey planner.
  const gtfsFeeds = drawings.doc<GtfsNetworkDoc>("gtfs-network")?.feeds ?? NO_FEEDS;
  // Street setups from the GIS tab: they override OSM in the street line tool and the railway editor.
  const setups = drawings.doc<StreetSetup[]>("street-setups") ?? NO_SETUPS;
  // The demand run the planner picked for ridership (Demand section): its boardings replace the formula
  // estimate in the Tables tab and the system test.
  const ridershipRun = drawings.doc<DemandDoc>("demand")?.ridershipRun ?? null;
  const [demandRidershipState, setDemandRidership] = useState<DemandRidership | null>(null);
  useEffect(() => {
    if (!ridershipRun || !demandRuns) {
      setDemandRidership(null);
      return;
    }
    let alive = true;
    demandRuns.get(ridershipRun).then(
      (r) => {
        if (!alive) return;
        setDemandRidership(
          r.status === "done" && r.result ? demandRidership(r.id, r.finishedAt, r.result) : null,
        );
      },
      () => {
        if (alive) setDemandRidership(null);
      },
    );
    return () => {
      alive = false;
    };
  }, [ridershipRun, demandRuns]);
  const usedRidership = demandRidershipState?.runId === ridershipRun ? demandRidershipState : null;
  // Drawn stops and platforms with their recorded step-free access, for the demand model.
  const stopAccess = useMemo(
    () =>
      schematicNetwork(railway, streetLines).stations.flatMap((st) =>
        st.parts.map((p) => ({ lonlat: p.lonlat, stepFree: partStepFree(p) })),
      ),
    [railway, streetLines],
  );
  const changeSetups = (next: StreetSetup[]) => drawings.set("street-setups", next);
  // GIS tab regions: their values take priority in the benefit tables.
  const regions = drawings.doc<RegionsDoc>("regions")?.regions ?? NO_REGIONS;
  // Benefit tables settings: the project's formulas and its own boardings per station or stop.
  const benefitsDoc = drawings.doc<BenefitsDoc>("benefits");
  // Project preferences: assumption values the project changes, such as the delays in traffic.
  const preferences = drawings.doc<PreferencesDoc>("preferences");
  const journeySettings = useMemo(() => journeySettingsFrom(preferences?.values), [preferences]);
  // Road depots shared by the street lines (depot tool).
  const depotsDoc = drawings.doc<DepotsDoc>("depots");
  // The currency all money is shown in, and its exchange rate (Project preferences).
  const currencyState = useProjectCurrency(preferences, ECONOMY);
  // The country at the project's location, for the calendar's public holidays (Project preferences).
  const place = railway?.origin ?? streetLines?.lines[0]?.points[0]?.lonlat ?? null;
  const placeCountry = usePlaceCountry(place);
  const currency = currencyState.currency;
  const delaysJson = JSON.stringify(delaysFrom(preferences));
  const delays = useMemo(() => JSON.parse(delaysJson) as DelayShares, [delaysJson]);
  const rulesJson = JSON.stringify(designValuesFrom(preferences));
  const designValues = useMemo(() => JSON.parse(rulesJson) as Record<string, number>, [rulesJson]);
  const textsJson = JSON.stringify(designTextsFrom(preferences));
  const designTexts = useMemo(() => JSON.parse(textsJson) as Record<string, string>, [textsJson]);
  const switchJson = JSON.stringify(switchChoiceFrom(preferences));
  const switchChoice = useMemo(
    () => JSON.parse(switchJson) as ReturnType<typeof switchChoiceFrom>,
    [switchJson],
  );
  // The project's own vehicles and its fleet (Project preferences). Own vehicles join the catalogue's for
  // every tool: set them before the tools render, and leave the catalogue alone when the project closes.
  const fleetRaw = drawings.doc<FleetDoc>("fleet");
  const fleet = useMemo(() => (fleetRaw ? fleetFrom(fleetRaw) : EMPTY_FLEET), [fleetRaw]);
  setOwnVehicles(fleet.vehicles);
  useEffect(() => () => setOwnVehicles([]), []);
  const offJson = JSON.stringify([...vehiclesOffFrom(preferences)]);
  const vehiclesOff = useMemo(
    // A new set when the own vehicles change too, so the line tools' vehicle lists render again.
    () => {
      void fleet.vehicles;
      return new Set(JSON.parse(offJson) as string[]) as ReadonlySet<string>;
    },
    [offJson, fleet.vehicles],
  );
  // Street setups made before projects saved drawings were kept in this browser: move them to the project once.
  useEffect(() => {
    if (!drawings.loaded || !editable) return;
    const local = loadSetups(projectId);
    if (local.length && !drawings.doc("street-setups")) drawings.set("street-setups", local);
    forgetSetups(projectId);
  }, [drawings.loaded, editable, projectId]);
  const savedStreet = streetLines?.lines ?? NO_STREET_LINES;
  // Street lines saved before lines had ids get one, so their comments stay with them (Owners and Editors save).
  useEffect(() => {
    if (!drawings.loaded || !editable || !streetLines?.lines.some((l) => !l.id)) return;
    drawings.set("street-lines", {
      ...streetLines,
      lines: streetLines.lines.map((l) => (l.id ? l : { ...l, id: newLineId() })),
    } satisfies StreetLinesDoc);
  }, [drawings.loaded, editable, streetLines]);
  const editedStreet = Math.min(streetIndex, savedStreet.length);
  const switchStreet = (i: number) => {
    setStreetIndex(i);
    setStreetSwitch((n) => n + 1);
    setLine(null);
  };
  const saveStreet = (l: SavedStreetLine) => {
    const next = [...savedStreet];
    next[editedStreet] = { ...l, id: savedStreet[editedStreet]?.id ?? l.id ?? newLineId() };
    drawings.set("street-lines", { lines: next } satisfies StreetLinesDoc);
  };
  const deleteStreet = (i: number) => {
    drawings.set("street-lines", { lines: savedStreet.filter((_, k) => k !== i) } satisfies StreetLinesDoc);
    switchStreet(Math.max(0, i - 1));
  };
  // Every street line for the journey planner, the one being edited as the tool last routed it.
  const ridden = useMemo(
    () =>
      savedStreet
        .map((l, i) => (i === editedStreet && line ? line : lineInput(l)))
        .concat(editedStreet === savedStreet.length && line ? [line] : [])
        .filter((l): l is StreetLineInput => l !== null && l.view.points.length >= 2),
    [savedStreet, editedStreet, line],
  );
  const otherStreet = useMemo(
    () => savedStreet.filter((_, i) => i !== editedStreet),
    [savedStreet, editedStreet],
  );
  // An imported GTFS route becomes a line of the project's own: a street line or a railway service line.
  // The feed then leaves the route out, so it is not ridden twice.
  const [convertError, setConvertError] = useState<string | null>(null);
  const editGtfsRoute = async (feedId: string, routeId: string) => {
    const feed = gtfsFeeds.find((f) => f.id === feedId);
    const pattern = feed && mainPattern(feed.timetable, routeId);
    const kind = pattern ? kindOf(pattern.route.mode) : null;
    if (!feed || !pattern || !kind) return;
    setConvertError(null);
    try {
      if (kind === "street") {
        const e = await loadStreetEngine();
        try {
          const mode = pattern.route.mode as StreetMode;
          const [doc, i] = addStreetLine(
            streetLines,
            toStreetLine(pattern, e.defaultProfile(mode), e.defaultRules()),
          );
          drawings.set("street-lines", doc);
          switchStreet(i);
        } finally {
          e.dispose();
        }
      } else {
        const e = await loadRailEngine();
        try {
          const mode = pattern.route.mode as RailMode;
          const [doc, id] = toRailLine(railway, pattern, mode, e.toLocal, {
            platformLengthM: Number(e.defaultParams(mode).platform_length_m) || 100,
          });
          drawings.set(
            "railway",
            addTerminalCrossovers(doc, id, (d) => e.build(d, null)),
          );
        } finally {
          e.dispose();
        }
      }
      drawings.set("gtfs-network", {
        feeds: gtfsFeeds.map((f) =>
          f.id === feedId ? { ...f, converted: [...(f.converted ?? []), routeId] } : f,
        ),
      } satisfies GtfsNetworkDoc);
      setBuild(kind);
      onTab("create");
    } catch (err) {
      setConvertError(err instanceof Error ? err.message : String(err));
    }
  };
  const hasPanel = onMap && project !== null;
  const pluginTab = projectTabs.includes(tab) ? (activeTabs.find((x) => x.id === tab) ?? null) : null;
  const tabLabel = (x: Tab) => {
    const p = activeTabs.find((y) => y.id === x) ?? PLUGIN_TABS.find((y) => y.id === x);
    if (!p) return t(`tab.${x}` as MessageKey);
    // An installed plugin's tab is named by the plugin.
    if (!p.view) return p.label;
    const key = `plugin.${p.view}.tab` as MessageKey;
    const label = t(key);
    return label === key ? p.label : label;
  };

  const tabs = (
    <nav
      aria-label={t("tab.label")}
      data-tour="tabs"
      className="hidden h-full items-stretch gap-0.5 self-stretch md:ms-2 md:flex"
    >
      {projectTabs.map((x) => {
        const Icon = tabIcon(x);
        return (
          <a
            key={x}
            href={`/projects/${projectId}/${x}`}
            aria-current={tab === x ? "page" : undefined}
            data-tour={`tab-${x}`}
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
    <TopBar
      brand={brand}
      onHome={onHome}
      onAbout={onAbout}
      account={account}
      actions={
        project && (
          <>
            <button
              type="button"
              className="icon-btn hidden sm:inline-flex"
              aria-label={t("print.title")}
              title={t("print.title")}
              aria-haspopup="dialog"
              data-tour="print"
              onClick={() => setPrinting(true)}
            >
              <PrintIcon />
            </button>
            <HelpMenu onTour={() => setTouring(true)} />
          </>
        )
      }
    >
      <button type="button" className="icon-btn md:hidden" aria-label={t("project.back")} onClick={onHome}>
        <BackIcon />
      </button>
      <span className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-slate-700">
        <span className="truncate font-medium">{project?.name ?? "…"}</span>
        {project && !editable && (
          <span className="tag bg-slate-100 text-slate-700">{t("project.viewOnly")}</span>
        )}
        {project?.visibility === "public" && (
          <span className="tag bg-blue-50 text-blue-800" title={t("project.publicNote")}>
            {t("project.public")}
            <span className="sr-only"> · {t("project.publicNote")}</span>
          </span>
        )}
      </span>
      {project && editable && drawings.loaded && <SaveStatus drawings={drawings} />}
      {tabs}
    </TopBar>
  );

  const bottomTabs = (
    <nav
      aria-label={t("tab.label")}
      data-tour="tabs"
      className="flex h-16 shrink-0 border-t border-slate-200 bg-white md:hidden"
    >
      {projectTabs.map((x) => {
        const Icon = tabIcon(x);
        return (
          <button
            key={x}
            type="button"
            aria-current={tab === x ? "page" : undefined}
            data-tour={`tab-${x}`}
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

  // The whole published network for the benefit tables, with the cost tables' line ids.
  const pluginKey = JSON.stringify(pluginLines);
  const networkTimetable = useMemo(
    () =>
      projectTimetable(
        streetLines?.lines ?? [],
        railLines ?? null,
        Object.values(pluginLines).filter((l): l is PluginLineInput => l !== null),
      ),
    [streetLines, railLines, pluginKey],
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
          : chosen === "depots"
            ? t("create.depots")
            : chosenPlugin
              ? chosenPlugin.label
              : t("create.street")
        : tabLabel(pluginTab ? pluginTab.id : "gis");
  const pluginLineList = Object.values(pluginLines).filter((l): l is PluginLineInput => l !== null);
  const demandZoneList = Object.values(demandZones).filter((z): z is DemandZone => z !== null);

  const body = (
    <div className="flex h-full flex-col">
      {top}
      {drawings.clash && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-950"
        >
          <p className="min-w-48 flex-1">
            {t("save.conflict", {
              who: drawings.clash.by ?? t("save.someone"),
              drawing: t(`drawing.${drawings.clash.kind}` as MessageKey),
            })}
          </p>
          <button type="button" className="btn min-h-10" onClick={drawings.keepMine}>
            {t("save.keepMine")}
          </button>
          <button type="button" className="btn btn-pri min-h-10" onClick={drawings.takeTheirs}>
            {t("save.takeTheirs")}
          </button>
        </div>
      )}
      {drawings.loadError && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 border-b border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-900"
        >
          <p className="min-w-48 flex-1">{t("save.loadFailed", { error: drawings.loadError })}</p>
          <button type="button" className="btn min-h-10" onClick={drawings.reload}>
            {t("save.retry")}
          </button>
        </div>
      )}
      <main className="relative flex min-h-0 flex-1 flex-col md:flex-row">
        <div className={`relative min-h-0 min-w-0 flex-1 ${onMap ? "" : "hidden"}`}>
          <MapView onReady={setMap} />
          {project && drawings.loaded && tab === "create" && editable && chosen === "street" && (
            <StreetLineEditor
              key={`${projectId}-${drawings.generation("street-lines")}-${streetSwitch}`}
              map={map}
              panel={panel}
              onLineChange={setLine}
              streetSetups={setups}
              delays={delays}
              initial={savedStreet[editedStreet] ?? null}
              onSave={saveStreet}
              defaultName={t("street.lineN", { n: editedStreet + 1 })}
              otherLines={otherStreet}
              lineList={
                <LineList
                  names={savedStreet.map((l) => l.name)}
                  ids={savedStreet.map((l) => l.id)}
                  current={editedStreet}
                  onSelect={switchStreet}
                  onNew={() => switchStreet(savedStreet.length)}
                  onDelete={deleteStreet}
                />
              }
              railTopology={railTopology}
              depots={depotsDoc?.depots ?? NO_DEPOTS}
              onOpenDepots={() => setBuild("depots")}
            />
          )}
          {project && drawings.loaded && tab === "create" && editable && chosen === "depots" && (
            <DepotEditor
              key={`${projectId}-${drawings.generation("depots")}`}
              map={map}
              panel={panel}
              doc={depotsDoc ?? null}
              onDoc={(d) => drawings.set("depots", d)}
              lines={savedStreet}
              prefs={preferences?.values}
            />
          )}
          {project && drawings.loaded && tab === "create" && editable && chosen === "rail" && (
            <RailwayEditor
              key={`${projectId}-${drawings.generation("railway")}`}
              map={map}
              panel={panel}
              streetSetups={setups}
              delays={delays}
              designValues={designValues}
              designTexts={designTexts}
              prefValues={preferences?.values}
              calendar={calendarFrom(preferences)}
              switchChoice={switchChoice}
              stationGroupingM={paramNumber("analysis.station_grouping_m", preferences?.values)}
              existingRailways={existingRailways}
              initial={railway}
              onDocChange={(d) => drawings.set("railway", d)}
              onTopologyChange={setRailTopology}
              onPublish={(tt) => tt && drawings.set("rail-timetable", tt)}
            />
          )}
          {project && tab === "create" && editable && chosenPlugin?.kit === "straight-spans" && (
            <SpanLineEditor
              key={`${projectId}-${chosenPlugin.id}`}
              map={map}
              panel={panel}
              tool={chosenPlugin}
              storageKey={`mobsimlab:${chosenPlugin.id}:${projectId}`}
              onLineChange={(l) => setPluginLines((p) => ({ ...p, [chosenPlugin.id]: l }))}
            />
          )}
          {project && tab === "create" && editable && chosenPlugin?.kit === "service-zone" && (
            <ZoneEditor
              key={`${projectId}-${chosenPlugin.id}`}
              map={map}
              panel={panel}
              tool={chosenPlugin}
              storageKey={`mobsimlab:${chosenPlugin.id}:${projectId}`}
              onZoneChange={(z) => setDemandZones((p) => ({ ...p, [chosenPlugin.id]: z }))}
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
          {project && drawings.loaded && tab === "gis" && gis === "regions" && (
            <RegionEditor
              map={map}
              panel={panel}
              regions={regions}
              onChange={(next) => drawings.set("regions", { regions: next } satisfies RegionsDoc)}
              editable={editable}
              currency={currency?.code ?? costInfo?.currency ?? null}
            />
          )}
          {project && drawings.loaded && tab === "gis" && gis === "zones" && (
            <DemandZoneEditor
              map={map}
              panel={panel}
              timetable={networkTimetable}
              preferences={preferences}
              doc={drawings.doc<DemandDoc>("demand")}
              onDoc={editable ? (d) => drawings.set("demand", d) : undefined}
            />
          )}
          {project && tab === "gis" && gis === "population" && (
            <PopulationPanel
              map={map}
              panel={panel}
              api={population}
              editable={editable}
              onPrimaryChange={() => setPopulationVersion((n) => n + 1)}
            />
          )}
          {project && drawings.loaded && tab === "gis" && gis === "streets" && (
            <StreetSetupEditor
              map={map}
              panel={panel}
              setups={setups}
              onChange={changeSetups}
              editable={editable}
              delays={delays}
            />
          )}
          {project && drawings.loaded && pluginTab?.view === "cargo-bike" && (
            <CargoBikeTab
              key={`${projectId}-${drawings.generation("cargo-bike")}`}
              map={map}
              panel={panel}
              doc={drawings.doc<CargoBikeDoc>("cargo-bike")}
              onDoc={editable ? (d) => drawings.set("cargo-bike", d) : undefined}
              setups={setups}
              currency={currency}
            />
          )}
          {project && tab === "simulator" && sim === "journey" && (
            <JourneyPlanner
              map={map}
              panel={panel}
              streetLines={ridden}
              railLines={railLines}
              pluginLines={pluginLineList}
              demandZones={demandZoneList}
              sameNameM={sameNameStationM(preferences?.values)}
              projectSettings={journeySettings}
              gtfsFeeds={gtfsFeeds}
              {...(editable ? { onGtfsFeeds: (d: GtfsNetworkDoc) => drawings.set("gtfs-network", d) } : {})}
              projectName={project.name}
              allDayFeed={async () => {
                const cal = calendarFrom(preferences);
                const today = new Date();
                const waitMin = paramValue("timetable.max_terminal_wait_min", "*", preferences?.values)[1];
                const timetable = await projectFeed({
                  railway,
                  streetLines: savedStreet,
                  pluginLines: pluginLineList,
                  cal,
                  options: { max_idle_s: waitMin * 60 },
                  values: preferences?.values ?? null,
                });
                return {
                  timetable,
                  holidays: feedHolidays(cal, today, new Date(today.getTime() + 365 * 86_400_000)),
                };
              }}
              {...(editable ? { onEditGtfsRoute: (f: string, r: string) => void editGtfsRoute(f, r) } : {})}
            />
          )}
          {convertError && tab === "simulator" && (
            <p
              role="alert"
              className="absolute top-2 left-1/2 z-30 -translate-x-1/2 rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-sm text-red-900"
            >
              {convertError}
            </p>
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
                    ...PLUGIN_TOOLS.map((x) => {
                      // A guideway tool (people mover) gets the train icon, a ropeway the cable car.
                      const guided = x.modes.some((m) => findMode(m)?.mode.family === "guided");
                      return [
                        x.id,
                        x.kit === "water-route"
                          ? FerryIcon
                          : x.kit === "service-zone"
                            ? BusIcon
                            : guided
                              ? TrainIcon
                              : CableIcon,
                        x.label,
                        x.hint ?? "",
                        x.kit === "water-route"
                          ? "bg-cyan-100 text-cyan-900"
                          : x.kit === "service-zone"
                            ? "bg-purple-100 text-purple-900"
                            : guided
                              ? "bg-teal-100 text-teal-900"
                              : "bg-violet-100 text-violet-900",
                      ] as const;
                    }),
                  ].map(([kind, Icon, title, hint, colour]) => (
                    <button
                      key={kind}
                      type="button"
                      className="flex flex-col gap-2.5 rounded-2xl border-[1.5px] border-slate-200 bg-white p-4 text-start hover:border-blue-700 hover:ring-[3px] hover:ring-blue-100 focus-visible:border-blue-700 focus-visible:ring-[3px] focus-visible:ring-blue-100 focus-visible:outline-none"
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
            <ProjectPreferences
              key={project.updatedAt}
              api={api}
              project={project}
              onSaved={setProject}
              preferences={drawings.loaded ? preferences : null}
              onPreferences={drawings.loaded ? (d) => drawings.set("preferences", d) : undefined}
              plugins={plugins}
              onSetPlugin={setPlugin}
              currency={currencyState}
              fleet={drawings.loaded ? fleet : null}
              onFleet={drawings.loaded ? (d) => drawings.set("fleet", d) : undefined}
              depots={depotsDoc?.depots ?? NO_DEPOTS}
              country={placeCountry}
              place={place}
            />
          </div>
        )}
        {!onMap && project && drawings.loaded && pluginTab?.ui && (
          <PluginFrame
            plugin={activePlugins.find((p) => p.id === pluginTab.plugin)!}
            tab={pluginTab}
            data={{ timetable: networkTimetable, streetLines: streetLines?.lines ?? [] }}
          />
        )}
        {!onMap && tab === "schematic" && (
          <div className="min-h-0 flex-1">
            {project && drawings.loaded ? (
              <Schematic
                railway={railway}
                streetLines={streetLines}
                pluginLines={pluginLineList}
                prefs={preferences?.values}
                doc={drawings.doc<SchematicDoc>("schematic")}
                onDoc={editable ? (d) => drawings.set("schematic", d) : undefined}
                projectName={project.name}
                onCreate={editable ? () => onTab("create") : undefined}
              />
            ) : (
              <p role="status" className="mt-6 text-center text-slate-500">
                {t("common.loading")}
              </p>
            )}
          </div>
        )}
        {!onMap && tab === "tables" && (
          <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50">
            <section aria-label={t("tables.title")} className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-10">
              <h1 className="text-2xl font-semibold tracking-tight">{t("tables.title")}</h1>
              <p className="mt-1 text-slate-600">{t("tables.intro")}</p>
              {project && drawings.loaded ? (
                <>
                  <NetworkTables
                    railway={railway}
                    streetLines={streetLines}
                    preferences={preferences}
                    onPreferences={editable ? (d) => drawings.set("preferences", d) : undefined}
                    riders={riders}
                    onEnergy={setEnergyEst}
                  />
                  <TimetableTables
                    projectName={project.name}
                    railway={railway}
                    streetLines={streetLines}
                    preferences={preferences}
                    onPreferences={editable ? (d) => drawings.set("preferences", d) : undefined}
                  />
                  <CostTables
                    railway={railway}
                    streetLines={streetLines}
                    preferences={preferences}
                    onPreferences={editable ? (d) => drawings.set("preferences", d) : undefined}
                    costs={drawings.doc<CostsDoc>("costs")}
                    onCosts={editable ? (d) => drawings.set("costs", d) : undefined}
                    currency={currency}
                    onEstimate={onCostEstimate}
                  />
                </>
              ) : (
                <p role="status" className="mt-6 text-slate-500">
                  {t("common.loading")}
                </p>
              )}
              {project && drawings.loaded && (
                <BenefitTables
                  api={benefitsApiOfProject}
                  timetable={networkTimetable}
                  regions={regions}
                  preferences={preferences}
                  onPreferences={editable ? (d) => drawings.set("preferences", d) : undefined}
                  doc={benefitsDoc}
                  onDoc={editable ? (d) => drawings.set("benefits", d) : undefined}
                  costs={costInfo}
                  onEstimate={onBenefitEstimate}
                  ridership={usedRidership}
                />
              )}
              {project && drawings.loaded && (
                <DemandSection
                  timetable={networkTimetable}
                  regions={regions}
                  preferences={preferences}
                  doc={drawings.doc<DemandDoc>("demand")}
                  onDoc={editable ? (d) => drawings.set("demand", d) : undefined}
                  costs={costInfo}
                  runs={demandRuns}
                  canRun={editable}
                  streetSetups={setups}
                  stopAccess={stopAccess}
                  onPreferences={editable ? (d) => drawings.set("preferences", d) : undefined}
                  api={benefitsApiOfProject}
                />
              )}
              {project && drawings.loaded && (
                <PluginCalculations
                  data={{ timetable: networkTimetable, streetLines: streetLines?.lines ?? [] }}
                />
              )}
              {project && drawings.loaded && (
                <FareTables
                  benefits={benefitEst}
                  railway={railway}
                  streetLines={streetLines}
                  pluginLines={pluginLineList}
                  prefs={preferences?.values}
                  schematic={drawings.doc<SchematicDoc>("schematic")}
                  boardings={benefitsDoc?.boardings}
                  prices={farePrices}
                  doc={drawings.doc<FaresDoc>("fares")}
                  onDoc={editable ? (d) => drawings.set("fares", d) : undefined}
                />
              )}
              {project && drawings.loaded && (
                <Scenarios
                  railway={railway}
                  streetLines={streetLines}
                  preferences={preferences}
                  doc={drawings.doc<ScenariosDoc>("scenarios")}
                  currency={currency}
                  onChange={editable ? (d) => drawings.set("scenarios", d) : undefined}
                />
              )}
            </section>
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
            data-tour="panel"
            className={`flex max-h-[55%] shrink-0 flex-col overflow-hidden rounded-t-2xl border-t border-slate-200 bg-white shadow-[0_-4px_20px_rgba(15,23,42,.12)] md:max-h-none md:rounded-none md:border-t-0 md:border-s md:shadow-none ${tab === "simulator" && sim === "journey" ? "md:w-[26rem]" : "md:w-96"}`}
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
                  <button
                    type="button"
                    role="tab"
                    aria-selected={sim === "road"}
                    onClick={() => setSim("road")}
                  >
                    {t("sim.road")}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={sim === "calendar"}
                    onClick={() => setSim("calendar")}
                  >
                    {t("calrun.tab")}
                  </button>
                </div>
              </div>
            )}
            {tab === "gis" && (
              <div className="shrink-0 px-4 pt-3 pb-2 md:px-5 md:pt-5">
                <div className="seg" role="tablist" aria-label={tabLabel("gis")}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={gis === "streets"}
                    onClick={() => setGis("streets")}
                  >
                    {t("gis.streetsView")}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={gis === "regions"}
                    onClick={() => setGis("regions")}
                  >
                    {t("gis.regionsView")}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={gis === "zones"}
                    onClick={() => setGis("zones")}
                  >
                    {t("gis.zonesView")}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={gis === "population"}
                    onClick={() => setGis("population")}
                  >
                    {t("gis.populationView")}
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
                  <button
                    type="button"
                    role="tab"
                    aria-selected={chosen === "depots"}
                    onClick={() => setBuild("depots")}
                  >
                    {t("create.depots")}
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
                <CapacityRun
                  demandRidership={usedRidership}
                  runs={runs}
                  canRun={editable}
                  railway={railway}
                  streetLines={streetLines?.lines}
                  prefs={preferences?.values}
                  ridership={
                    project && drawings.loaded
                      ? {
                          timetable: networkTimetable,
                          regions,
                          prefs: preferences?.values,
                          doc: benefitsDoc,
                          country: drawings.doc<{ country?: string | null }>("costs")?.country ?? null,
                        }
                      : null
                  }
                  ownBoardings={benefitsDoc?.boardings}
                  onOwnBoardings={
                    editable
                      ? (b) => drawings.set("benefits", { ...(benefitsDoc ?? {}), boardings: b })
                      : undefined
                  }
                />
              )}
              {tab === "simulator" && sim === "road" && (
                <RoadSimulation
                  api={roadRuns}
                  canRun={editable}
                  map={map}
                  streetLines={streetLines?.lines}
                  depots={depotsDoc?.depots}
                  setups={setups}
                  prefs={preferences?.values}
                />
              )}
              {tab === "simulator" && sim === "calendar" && (
                <CalendarRun
                  api={calendarRuns}
                  canRun={editable}
                  railway={railway}
                  streetLines={savedStreet}
                  preferences={preferences}
                  onPreferences={
                    editable && drawings.loaded ? (d) => drawings.set("preferences", d) : undefined
                  }
                  tables={tableFigures}
                  currency={costInfo?.currency ?? null}
                  onOpenTables={() => onTab("tables")}
                  onOpenPreferences={() => onTab("preferences")}
                />
              )}
              {tab === "create" && !editable && (
                <div className="px-4 py-5 md:px-5">
                  <h2 className="text-lg font-semibold">{t("create.readOnlyTitle")}</h2>
                  <p className="mt-1 text-slate-600">{t("create.readOnly")}</p>
                  {drawings.loaded && (
                    <div className="mt-5 border-t border-slate-200 pt-5">
                      <CommentsPanel objects={commentableObjects(t, railway, streetLines, depotsDoc)} />
                    </div>
                  )}
                </div>
              )}
              {tab === "create" && editable && chosen === null && (
                <p className="px-4 py-5 text-slate-600 md:px-5">{t("create.chooseFirst")}</p>
              )}
              {/* The street line tool, railway editor, journey planner and street setup render their panels here. */}
              <div key={`${tab}-${sim}-${chosen}-${gis}`} ref={setPanel} />
              {tab === "gis" && project && drawings.loaded && (
                <div className="border-t border-slate-200 px-4 py-5 md:px-5">
                  <WalkAnalysis
                    map={map}
                    fetchPeople={fetchPeople}
                    streetLines={streetLines}
                    railway={railway}
                    preferences={preferences?.values}
                  />
                </div>
              )}
              {tab === "gis" && project && drawings.loaded && noiseCalculationIn("gis") && (
                <div className="border-t border-slate-200 px-4 py-5 md:px-5">
                  <NoiseMap
                    map={map}
                    fetchPeople={fetchPeople}
                    streetLines={streetLines}
                    railway={railway}
                    preferences={preferences?.values}
                    scenarios={drawings.doc<ScenariosDoc>("scenarios")}
                    roadRuns={roadRuns}
                  />
                </div>
              )}
            </div>
          </aside>
        )}
      </main>
      {bottomTabs}
      {touring && <Tour steps={PROJECT_TOUR} onTab={onTab} onClose={() => setTouring(false)} />}
      {printing && project && (
        <PrintReport
          projectName={project.name}
          areaName={project.areaName}
          map={map}
          mapOnScreen={onMap}
          onClose={() => setPrinting(false)}
          tables={
            drawings.loaded && (
              <CostTables
                railway={railway}
                streetLines={streetLines}
                preferences={preferences}
                costs={drawings.doc<CostsDoc>("costs")}
              />
            )
          }
        />
      )}
    </div>
  );
  // The catalogue vehicles the project does not use reach the line tools (Project preferences → Vehicles).
  return (
    <VehiclesOffContext.Provider value={vehiclesOff}>
      <CommentsProvider
        api={commentsApi}
        canComment={project ? can.comment(project) : false}
        isOwner={project ? can.manage(project) : false}
        userId={userId}
      >
        {body}
      </CommentsProvider>
    </VehiclesOffContext.Provider>
  );
}

/** Purpose: how the project's drawings stand against the server, beside the project name. */
function SaveStatus({ drawings }: { drawings: Drawings }) {
  const { t } = useI18n();
  const s = drawings.status;
  if (s === "conflict") return null;
  const text =
    s === "saved"
      ? t("save.saved")
      : s === "saving"
        ? t("save.saving")
        : s === "offline"
          ? t("save.offline")
          : t("save.failed", { error: drawings.error ?? "" });
  return (
    <span
      role="status"
      title={text}
      data-tour="save"
      className={`hidden max-w-56 truncate text-xs sm:inline ${s === "failed" || s === "offline" ? "text-red-700" : "text-slate-500"}`}
    >
      {text}
    </span>
  );
}

/**
 * Purpose: the ISO alpha-2 code of the country at a place (rounded to about a kilometre, asked once per place),
 * or null while unknown or at sea.
 */
function usePlaceCountry(place: readonly [number, number] | null): string | null {
  const [code, setCode] = useState<{ key: string; iso2: string | null } | null>(null);
  const key = place ? `${place[0].toFixed(2)},${place[1].toFixed(2)}` : null;
  useEffect(() => {
    if (!place || !key || code?.key === key) return;
    let stop = false;
    ECONOMY.countryAt([place[0], place[1]])
      .then((c) => {
        if (!stop) setCode({ key, iso2: c.iso2 });
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [key]);
  return code && code.key === key ? code.iso2 : null;
}
