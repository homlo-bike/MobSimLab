import type { Map as MapLibreMap } from "maplibre-gl";
import { type ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { partStepFree, schematicNetwork } from "../features/schematic/lines";
import { type DemandRidership, demandRidership } from "../features/demand/ridership";
import type { DemandDoc } from "../features/demand/zones";
import type { Estimate as BenefitEstimate } from "../features/benefits/model";
import type { Triple } from "../features/benefits/params";
import type { BenefitsDoc } from "../features/benefits/formulas";
import { benefitsApi } from "../features/benefits/data";
import type { Region, RegionsDoc } from "../features/benefits/regions";
import { MapDataPanel } from "../features/geodata/MapDataPanel";
import { type LiveData, setDataProject, watchLiveData } from "../geodata/projectData";
import { projectTimetable } from "../features/benefits/timetable";
import type { CargoBikeDoc } from "../features/cargo-bike/model";
import { AreaChecks } from "../features/area/AreaChecks";
import { economyApi, type Prices } from "../features/costs/economy";
import { useProjectCurrency } from "../features/costs/currency";
import type { Estimate as CostEstimate } from "../features/costs/model";
import type { CostsDoc } from "../features/costs/CostTables";
import { journeySettingsFrom } from "../features/journey-planner/projectSettings";
import { feedHolidays, projectFeed } from "../features/timetables/feed";
import { publishOptionsFrom } from "../features/timetables/railPublish";
import type { AppraisalDoc } from "../features/appraisal/model";
import type { FareInput, FaresDoc } from "../features/fares/model";
import type { ScenariosDoc } from "../features/tables/scenarioModel";
import { noiseCalculationIn } from "../features/noise/plugin";
import {
  type PluginLineInput,
  type ServiceDay,
  setProjectServiceDay,
  type StreetLineInput,
} from "../features/journey-planner/network";
import type { GtfsFeed, GtfsNetworkDoc } from "../features/gtfs/types";
import type { Timetable } from "../features/journey-planner/types";
import type { SchematicDoc } from "../features/schematic/Schematic";
import type { Network } from "../features/railways/types";
import { LineList } from "../features/street-lines/LineList";
import { StreetLinePicker } from "../features/street-lines/StreetLinePicker";
import { PlannedModesProvider, plansRail, plansStreet } from "../projects/plannedModes";
import { ToolPalette } from "../features/street-lines/ToolPalette";
import {
  lineInput,
  newLineId,
  nextLineColor,
  withLineColors,
  type SavedStreetLine,
  type StreetLinesDoc,
} from "../features/street-lines/saved";
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
import type { JunctionSetup, StreetSetup } from "../features/street-setup/types";
import { useI18n } from "../i18n/i18n";
import type { MessageKey } from "../i18n/messages";
import {
  lineToolId,
  newToolLineKey,
  type PluginLinesDoc,
  type SavedPluginLine,
  toolLineKeys,
} from "../kits/saved";
import type { SpanDoc } from "../kits/SpanLineEditor";
import type { LineList as KitLineList } from "../kits/LinePicker";
import type { LonLat, Pier } from "../kits/types";
import type { WaterDoc } from "../kits/WaterRouteEditor";
import type { DemandZone } from "../kits/ZoneEditor";
import { MapView } from "../map/MapView";
import {
  localizePlugins,
  PLUGINS,
  pluginTabs,
  type ProjectPlugin,
  pluginsOfProject,
  type PluginTool,
  pluginTools,
  setActivePlugins,
} from "../plugins/registry";
import { can, type Project, type ProjectsApi } from "../projects/api";
import {
  BackIcon,
  CargoBikeIcon,
  GearIcon,
  LayersIcon,
  PenIcon,
  PlayIcon,
  RedoIcon,
  SchematicIcon,
  TableIcon,
  UndoIcon,
} from "../shell/icons";
import { ChecksProvider } from "../shell/checks";
import { JobsBar, JobsProvider } from "../shell/jobs";
import { PINNED_LAYERS, type PinnedLayer, PinnedLayersContext } from "../map/pinnedLayers";
import { PinnedLayers, pinnableLayers, type ProjectContent } from "./PinnedLayers";
import { ImportsWatcher } from "../features/geodata/ImportsWatcher";
import { COMMENT_KIND, ChecksMenu } from "../shell/ChecksMenu";
import { OtherModesLayer } from "./OtherModesLayer";
import { type CoreTab, type Tab, TABS } from "../shell/route";
import { HelpMenu } from "../shell/HelpMenu";
import { lazyNamed, LoadingScreen } from "../shell/lazy";
import { TopBar } from "../shell/TopBar";
import { PROJECT_TOUR, Tour } from "../shell/Tour";
import { calendarFrom, serviceDayFor, weekendOf } from "./calendar";
import { WeekendContext } from "./dayTypeLabel";
import {
  delaysFrom,
  designTextsFrom,
  designValuesFrom,
  type PreferencesDoc,
  paramNumber,
  sameNameStationM,
  streetRulesFrom,
  choiceValue,
  countryDrivingSide,
  DRIVING_SIDE_PREF,
  withCountryDrivingSide,
  switchChoiceFrom,
  vehiclesOffFrom,
} from "./preferences";
import { VehiclesOffContext } from "./projectVehicles";
import { EMPTY_FLEET, fleetFrom, type FleetDoc } from "../features/fleet/model";
import { setOwnVehicles } from "../features/fleet/registry";
import type { DelayShares } from "../features/street-lines/types";
import { drawnBox } from "../features/area/drawnBox";
import { useAreaZoom } from "../features/area/useAreaZoom";
import { type Drawings, useDrawings } from "./useDrawings";
import type { EnergyEstimate } from "../features/energy/types";
import { setPluginRuntime } from "../plugins/code/context";
import { PluginCalculations } from "../plugins/code/PluginCalculations";
import { TablePart, TablesSection } from "../features/tables/sections";
import { shownPart, TablesNav } from "../features/tables/TablesNav";
import { PluginFrame } from "../plugins/code/PluginFrame";
import { clearPluginCode } from "../plugins/code/runtime";
import { STATIC_TABS, STATIC_VIEWER } from "../static/mode";
import { CommentsProvider } from "../features/comments/Comments";
import { ObjectComments, objectKey } from "../features/comments/Comments";
import { commentableObjects, CommentsPanel } from "../features/comments/CommentsPanel";
import {
  type CommentNotice,
  openCommentsLater,
  takePendingComments,
  useCommentNotices,
} from "../features/comments/notices";
import { Dialog } from "../shell/Dialog";
import type { DepotsDoc, SavedDepot } from "../features/depots/types";
import { UnroutedNotice } from "../features/tables/UnroutedNotice";
import { engineErrorText } from "../i18n/engine";

// Editors and screens downloaded when first opened, so opening a project fetches only the tab shown.
const BenefitTables = lazyNamed(() => import("../features/benefits/BenefitTables"), "BenefitTables");
const DemandSection = lazyNamed(() => import("../features/demand/DemandSection"), "DemandSection");
const DemandZoneEditor = lazyNamed(() => import("../features/demand/ZoneEditor"), "DemandZoneEditor");
const RegionEditor = lazyNamed(() => import("../features/benefits/RegionEditor"), "RegionEditor");
const PopulationPanel = lazyNamed(() => import("../features/population/PopulationPanel"), "PopulationPanel");
const CargoBikeTab = lazyNamed(() => import("../features/cargo-bike/CargoBikeTab"), "CargoBikeTab");
const CapacityRun = lazyNamed(() => import("../features/capacity/CapacityRun"), "CapacityRun");
const RoadSimulation = lazyNamed(() => import("../features/road-sim/RoadSimulation"), "RoadSimulation");
const CostTables = lazyNamed(() => import("../features/costs/CostTables"), "CostTables");
const WalkAnalysis = lazyNamed(() => import("../features/walk/WalkAnalysis"), "WalkAnalysis");
const JourneyPlanner = lazyNamed(
  () => import("../features/journey-planner/JourneyPlanner"),
  "JourneyPlanner",
);
const NoiseMap = lazyNamed(() => import("../features/noise/NoiseMap"), "NoiseMap");
const NetworkTables = lazyNamed(() => import("../features/tables/NetworkTables"), "NetworkTables");
const TimetableTables = lazyNamed(() => import("../features/timetables/TimetableTables"), "TimetableTables");
const FareTables = lazyNamed(() => import("../features/fares/FareTables"), "FareTables");
const AppraisalSection = lazyNamed(
  () => import("../features/appraisal/AppraisalSection"),
  "AppraisalSection",
);
const Scenarios = lazyNamed(() => import("../features/tables/Scenarios"), "Scenarios");
const RailwayEditor = lazyNamed(() => import("../features/railways/RailwayEditor"), "RailwayEditor");
const Schematic = lazyNamed(() => import("../features/schematic/Schematic"), "Schematic");
const MapExports = lazyNamed(() => import("../features/schematic/MapExports"), "MapExports");
const StreetLineEditor = lazyNamed(
  () => import("../features/street-lines/StreetLineEditor"),
  "StreetLineEditor",
);
const LanesBackdrop = lazyNamed(() => import("../features/street-setup/LanesBackdrop"), "LanesBackdrop");
const StreetSetupEditor = lazyNamed(
  () => import("../features/street-setup/StreetSetupEditor"),
  "StreetSetupEditor",
);
const SpanLineEditor = lazyNamed(() => import("../kits/SpanLineEditor"), "SpanLineEditor");
const WaterRouteEditor = lazyNamed(() => import("../kits/WaterRouteEditor"), "WaterRouteEditor");
const ZoneEditor = lazyNamed(() => import("../kits/ZoneEditor"), "ZoneEditor");
const ProjectPreferences = lazyNamed(() => import("./ProjectPreferences"), "ProjectPreferences");
const CalendarRun = lazyNamed(() => import("../features/calendar-run/CalendarRun"), "CalendarRun");
const DepotEditor = lazyNamed(() => import("../features/depots/DepotEditor"), "DepotEditor");

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
const NO_PINS: readonly PinnedLayer[] = [];
const NO_SETUPS: StreetSetup[] = [];
const NO_JUNCTIONS: JunctionSetup[] = [];
const NO_STREET_LINES: SavedStreetLine[] = [];

type SimView = "test" | "journey" | "road" | "calendar";
type GisView = "streets" | "regions" | "zones" | "population" | "data";
const NO_REGIONS: Region[] = [];
const NO_FEEDS: GtfsFeed[] = [];
const NO_PLUGIN_LINES: Record<string, SavedPluginLine> = {};
const NO_DEPOTS: SavedDepot[] = [];
const NO_MODES: string[] = [];
/** The modifier key of shortcuts as the keyboard shows it. */
const MOD_KEY =
  typeof navigator !== "undefined" && /Mac|iP(hone|ad)/.test(navigator.platform) ? "⌘" : "Ctrl+";
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
  onOpenProject,
  existingRailways = false,
  userId = null,
  onRefreshSession,
  pinnedLayers = NO_PINS,
  onPinnedLayers,
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
  /** Open another project (a notice of a new comment there was chosen in the bell). */
  onOpenProject?: (id: string) => void;
  /** Draw existing railways from OpenStreetMap in the railway tool (app setting). */
  existingRailways?: boolean;
  /** The signed-in person, so they can edit and delete their own comments. */
  userId?: string | null;
  /** Load the session again (a fresh CSRF token), before saving again after a refused save. */
  onRefreshSession?: () => void;
  /** The project layers this person keeps shown on every map tab (saved in their account). */
  pinnedLayers?: readonly PinnedLayer[];
  onPinnedLayers?: (layers: PinnedLayer[]) => void;
}) {
  const { t, language } = useI18n();
  const [project, setProject] = useState<Project | null>(null);
  const [missing, setMissing] = useState(false);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const [sim, setSim] = useState<SimView>("test");
  // The group of tables shown in the Tables tab, and its scrolling area (back to the top on a change).
  const [tablesView, setTablesView] = useState("network");
  // The section chosen in each group of the Tables tab; a group opens on its first section.
  const [tablesParts, setTablesParts] = useState<Record<string, string>>({});
  const tablesScroll = useRef<HTMLDivElement>(null);
  const [gis, setGis] = useState<GisView>("streets");
  // The Walk to a stop analysis under Demand zones, folded away until opened.
  const [walkOpen, setWalkOpen] = useState(false);
  // The cost tables' estimate, currency and country, for the benefit tables.
  const [costInfo, setCostInfo] = useState<{
    estimate: CostEstimate;
    currency: string | null;
    country: string | null;
    /** World Bank income group of the country (HIC, UMC, LMC, LIC), or null; the appraisal's social rate. */
    income: string | null;
    rate: number;
    /** Local currency units per international $ (the demand model's fares and car costs). */
    ppp: number;
    /** Units of the currency per 2023 international dollar (PPP factor × price escalation), for fares. */
    perIntl: number;
  } | null>(null);
  const onCostEstimate = useCallback(
    (estimate: CostEstimate, prices: Prices, country: string | null, rate: number, income: string | null) =>
      setCostInfo({
        estimate,
        currency: prices.currency,
        country,
        income,
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
  // The fare revenue table's input, for the appraisal's fare revenue draws.
  const [fareInput, setFareInput] = useState<FareInput | null>(null);
  const appraisalCosts = useMemo(
    () =>
      costInfo
        ? {
            estimate: costInfo.estimate,
            currency: costInfo.currency,
            income: costInfo.income,
            perIntl: costInfo.perIntl,
          }
        : null,
    [costInfo],
  );
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
  // The Create tool last used in this project, remembered in this browser so a reload reopens it.
  const [build, setBuildState] = useState<Build | null>(() => {
    try {
      return localStorage.getItem(`msl.create.tool.${projectId}`);
    } catch {
      return null;
    }
  });
  const setBuild = useCallback(
    (b: Build | null) => {
      setBuildState(b);
      try {
        if (b) localStorage.setItem(`msl.create.tool.${projectId}`, b);
      } catch {
        // Storage blocked: the tool is simply not remembered.
      }
    },
    [projectId],
  );
  // The street line being edited, as the tool last routed it, so the journey planner can ride it.
  const [line, setLine] = useState<StreetLineInput | null>(null);
  // Which street line the tool edits (the number of saved lines for a new one; null while none is picked), and
  // a count of switches so the tool opens afresh on the right line after a switch or a delete.
  const [streetIndex, setStreetIndex] = useState<number | null>(null);
  const [streetSwitch, setStreetSwitch] = useState(0);
  // On-demand zones from the service zone kit, for the journey planner.
  const [demandZones, setDemandZones] = useState<Record<string, DemandZone | null>>({});
  // The track topology last built in the railway tool, so street lines wait at its level crossings.
  const [railTopology, setRailTopology] = useState<unknown>(null);
  const [touring, setTouring] = useState(false);
  // The object whose comments show in a dialog: a notice in the bell was chosen.
  const [commentsOf, setCommentsOf] = useState<{ type: CommentNotice["objectType"]; id: string } | null>(
    null,
  );
  useEffect(() => setCommentsOf(takePendingComments(projectId)), [projectId]);
  useEffect(() => {
    setLine(null);
    setStreetIndex(null);
    setRailTopology(null);
  }, [projectId]);
  if (import.meta.env.DEV) Object.assign(window, { mobsimMap: map });

  useEffect(() => {
    setProject(null);
    setMissing(false);
    api.get(projectId).then(setProject, () => setMissing(true));
  }, [api, projectId]);

  // A project opens with the map on its area, or on its drawing when it has no area (Damascus bug 23).
  const areaView = useAreaZoom(
    map,
    projectId,
    typeof api.area === "function" ? (id: string) => api.area(id).get() : null,
    typeof api.drawings === "function" ? (id: string) => api.drawings(id).then(drawnBox) : null,
  );

  // The map tools read this project's imported OpenStreetMap and elevation data where it has some (ADR-0046).
  const geodata = useMemo(() => api.geodata(projectId), [api, projectId]);
  useEffect(() => {
    let open = true;
    setDataProject(projectId);
    // An answer that arrives after the project closed, or without import state, changes nothing.
    geodata.status().then(
      (s) => {
        if (open) setDataProject(projectId, s?.osm?.current?.id ?? null);
      },
      () => undefined,
    );
    return () => {
      open = false;
      setDataProject(null);
    };
  }, [geodata, projectId]);

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
  // The project's plugins, with their texts in the language shown.
  const activePlugins = useMemo(
    () => localizePlugins(plugins ? pluginsOfProject(plugins) : PLUGINS, language),
    [plugins, language],
  );
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
    // The static viewer shows the simulator, the schematic, the tables and the preferences only.
    if (STATIC_VIEWER) return bundled.filter((x) => STATIC_TABS.includes(x));
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
  // A Commenter cannot change the network but can comment: the badge and the Create tab say so.
  const commenter = !editable && project?.myRole === "commenter" && !project.viaPublic;
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
  // New comments and replies on all the person's projects, for the bell.
  const noticesApi = useMemo(
    () => (typeof api.commentNotices === "function" ? api.commentNotices() : null),
    [api],
  );
  const notices = useCommentNotices(noticesApi);
  const roadRuns = useMemo(
    () => (projectKey && typeof api.roadRuns === "function" ? api.roadRuns(projectKey) : null),
    [api, projectKey],
  );
  const results = useMemo(
    () => (projectKey && typeof api.results === "function" ? api.results(projectKey) : null),
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
  // Map data the tools read live, outside the project's imports (#140 step 5): said once, with a way to the
  // import in Map data; it shows again when more is read live after the planner hid it.
  const [liveData, setLiveData] = useState<LiveData>({ tiles: 0, heights: 0 });
  const [liveSeen, setLiveSeen] = useState<LiveData>({ tiles: 0, heights: 0 });
  useEffect(() => watchLiveData(setLiveData), []);
  useEffect(() => setLiveSeen({ tiles: 0, heights: 0 }), [projectId]);
  const liveNote =
    (liveData.tiles > liveSeen.tiles || liveData.heights > liveSeen.heights) &&
    (liveData.tiles > 0 || liveData.heights > 0);
  // A new session (Try again after a refused save loads it) sends what was refused once more.
  const firstApi = useRef(api);
  useEffect(() => {
    if (api !== firstApi.current && drawings.status === "failed") drawings.retry();
    firstApi.current = api;
    // Only a new API client (a new CSRF token) is a reason to try again.
  }, [api]);
  const streetLines = drawings.doc<StreetLinesDoc>("street-lines");
  const railway = drawings.doc<Network>("railway");
  // Cable car and ferry lines of the plugin tools, per tool: the drawing, the line the journey
  // planner rides and the shape the noise map needs.
  // Lines drawn with the tools of a plugin that is now off stay in the project but are not shown or counted
  // until the plugin is on again. A tool's further lines are kept under `<tool id>-2`, `<tool id>-3`…
  const pluginDoc = drawings.doc<PluginLinesDoc>("plugin-lines")?.tools ?? NO_PLUGIN_LINES;
  const toolOn = useMemo(() => {
    const on = PLUGIN_TOOLS.map((x) => x.id);
    return (key: string) => lineToolId(key, on) !== null;
  }, [PLUGIN_TOOLS]);
  const pluginSaved = useMemo(() => {
    const kept = Object.entries(pluginDoc).filter(([key]) => toolOn(key));
    return kept.length === Object.keys(pluginDoc).length ? pluginDoc : Object.fromEntries(kept);
  }, [pluginDoc, toolOn]);
  const pluginLines: Record<string, PluginLineInput | null> = Object.fromEntries(
    Object.entries(pluginSaved).map(([id, x]) => [id, x.line]),
  );
  const savePluginLine = (id: string, saved: SavedPluginLine) =>
    drawings.set("plugin-lines", {
      tools: { ...(drawings.doc<PluginLinesDoc>("plugin-lines")?.tools ?? {}), [id]: saved },
    } satisfies PluginLinesDoc);
  const deletePluginLine = (id: string) => {
    const tools = { ...(drawings.doc<PluginLinesDoc>("plugin-lines")?.tools ?? {}) };
    delete tools[id];
    drawings.set("plugin-lines", { tools } satisfies PluginLinesDoc);
  };
  // The line of each water route tool open in the editor (ferry: several lines per project), by tool id.
  const [pluginLinePick, setPluginLinePick] = useState<Record<string, string>>({});
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
  // Junction setups from the GIS tab: traffic lights given to or taken from junctions, for the road run.
  const junctionSetups = drawings.doc<JunctionSetup[]>("junction-setups") ?? NO_JUNCTIONS;
  const changeJunctions = (next: JunctionSetup[]) => drawings.set("junction-setups", next);
  // GIS tab regions: their values take priority in the benefit tables.
  const regions = drawings.doc<RegionsDoc>("regions")?.regions ?? NO_REGIONS;
  // Benefit tables settings: the project's formulas and its own boardings per station or stop.
  const benefitsDoc = drawings.doc<BenefitsDoc>("benefits");
  // Project preferences: assumption values the project changes, such as the delays in traffic.
  const preferences = drawings.doc<PreferencesDoc>("preferences");
  // Kept by value, so editing another value (a unit cost) does not re-run what reads them.
  const journeyJson = JSON.stringify(journeySettingsFrom(preferences?.values));
  const journeySettings = useMemo(
    () => JSON.parse(journeyJson) as ReturnType<typeof journeySettingsFrom>,
    [journeyJson],
  );
  // The street rules every street line follows (Project preferences).
  const streetRulesJson = JSON.stringify(streetRulesFrom(preferences));
  const streetRules = useMemo(
    () => JSON.parse(streetRulesJson) as ReturnType<typeof streetRulesFrom>,
    [streetRulesJson],
  );
  // Road depots shared by the street lines (depot tool).
  const depotsDoc = drawings.doc<DepotsDoc>("depots");
  // The names of the objects that can carry comments, for the bell's notices and the comments dialog.
  const commentLabels = useMemo(
    () =>
      new Map(
        commentableObjects(t, railway, streetLines, depotsDoc).map((o) => [objectKey(o.type, o.id), o.label]),
      ),
    [t, railway, streetLines, depotsDoc],
  );
  const noticeLabel = useCallback(
    (n: CommentNotice) =>
      n.projectId === projectId ? (commentLabels.get(objectKey(n.objectType, n.objectId)) ?? null) : null,
    [commentLabels, projectId],
  );
  // A chosen notice opens its object's comments, here or in its own project, and is then read.
  const openNotice = useCallback(
    (n: CommentNotice) => {
      if (n.projectId === projectId) setCommentsOf({ type: n.objectType, id: n.objectId });
      else {
        openCommentsLater(n.projectId, n.objectType, n.objectId);
        onOpenProject?.(n.projectId);
      }
    },
    [projectId, onOpenProject],
  );
  // While an object's comments are open, its new comments count as read.
  const { comments: noticeList, markRead } = notices;
  useEffect(() => {
    if (!commentsOf) return;
    const ids = noticeList
      .filter(
        (n) => n.projectId === projectId && n.objectType === commentsOf.type && n.objectId === commentsOf.id,
      )
      .map((n) => n.id);
    if (ids.length) markRead({ ids });
  }, [commentsOf, noticeList, markRead, projectId]);
  // The currency all money is shown in, and its exchange rate (Project preferences).
  const currencyState = useProjectCurrency(preferences, ECONOMY);
  // The country at the project's location, for the calendar's public holidays (Project preferences).
  const place = railway?.origin ?? streetLines?.lines[0]?.points[0]?.lonlat ?? null;
  // The project's country: the main one of its area, looked up once (#140 step 3); else at the drawing.
  const drawnCountry = usePlaceCountry(areaView?.countries?.main ? null : place);
  const placeCountry = areaView?.countries?.main?.iso2 ?? drawnCountry;
  // A new project keeps to the driving side of its country (Project preferences → Parameters), set once the
  // country is known and before any street line or street setup is drawn, so existing street work keeps its side.
  const sideToSet =
    editable &&
    drawings.loaded &&
    !streetLines?.lines.length &&
    !setups.length &&
    choiceValue(preferences, DRIVING_SIDE_PREF) === undefined
      ? countryDrivingSide(placeCountry)
      : null;
  useEffect(() => {
    if (sideToSet) drawings.set("preferences", withCountryDrivingSide(preferences, placeCountry)!);
  }, [sideToSet, projectId]);
  const currency = currencyState.currency;
  const delaysJson = JSON.stringify(delaysFrom(preferences));
  const delays = useMemo(() => JSON.parse(delaysJson) as DelayShares, [delaysJson]);
  const rulesJson = JSON.stringify(designValuesFrom(preferences));
  const designValues = useMemo(() => JSON.parse(rulesJson) as Record<string, number>, [rulesJson]);
  // The project's weekday service day (Calendar and years): the tools' peak windows, and the first and last
  // departure of lines without their own. Set before the tools render; back to the default when the project closes.
  const weekdayJson = JSON.stringify(serviceDayFor(calendarFrom(preferences), "weekday"));
  // The project's weekend names the Saturday and Sunday day types in every tool (Friday and Saturday in Syria).
  const weekendJson = JSON.stringify(weekendOf(calendarFrom(preferences)));
  const weekend = useMemo(() => JSON.parse(weekendJson) as ReturnType<typeof weekendOf>, [weekendJson]);
  useMemo(() => setProjectServiceDay(JSON.parse(weekdayJson) as ServiceDay), [weekdayJson]);
  useEffect(() => () => setProjectServiceDay(null), []);
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
  // The project layers kept shown on every map tab (Map layers → Always show), from the person's account.
  const pinContent = useMemo<ProjectContent>(
    () => ({
      railway,
      streetLines: savedStreet,
      pluginLines: pluginSaved,
      setups,
      junctions: junctionSetups,
      regions,
    }),
    [railway, savedStreet, pluginSaved, setups, junctionSetups, regions],
  );
  const pinKey = pinnedLayers.join();
  const pinned = useMemo(
    () => new Set<PinnedLayer>(pinKey ? (pinKey.split(",") as PinnedLayer[]) : []),
    [pinKey],
  );
  const pinAvailable = useMemo(() => pinnableLayers(pinContent), [pinContent]);
  const pinState = useMemo(
    () =>
      project && onPinnedLayers
        ? {
            available: pinAvailable,
            pinned,
            onChange: (next: ReadonlySet<PinnedLayer>) =>
              onPinnedLayers(PINNED_LAYERS.filter((x) => next.has(x))),
          }
        : null,
    [project, onPinnedLayers, pinAvailable, pinned],
  );
  // Street lines saved before lines had ids get one, so their comments stay with them, and before lines had
  // colours a colour of their own, so lines of one mode can be told apart (Owners and Editors save).
  useEffect(() => {
    if (!drawings.loaded || !editable || !streetLines?.lines.some((l) => !l.id || !l.color)) return;
    drawings.set("street-lines", {
      ...streetLines,
      lines: withLineColors(streetLines.lines.map((l) => (l.id ? l : { ...l, id: newLineId() }))),
    } satisfies StreetLinesDoc);
  }, [drawings.loaded, editable, streetLines]);
  // No line is open until one is picked, so its settings only show for it; a project without lines starts a new one.
  const editedStreet: number | null =
    streetIndex === null ? (savedStreet.length === 0 ? 0 : null) : Math.min(streetIndex, savedStreet.length);
  const switchStreet = (i: number | null) => {
    setStreetIndex(i);
    setStreetSwitch((n) => n + 1);
    setLine(null);
  };
  const saveStreet = (l: SavedStreetLine) => {
    if (editedStreet === null) return;
    const next = [...savedStreet];
    next[editedStreet] = { ...l, id: savedStreet[editedStreet]?.id ?? l.id ?? newLineId() };
    drawings.set("street-lines", { lines: next } satisfies StreetLinesDoc);
  };
  // The street line whose checks were last listed, so a check of it chosen in the bell opens that line again.
  const lastStreetLine = useRef<string | null>(null);
  if (editedStreet !== null && savedStreet[editedStreet]?.id)
    lastStreetLine.current = savedStreet[editedStreet]!.id!;
  /** Purpose: open the tool a check in the bell belongs to (Create tab), so the check can show its element. */
  const reopenCheck = (source: string) => {
    if (source === "project-area") return onTab("preferences");
    if (tab !== "create") onTab("create");
    if (source === "street") {
      const i = savedStreet.findIndex((l) => l.id === lastStreetLine.current);
      setBuild("street");
      if (i >= 0 && i !== editedStreet) switchStreet(i);
    } else if (source === "rail" || source === "depots" || PLUGIN_TOOLS.some((x) => x.id === source))
      setBuild(source);
  };
  const deleteStreet = (i: number) => {
    drawings.set("street-lines", { lines: savedStreet.filter((_, k) => k !== i) } satisfies StreetLinesDoc);
    switchStreet(null);
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
      setConvertError(engineErrorText(err));
    }
  };
  // Cmd+Z (Ctrl+Z) undoes the last change to a drawing; Cmd+Shift+Z or Ctrl+Y makes it again. In a text field
  // the field's own undo applies.
  const undoRef = useRef(drawings);
  undoRef.current = drawings;
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (!(ev.metaKey || ev.ctrlKey) || ev.altKey) return;
      const target = ev.target as HTMLElement | null;
      if (target && (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable))
        return;
      const key = ev.key.toLowerCase();
      const redo = (key === "z" && ev.shiftKey) || (key === "y" && !ev.shiftKey);
      if (key !== "z" && !redo) return;
      ev.preventDefault();
      if (redo) undoRef.current.redo();
      else undoRef.current.undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
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
            {editable && drawings.loaded && (
              <>
                <button
                  type="button"
                  className="icon-btn hidden sm:inline-flex"
                  aria-label={t("undo.undo")}
                  title={`${t("undo.undo")} (${MOD_KEY}Z)`}
                  disabled={!drawings.canUndo}
                  onClick={drawings.undo}
                >
                  <UndoIcon />
                </button>
                <button
                  type="button"
                  className="icon-btn hidden sm:inline-flex"
                  aria-label={t("undo.redo")}
                  title={`${t("undo.redo")} (${MOD_KEY}⇧Z)`}
                  disabled={!drawings.canRedo}
                  onClick={drawings.redo}
                >
                  <RedoIcon />
                </button>
              </>
            )}
            <ChecksMenu notices={notices} onOpenNotice={openNotice} objectLabel={noticeLabel} />
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
          <span className="tag bg-slate-100 text-slate-700">
            {commenter ? t("comments.canComment") : t("project.viewOnly")}
          </span>
        )}
        {project?.visibility === "public" && (
          <span className="tag bg-blue-50 text-blue-800" title={t("project.publicNote")}>
            {t("project.public")}
            <span className="sr-only"> · {t("project.publicNote")}</span>
          </span>
        )}
      </span>
      {project && editable && drawings.loaded && (
        <SaveStatus
          drawings={drawings}
          onRetry={() => {
            onRefreshSession?.();
            drawings.retry();
          }}
        />
      )}
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

  // The modes the project plans to use (Project preferences) decide which tools Create offers: no street mode
  // planned hides the street lines, no rail mode the railway; a tool with something drawn in it stays.
  const planned = project?.modes ?? NO_MODES;
  const showStreet = plansStreet(planned) || savedStreet.length > 0;
  const hasRail = Boolean(railway?.tracks.length || railway?.stations.length);
  const showRail = plansRail(planned) || hasRail;
  // Create: a new project starts with the chooser (never one with drawings, even when the address still says
  // it is new after a reload); an existing one with the tool last used, else the one that has something drawn.
  const remembered =
    build === "street" || build === "depots"
      ? showStreet
        ? build
        : null
      : build === "rail"
        ? showRail
          ? build
          : null
        : build;
  const drawn = savedStreet.length > 0 || hasRail;
  const chosen: Build | null =
    remembered ??
    (fresh && !drawn
      ? null
      : hasRail && savedStreet.length === 0
        ? "rail"
        : showStreet
          ? "street"
          : showRail
            ? "rail"
            : null);
  const chosenPlugin = PLUGIN_TOOLS.find((x) => x.id === chosen) ?? null;
  // Line tools (ferry, cable car) have a line list: the keys of the tool's lines, and the one open
  // (the first by default, or a new one not saved yet).
  const lineTool = chosenPlugin && chosenPlugin.kit !== "service-zone" ? chosenPlugin : null;
  const toolKeys = lineTool ? toolLineKeys(pluginSaved, lineTool.id) : [];
  const picked = lineTool ? pluginLinePick[lineTool.id] : undefined;
  const lineKey = lineTool
    ? picked && (toolKeys.includes(picked) || !(picked in pluginSaved))
      ? picked
      : (toolKeys[0] ?? lineTool.id)
    : null;
  const lineList = (tool: PluginTool, key: string): KitLineList => ({
    lineId: key,
    lines: [
      ...toolKeys.map((k) => ({
        id: k,
        name: (pluginSaved[k]?.doc as { name?: string } | undefined)?.name || k,
      })),
      ...(toolKeys.includes(key) ? [] : [{ id: key, name: t("ferry.lineN", { n: toolKeys.length + 1 }) }]),
    ],
    onPickLine: (k) => setPluginLinePick((p) => ({ ...p, [tool.id]: k })),
    onNewLine: () => setPluginLinePick((p) => ({ ...p, [tool.id]: newToolLineKey(pluginSaved, tool.id) })),
    onDeleteLine: toolKeys.includes(key)
      ? () => {
          deletePluginLine(key);
          setPluginLinePick((p) => ({ ...p, [tool.id]: "" }));
        }
      : undefined,
    otherStops: toolKeys
      .filter((k) => k !== key)
      .flatMap((k) => {
        const d = pluginSaved[k]?.doc as
          { piers?: Pier[]; stations?: { name: string; lonlat: LonLat }[] } | undefined;
        return [...(d?.piers ?? []), ...(d?.stations ?? [])];
      }),
  });
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
  // On-demand zones of a plugin that is now off are left out of the journey planner too.
  const demandZoneList = Object.entries(demandZones)
    .filter(([id]) => toolOn(id))
    .map(([, z]) => z)
    .filter((z): z is DemandZone => z !== null);

  const body = (
    <div className="flex h-full flex-col overflow-clip">
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
      {liveNote && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 border-b border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-950"
        >
          <p className="min-w-48 flex-1">
            {t("data.liveNotice", { tiles: liveData.tiles, heights: liveData.heights })}
          </p>
          {tab !== "gis" && (
            <button type="button" className="btn min-h-10" onClick={() => onTab("gis")}>
              {t("data.extendImport")}
            </button>
          )}
          <button type="button" className="btn btn-ghost min-h-10" onClick={() => setLiveSeen(liveData)}>
            {t("data.hideLive")}
          </button>
        </div>
      )}
      <main className="relative flex min-h-0 flex-1 flex-col overflow-clip md:flex-row">
        <div className={`relative min-h-0 min-w-0 flex-1 ${onMap ? "" : "hidden"}`}>
          <PinnedLayersContext.Provider value={pinState}>
            <MapView onReady={setMap} />
          </PinnedLayersContext.Provider>
          {project && drawings.loaded && pinned.size > 0 && (
            <PinnedLayers map={map} pinned={pinned} content={pinContent} />
          )}
          {/* The drawn network (track, stations, platforms, street lines and stops, depots) stays in view on
              every map tab: faded under the tool in use on Create, and as the backdrop on GIS and Simulator. */}
          {project && drawings.loaded && (tab === "create" || tab === "gis" || tab === "simulator") && (
            <OtherModesLayer
              map={map}
              active={
                tab === "create" && editable && !(chosen === "street" && editedStreet === null)
                  ? (lineKey ?? chosen)
                  : null
              }
              railway={railway}
              streetLines={savedStreet}
              depots={depotsDoc?.depots ?? NO_DEPOTS}
              pluginLines={pluginSaved}
            />
          )}
          {/* The streets lane by lane, with the GIS tab's setups, faded under the tools from zoom 16. */}
          {project && drawings.loaded && tab === "create" && (
            <Suspense fallback={null}>
              <LanesBackdrop map={map} setups={setups} trafficSide={streetRules.traffic_side} />
            </Suspense>
          )}
          {project &&
            drawings.loaded &&
            tab === "create" &&
            editable &&
            chosen === "street" &&
            editedStreet === null && (
              <StreetLinePicker
                map={map}
                panel={panel}
                lines={savedStreet}
                onPick={switchStreet}
                onNew={() => switchStreet(savedStreet.length)}
              />
            )}
          {project &&
            drawings.loaded &&
            tab === "create" &&
            editable &&
            chosen === "street" &&
            editedStreet !== null && (
              <Suspense fallback={null}>
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
                  defaultColor={
                    withLineColors(savedStreet)[editedStreet]?.color ??
                    nextLineColor(savedStreet.map((l) => l.color))
                  }
                  otherLines={otherStreet}
                  onPickLine={(id) => {
                    const i = savedStreet.findIndex((l) => l.id === id);
                    if (i >= 0) switchStreet(i);
                  }}
                  lineList={
                    <LineList
                      names={savedStreet.map((l) => l.name)}
                      ids={savedStreet.map((l) => l.id)}
                      current={editedStreet}
                      onSelect={switchStreet}
                      onNew={() => switchStreet(savedStreet.length)}
                      onDelete={deleteStreet}
                      onClose={savedStreet.length > 0 ? () => switchStreet(null) : undefined}
                    />
                  }
                  railTopology={railTopology}
                  projectRules={streetRules}
                  depots={depotsDoc?.depots ?? NO_DEPOTS}
                  onOpenDepots={() => setBuild("depots")}
                />
              </Suspense>
            )}
          {project && drawings.loaded && tab === "create" && editable && chosen === "depots" && (
            // Depots are a street-route tool: the street palette stays on the map with Bus depot pressed, and
            // any other tool goes back to the street lines.
            <ToolPalette
              tool="depot"
              onTool={(x) => {
                if (x !== "depot") setBuild("street");
              }}
            />
          )}
          {project && drawings.loaded && tab === "create" && editable && chosen === "depots" && (
            <Suspense fallback={null}>
              <DepotEditor
                key={`${projectId}-${drawings.generation("depots")}`}
                map={map}
                panel={panel}
                doc={depotsDoc ?? null}
                onDoc={(d) => drawings.set("depots", d)}
                lines={savedStreet}
                prefs={preferences?.values}
              />
            </Suspense>
          )}
          {project && drawings.loaded && tab === "create" && editable && chosen === "rail" && (
            <Suspense fallback={null}>
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
            </Suspense>
          )}
          {project &&
            drawings.loaded &&
            tab === "create" &&
            editable &&
            chosenPlugin?.kit === "straight-spans" && (
              <Suspense fallback={null}>
                <SpanLineEditor
                  key={`${projectId}-${lineKey}-${drawings.generation("plugin-lines")}`}
                  map={map}
                  panel={panel}
                  tool={chosenPlugin}
                  storageKey={`mobsimlab:${lineKey}:${projectId}`}
                  initial={
                    (pluginSaved[lineKey!]?.doc as Partial<SpanDoc> | undefined) ??
                    (lineKey !== chosenPlugin.id
                      ? { name: t("ferry.lineN", { n: toolKeys.length + 1 }) }
                      : undefined)
                  }
                  onSave={(x) => savePluginLine(lineKey!, x)}
                  preferences={preferences?.values}
                  {...lineList(chosenPlugin, lineKey!)}
                />
              </Suspense>
            )}
          {project && tab === "create" && editable && chosenPlugin?.kit === "service-zone" && (
            <Suspense fallback={null}>
              <ZoneEditor
                key={`${projectId}-${chosenPlugin.id}`}
                map={map}
                panel={panel}
                tool={chosenPlugin}
                storageKey={`mobsimlab:${chosenPlugin.id}:${projectId}`}
                onZoneChange={(z) => setDemandZones((p) => ({ ...p, [chosenPlugin.id]: z }))}
                preferences={preferences?.values}
              />
            </Suspense>
          )}
          {project &&
            drawings.loaded &&
            tab === "create" &&
            editable &&
            chosenPlugin?.kit === "water-route" && (
              <Suspense fallback={null}>
                <WaterRouteEditor
                  key={`${projectId}-${lineKey}-${drawings.generation("plugin-lines")}`}
                  map={map}
                  panel={panel}
                  tool={chosenPlugin}
                  storageKey={`mobsimlab:${lineKey}:${projectId}`}
                  initial={
                    (pluginSaved[lineKey!]?.doc as Partial<WaterDoc> | undefined) ??
                    (lineKey !== chosenPlugin.id
                      ? { name: t("ferry.lineN", { n: toolKeys.length + 1 }) }
                      : undefined)
                  }
                  onSave={(x) => savePluginLine(lineKey!, x)}
                  preferences={preferences?.values}
                  {...lineList(chosenPlugin, lineKey!)}
                />
              </Suspense>
            )}
          {project && drawings.loaded && tab === "gis" && gis === "regions" && (
            <Suspense fallback={null}>
              <RegionEditor
                map={map}
                panel={panel}
                regions={regions}
                onChange={(next) => drawings.set("regions", { regions: next } satisfies RegionsDoc)}
                editable={editable}
                currency={currency?.code ?? costInfo?.currency ?? null}
                area={editable && typeof api.area === "function" ? api.area(projectId) : null}
              />
            </Suspense>
          )}
          {project && tab === "gis" && gis === "data" && (
            <MapDataPanel
              key={projectId}
              api={geodata}
              panel={panel}
              onOsmImport={(id) => setDataProject(projectId, id)}
            />
          )}
          {project && drawings.loaded && tab === "gis" && gis === "zones" && (
            <Suspense fallback={null}>
              <DemandZoneEditor
                map={map}
                panel={panel}
                timetable={networkTimetable}
                preferences={preferences}
                doc={drawings.doc<DemandDoc>("demand")}
                onDoc={editable ? (d) => drawings.set("demand", d) : undefined}
              />
            </Suspense>
          )}
          {project && tab === "gis" && gis === "population" && (
            <Suspense fallback={null}>
              <PopulationPanel
                map={map}
                panel={panel}
                api={population}
                editable={editable}
                onPrimaryChange={() => setPopulationVersion((n) => n + 1)}
              />
            </Suspense>
          )}
          {project && drawings.loaded && tab === "gis" && gis === "streets" && (
            <Suspense fallback={null}>
              <StreetSetupEditor
                map={map}
                panel={panel}
                setups={setups}
                onChange={changeSetups}
                junctions={junctionSetups}
                onJunctionsChange={changeJunctions}
                editable={editable}
                delays={delays}
                trafficSide={streetRules.traffic_side}
                streetLines={savedStreet}
              />
            </Suspense>
          )}
          {project && drawings.loaded && pluginTab?.view === "cargo-bike" && (
            <Suspense fallback={null}>
              <CargoBikeTab
                key={`${projectId}-${drawings.generation("cargo-bike")}`}
                map={map}
                panel={panel}
                doc={drawings.doc<CargoBikeDoc>("cargo-bike")}
                onDoc={editable ? (d) => drawings.set("cargo-bike", d) : undefined}
                setups={setups}
                currency={currency}
              />
            </Suspense>
          )}
          {project && tab === "simulator" && sim === "journey" && (
            <Suspense fallback={null}>
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
                  const timetable = await projectFeed({
                    railway,
                    streetLines: savedStreet,
                    pluginLines: pluginLineList,
                    cal,
                    options: publishOptionsFrom(preferences?.values),
                    values: preferences?.values ?? null,
                  });
                  return {
                    timetable,
                    holidays: feedHolidays(cal, today, new Date(today.getTime() + 365 * 86_400_000)),
                    weekend: weekendOf(cal),
                  };
                }}
                {...(editable ? { onEditGtfsRoute: (f: string, r: string) => void editGtfsRoute(f, r) } : {})}
              />
            </Suspense>
          )}
          {convertError && tab === "simulator" && (
            <p
              role="alert"
              className="absolute top-2 left-1/2 z-30 -translate-x-1/2 rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-sm text-red-900"
            >
              {convertError}
            </p>
          )}
        </div>

        {!onMap && project && tab === "preferences" && (
          <div className="min-h-0 flex-1">
            <LoadingScreen>
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
                mapExports={
                  drawings.loaded ? (
                    <MapExports
                      railway={railway}
                      streetLines={streetLines}
                      pluginLines={pluginLineList}
                      prefs={preferences?.values}
                      doc={drawings.doc<SchematicDoc>("schematic")}
                      projectName={project.name}
                    />
                  ) : null
                }
              />
            </LoadingScreen>
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
              <LoadingScreen>
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
              </LoadingScreen>
            ) : (
              <p role="status" className="mt-6 text-center text-slate-500">
                {t("common.loading")}
              </p>
            )}
          </div>
        )}
        {!onMap && tab === "tables" && (
          <div ref={tablesScroll} className="min-h-0 flex-1 overflow-y-auto bg-slate-50">
            <section aria-label={t("tables.title")} className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-10">
              <p className="text-slate-600">{t("tables.intro")}</p>
              {project && drawings.loaded ? (
                <div className="mt-6 md:flex md:items-start md:gap-8">
                  {/* One group of tables at a time, chosen here: a list beside them on wide screens, a row on top on
                      narrow ones. Every group stays mounted (only hidden), because the appraisal reads the costs,
                      benefits and fares the other groups work out. */}
                  <TablesNav
                    t={t}
                    view={tablesView}
                    parts={tablesParts}
                    onGroup={(g) => {
                      setTablesView(g);
                      tablesScroll.current?.scrollTo?.({ top: 0 });
                    }}
                    onPart={(g, part) => {
                      setTablesView(g);
                      setTablesParts((p) => ({ ...p, [g]: part }));
                      tablesScroll.current?.scrollTo?.({ top: 0 });
                    }}
                  />
                  <TablesSection.Provider value={shownPart(tablesView, tablesParts)}>
                    <div className="min-w-0 flex-1">
                      {/* Every group reads the street lines' saved routes: a route with parts not found is named
                          above them all. */}
                      <UnroutedNotice streetLines={streetLines} />
                      <div
                        id="tables-network"
                        role="region"
                        aria-labelledby="tables-tab-network"
                        hidden={tablesView !== "network"}
                      >
                        <LoadingScreen>
                          <NetworkTables
                            railway={railway}
                            streetLines={streetLines}
                            pluginLines={pluginSaved}
                            preferences={preferences}
                            onPreferences={editable ? (d) => drawings.set("preferences", d) : undefined}
                            riders={riders}
                            onEnergy={setEnergyEst}
                          />
                        </LoadingScreen>
                      </div>
                      <div
                        id="tables-timetables"
                        role="region"
                        aria-labelledby="tables-tab-timetables"
                        hidden={tablesView !== "timetables"}
                      >
                        <LoadingScreen>
                          <TimetableTables
                            projectName={project.name}
                            railway={railway}
                            streetLines={streetLines}
                            pluginLines={pluginSaved}
                            preferences={preferences}
                            onPreferences={editable ? (d) => drawings.set("preferences", d) : undefined}
                          />
                        </LoadingScreen>
                      </div>
                      <div
                        id="tables-costs"
                        role="region"
                        aria-labelledby="tables-tab-costs"
                        hidden={tablesView !== "costs"}
                      >
                        <LoadingScreen>
                          <CostTables
                            railway={railway}
                            streetLines={streetLines}
                            pluginLines={pluginSaved}
                            preferences={preferences}
                            onPreferences={editable ? (d) => drawings.set("preferences", d) : undefined}
                            costs={drawings.doc<CostsDoc>("costs")}
                            onCosts={editable ? (d) => drawings.set("costs", d) : undefined}
                            currency={currency}
                            onEstimate={onCostEstimate}
                            results={results}
                            canSave={editable}
                          />
                        </LoadingScreen>
                      </div>
                      <div
                        id="tables-benefits"
                        role="region"
                        aria-labelledby="tables-tab-benefits"
                        hidden={tablesView !== "benefits"}
                      >
                        <LoadingScreen>
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
                            results={results}
                            canSave={editable}
                          />
                        </LoadingScreen>
                      </div>
                      <div
                        id="tables-demand"
                        role="region"
                        aria-labelledby="tables-tab-demand"
                        hidden={tablesView !== "demand"}
                      >
                        <LoadingScreen>
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
                        </LoadingScreen>
                        <TablePart id="demand.results">
                          <PluginCalculations
                            data={{ timetable: networkTimetable, streetLines: streetLines?.lines ?? [] }}
                          />
                        </TablePart>
                      </div>
                      <div
                        id="tables-fares"
                        role="region"
                        aria-labelledby="tables-tab-fares"
                        hidden={tablesView !== "fares"}
                      >
                        <LoadingScreen>
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
                            onInput={setFareInput}
                          />
                        </LoadingScreen>
                      </div>
                      <div
                        id="tables-appraisal"
                        role="region"
                        aria-labelledby="tables-tab-appraisal"
                        hidden={tablesView !== "appraisal"}
                      >
                        <LoadingScreen>
                          <AppraisalSection
                            costs={appraisalCosts}
                            benefits={benefitEst}
                            fares={fareInput}
                            demand={usedRidership}
                            preferences={preferences}
                            onPreferences={editable ? (d) => drawings.set("preferences", d) : undefined}
                            doc={drawings.doc<AppraisalDoc>("appraisal")}
                            onDoc={editable ? (d) => drawings.set("appraisal", d) : undefined}
                          />
                        </LoadingScreen>
                      </div>
                      <div
                        id="tables-scenarios"
                        role="region"
                        aria-labelledby="tables-tab-scenarios"
                        hidden={tablesView !== "scenarios"}
                      >
                        <LoadingScreen>
                          <Scenarios
                            railway={railway}
                            streetLines={streetLines}
                            preferences={preferences}
                            doc={drawings.doc<ScenariosDoc>("scenarios")}
                            currency={currency}
                            onChange={editable ? (d) => drawings.set("scenarios", d) : undefined}
                            results={results}
                            canSave={editable}
                          />
                        </LoadingScreen>
                      </div>
                    </div>
                  </TablesSection.Provider>
                </div>
              ) : (
                <p role="status" className="mt-6 text-slate-500">
                  {t("common.loading")}
                </p>
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
              <div className="shrink-0 overflow-x-auto overscroll-x-contain px-4 pt-3 pb-2 md:px-5 md:pt-5">
                <div className="seg w-max min-w-full" role="tablist" aria-label={tabLabel("simulator")}>
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
              <div className="shrink-0 overflow-x-auto overscroll-x-contain px-4 pt-3 pb-2 md:px-5 md:pt-5">
                <div className="seg w-max min-w-full" role="tablist" aria-label={tabLabel("gis")}>
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
                  <button
                    type="button"
                    role="tab"
                    aria-selected={gis === "data"}
                    onClick={() => setGis("data")}
                  >
                    {t("gis.dataView")}
                  </button>
                </div>
              </div>
            )}
            {tab === "create" && editable && (
              <div className="shrink-0 overflow-x-auto overscroll-x-contain px-4 pt-3 pb-2 md:px-5 md:pt-5">
                <div className="seg w-max min-w-full" role="tablist" aria-label={tabLabel("create")}>
                  {showStreet && (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={chosen === "street" || chosen === "depots"}
                      onClick={() => setBuild("street")}
                    >
                      {t("create.street")}
                    </button>
                  )}
                  {showRail && (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={chosen === "rail"}
                      onClick={() => setBuild("rail")}
                    >
                      {t("create.rail")}
                    </button>
                  )}
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
            {/* Scrolls on its own, both ways for text wider than the panel, and never scrolls the page or the map. */}
            <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
              {tab === "simulator" && sim === "test" && (
                <LoadingScreen>
                  <CapacityRun
                    map={map}
                    demandRidership={usedRidership}
                    runs={runs}
                    results={results}
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
                </LoadingScreen>
              )}
              {tab === "simulator" && sim === "road" && (
                <LoadingScreen>
                  <RoadSimulation
                    api={roadRuns}
                    canRun={editable}
                    map={map}
                    streetLines={streetLines?.lines}
                    depots={depotsDoc?.depots}
                    setups={setups}
                    junctions={junctionSetups}
                    prefs={preferences?.values}
                    visuals={preferences?.visuals}
                  />
                </LoadingScreen>
              )}
              {tab === "simulator" && sim === "calendar" && (
                <LoadingScreen>
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
                </LoadingScreen>
              )}
              {tab === "create" && !editable && (
                <div className="px-4 py-5 md:px-5">
                  <h2 className="text-lg font-semibold">
                    {commenter ? t("comments.canComment") : t("create.readOnlyTitle")}
                  </h2>
                  <p className="mt-1 text-slate-600">
                    {commenter ? t("comments.canCommentNote") : t("create.readOnly")}
                  </p>
                  {drawings.loaded && (
                    <div className="mt-5 border-t border-slate-200 pt-5">
                      <CommentsPanel objects={commentableObjects(t, railway, streetLines, depotsDoc)} />
                    </div>
                  )}
                </div>
              )}
              {tab === "create" && editable && chosen === null && (
                <div className="flex flex-col gap-3 px-4 py-5 md:px-5">
                  <p className="text-slate-600">{t("create.chooseFirst")}</p>
                  {project && !project.areaName && (
                    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
                      <p className="min-w-48 flex-1 text-xs text-slate-700">{t("create.noArea")}</p>
                      <button type="button" className="btn min-h-10" onClick={() => onTab("gis")}>
                        {t("create.setArea")}
                      </button>
                    </div>
                  )}
                </div>
              )}
              {/* The street line tool, railway editor, journey planner and street setup render their panels here. */}
              <div key={`${tab}-${sim}-${chosen}-${gis}`} ref={setPanel} />
              {/* Walk to a stop is a demand analysis: it shows under Demand zones only. */}
              {tab === "gis" && gis === "zones" && project && drawings.loaded && (
                <div className="border-t border-slate-200 px-4 py-5 md:px-5">
                  {/* Folded away until asked for, so the zones' own settings come first. */}
                  <button
                    type="button"
                    aria-expanded={walkOpen}
                    className="flex w-full items-center justify-between gap-2 text-start text-xs font-semibold tracking-wider text-slate-500 uppercase"
                    onClick={() => setWalkOpen((o) => !o)}
                  >
                    {t("walk.title")}
                    <span aria-hidden="true">{walkOpen ? "▾" : "▸"}</span>
                  </button>
                </div>
              )}
              {tab === "gis" && gis === "zones" && project && drawings.loaded && walkOpen && (
                <div className="px-4 pb-5 md:px-5">
                  <LoadingScreen>
                    <WalkAnalysis
                      map={map}
                      fetchPeople={fetchPeople}
                      streetLines={streetLines}
                      railway={railway}
                      preferences={preferences?.values}
                      junctions={junctionSetups}
                      results={results}
                      canSave={editable}
                    />
                  </LoadingScreen>
                </div>
              )}
              {/* The noise map is map data: it shows under Map data only. */}
              {tab === "gis" && gis === "data" && project && drawings.loaded && noiseCalculationIn("gis") && (
                <div className="border-t border-slate-200 px-4 py-5 md:px-5">
                  <LoadingScreen>
                    <NoiseMap
                      map={map}
                      fetchPeople={fetchPeople}
                      streetLines={streetLines}
                      railway={railway}
                      pluginLines={pluginSaved}
                      preferences={preferences?.values}
                      scenarios={drawings.doc<ScenariosDoc>("scenarios")}
                      roadRuns={roadRuns}
                      results={results}
                      canSave={editable}
                    />
                  </LoadingScreen>
                </div>
              )}
            </div>
          </aside>
        )}
      </main>
      <JobsBar />
      {bottomTabs}
      {touring && <Tour steps={PROJECT_TOUR} onTab={onTab} onClose={() => setTouring(false)} />}
      {commentsOf && project && (
        <Dialog
          title={
            commentLabels.get(objectKey(commentsOf.type, commentsOf.id)) ?? t(COMMENT_KIND[commentsOf.type])
          }
          subtitle={`${t(COMMENT_KIND[commentsOf.type])} · ${t("comments.title")}`}
          onClose={() => setCommentsOf(null)}
        >
          <ObjectComments type={commentsOf.type} id={commentsOf.id} />
        </Dialog>
      )}
    </div>
  );
  // The catalogue vehicles the project does not use (Project preferences → Vehicles), and the modes it plans to
  // use, reach the line tools.
  return (
    <PlannedModesProvider value={planned}>
      <WeekendContext.Provider value={weekend}>
        <VehiclesOffContext.Provider value={vehiclesOff}>
          <CommentsProvider
            api={commentsApi}
            canComment={project ? can.comment(project) : false}
            isOwner={project ? can.manage(project) : false}
            userId={userId}
          >
            <ChecksProvider key={projectId} onReopen={editable ? reopenCheck : undefined}>
              <JobsProvider key={projectId}>
                {body}
                {project && !STATIC_VIEWER && <ImportsWatcher api={geodata} />}
                {areaView && (
                  <AreaChecks
                    polygons={areaView.polygons}
                    docs={{
                      streetLines,
                      railway,
                      depots: depotsDoc,
                      cargoBike: drawings.doc<CargoBikeDoc>("cargo-bike"),
                      pluginLines: drawings.doc<PluginLinesDoc>("plugin-lines"),
                    }}
                  />
                )}
              </JobsProvider>
            </ChecksProvider>
          </CommentsProvider>
        </VehiclesOffContext.Provider>
      </WeekendContext.Provider>
    </PlannedModesProvider>
  );
}

/** Purpose: how the project's drawings stand against the server, beside the project name. */
function SaveStatus({ drawings, onRetry }: { drawings: Drawings; onRetry: () => void }) {
  const { t } = useI18n();
  const s = drawings.status;
  // Changes kept on this device came back on opening: say so for a while.
  const [restoredNote, setRestoredNote] = useState(false);
  useEffect(() => {
    if (!drawings.restored) return;
    setRestoredNote(true);
    const timer = setTimeout(() => setRestoredNote(false), 10_000);
    return () => clearTimeout(timer);
  }, [drawings.restored]);
  if (s === "conflict") return null;
  // A refused save never reads as saved: it says so, with a way to try again.
  if (s === "failed")
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-red-700">
        <span
          role="status"
          className="max-w-56 truncate"
          title={t("save.failed", { error: drawings.error ?? "" })}
        >
          {t("save.failed", { error: drawings.error ?? "" })}
        </span>
        <button type="button" className="btn min-h-8 shrink-0 px-2 text-xs" onClick={onRetry}>
          {t("save.retry")}
        </button>
      </span>
    );
  const text =
    restoredNote && (s === "saved" || s === "saving")
      ? t("save.restored")
      : s === "saved"
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
      className={`hidden max-w-56 truncate text-xs sm:inline ${s === "offline" ? "text-red-700" : "text-slate-500"}`}
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
