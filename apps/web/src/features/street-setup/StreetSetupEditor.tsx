import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MessageKey } from "../../i18n/en";
import { type Translate, type TranslatePlural, tNow, useI18n } from "../../i18n/i18n";
import { fetchStreetTile, loadStreetInfos } from "../street-lines/engine";
import { MIN_LOAD_ZOOM, tilesFor } from "../street-lines/tiles";
import type { TileFetcher } from "../street-lines/types";
import { DEFAULT_SERVICE_DAY, projectServiceDay } from "../journey-planner/network";
import { CrossSection } from "./CrossSection";
import { SectionEditor } from "./SectionEditor";
import { sectionsFromInfo, sectionsFromLanes } from "./sections";
import {
  LANE_MIN_ZOOM,
  type LaneEngine,
  type LaneEngineLoader,
  type LaneGeometry,
  type LaneKind,
  type LaneProfile,
  loadLaneEngine,
  type TrafficSide,
} from "./lanes";
import {
  drawJunctions,
  drawLanes,
  drawStreets,
  ensureLayers,
  JUNCTION_LAYER,
  junctionKey,
  LANE_COLOR,
  HIT_LAYER,
  PRIORITY_COLOR,
  removeLayers,
  selectJunction,
  selectStreet,
  SIGNAL_JUNCTION_COLOR,
} from "./mapLayers";
import type { DelayShares } from "../street-lines/types";
import {
  CLASS_LABEL,
  DEFAULT_DELAYS,
  effective,
  junctionSetupOf,
  MAX_PEAK_CARS,
  osmTrafficLanes,
  parsePeakCars,
  peakCarsDefault,
  setJunction,
  upsert,
  type Verdict,
  verdicts,
} from "./model";
import type { JunctionSetup, StreetInfo, StreetInfoLoader, StreetSetup } from "./types";
import type { LonLat } from "../street-lines/types";
import { engineErrorText } from "../../i18n/engine";

interface Props {
  /** The map; `null` until it has loaded. */
  map: MapLibreMap | null;
  /** Where the side panel renders; inline when `null`. */
  panel?: HTMLElement | null;
  /** The project's street setups. */
  setups: readonly StreetSetup[];
  /** Told about every change. */
  onChange: (setups: StreetSetup[]) => void;
  /** The project's junction setups: traffic lights given to or taken from junctions. */
  junctions?: readonly JunctionSetup[];
  /** Told about every change of the junction setups. */
  onJunctionsChange?: (junctions: JunctionSetup[]) => void;
  /** Whether the planner may change setups (view-only projects only look). */
  editable?: boolean;
  /** The project's delays in traffic (Project preferences), for the reliability texts. */
  delays?: DelayShares;
  /** Street tile loader (OSM XML); tests inject a fake. */
  fetchTile?: TileFetcher;
  /** Street parser loader; tests inject a fake. */
  loadInfos?: StreetInfoLoader;
  /** Lane engine loader (osm2streets, ADR-0047); tests inject a fake. */
  loadLanes?: LaneEngineLoader;
  /** The side traffic drives on (Project preferences, `street.driving_side`), for the lanes. */
  trafficSide?: TrafficSide;
}

const NO_JUNCTIONS: readonly JunctionSetup[] = [];

/** A junction tapped on the map (from the lane shapes): its OSM nodes and ways, and OSM's lights. */
interface PickedJunction {
  key: string;
  nodes: number[];
  ways: number[];
  /** Whether OSM maps traffic lights here. */
  osmSignals: boolean;
  lonlat: LonLat;
}

/** Purpose: the middle of a junction shape (the mean of its ring's points). */
function middle(ring: readonly number[]): LonLat {
  let x = 0;
  let y = 0;
  const n = Math.max(1, Math.floor(ring.length / 2));
  for (let i = 0; i + 1 < ring.length; i += 2) {
    x += ring[i]!;
    y += ring[i + 1]!;
  }
  return [x / n, y / n];
}

/** Clears every lane setting: the street keeps OSM's lanes (traffic peaks stay). */
const OSM_LANES: Partial<StreetSetup> = {
  sections: null,
  oneway: null,
  traffic_lanes: null,
  bus_lane: null,
  bike_lane: null,
  separated: null,
  tram: null,
};

const WHO: Record<Verdict["who"], MessageKey> = {
  Cars: "setup.who.cars",
  Buses: "setup.who.buses",
  Trams: "setup.who.trams",
  Cyclists: "setup.who.cyclists",
};

const LEVEL_STYLE: Record<Verdict["level"], { mark: string; cls: string }> = {
  ok: { mark: "✓", cls: "bg-emerald-100 text-emerald-800" },
  info: { mark: "i", cls: "bg-blue-100 text-blue-800" },
  warning: { mark: "!", cls: "bg-amber-100 text-amber-900" },
};

/**
 * Purpose: the street setup tool in the GIS tab. Streets on screen load from OpenStreetMap and are drawn
 * by transit priority; tapping one opens its setup: general traffic lanes, bus lane, bike lane, separation
 * from the traffic, and how a tram shares it. The setup overrides OSM for bus running times and the
 * reliability and safety checks of the street line tool and the railway editor.
 * From zoom 16 the streets are drawn lane by lane, with their junctions (ADR-0047).
 * Side effects: adds layers and a tap handler to the map while mounted; fetches street tiles; runs the
 * lane engine in a Web Worker.
 */
export function StreetSetupEditor({
  map,
  panel = null,
  setups,
  onChange,
  junctions = NO_JUNCTIONS,
  onJunctionsChange,
  editable = true,
  delays = DEFAULT_DELAYS,
  fetchTile = fetchStreetTile,
  loadInfos = loadStreetInfos,
  loadLanes = loadLaneEngine,
  trafficSide = "right",
}: Props) {
  const [parse, setParse] = useState<((xml: string) => StreetInfo[]) | null>(null);
  const [infos, setInfos] = useState<Map<number, StreetInfo>>(new Map());
  const [selected, setSelected] = useState<number | null>(null);
  const [junction, pickJunction] = useState<PickedJunction | null>(null);
  const { t, tn } = useI18n();
  const [note, setNote] = useState<string | null>(() => tNow("street.loading"));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadInfos()
      .then((p) => alive && setParse(() => p))
      .catch((err) => setError(tNow("setup.engineFailed", { error: engineErrorText(err) })));
    return () => {
      alive = false;
    };
  }, [loadInfos]);

  // The lane engine. Tiles that arrive before it has started are handed over when it does.
  const xmls = useRef(new Map<string, string>());
  const laneRef = useRef<LaneEngine | null>(null);
  const [lanes, setLanes] = useState<LaneEngine | null>(null);
  const [tileCount, setTileCount] = useState(0);
  const [laneError, setLaneError] = useState<string | null>(null);
  // The shapes drawn last and the setups they were built with: the cross-section uses their lanes.
  const [drawn, setDrawn] = useState<{ g: LaneGeometry | null; setups: readonly StreetSetup[] } | null>(null);
  useEffect(() => {
    let alive = true;
    let engine: LaneEngine | null = null;
    loadLanes()
      .then((e) => {
        if (!alive) return e?.dispose();
        if (!e) return;
        engine = e;
        for (const [k, xml] of xmls.current) e.addTile(k, xml);
        laneRef.current = e;
        setLanes(e);
      })
      .catch((err) => alive && setLaneError(tNow("setup.lanesFailed", { error: engineErrorText(err) })));
    return () => {
      alive = false;
      laneRef.current = null;
      engine?.dispose();
    };
  }, [loadLanes]);

  // Streets on screen, loaded tile by tile when the map stops moving (the street line tool's tiles).
  const tiles = useRef(new Set<string>());
  useEffect(() => {
    if (!map || !parse) return;
    let busy = false;
    let again = false;
    let stopped = false;
    const load = async () => {
      if (stopped) return;
      if (busy) {
        again = true;
        return;
      }
      if (map.getZoom() < MIN_LOAD_ZOOM) {
        setNote(tNow("setup.zoomIn", { zoom: MIN_LOAD_ZOOM }));
        return;
      }
      const b = map.getBounds();
      const want = tilesFor([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
        .map(([x, y]) => `${x}/${y}`)
        .filter((k) => !tiles.current.has(k));
      if (!want.length) {
        setNote(null);
        return;
      }
      busy = true;
      want.forEach((k) => tiles.current.add(k));
      setNote(tNow("street.loading"));
      const got = await Promise.allSettled(
        want.map((k) => {
          const [x, y] = k.split("/").map(Number);
          return fetchTile(x!, y!);
        }),
      );
      busy = false;
      if (stopped) return;
      const found: StreetInfo[] = [];
      let reason: string | null = null;
      got.forEach((r, i) => {
        try {
          if (r.status === "rejected") throw r.reason;
          found.push(...parse(r.value));
          xmls.current.set(want[i]!, r.value);
          laneRef.current?.addTile(want[i]!, r.value);
        } catch (err) {
          tiles.current.delete(want[i]!);
          reason ??= err instanceof Error ? err.message : tNow("setup.someFailed");
        }
      });
      setTileCount(xmls.current.size);
      if (found.length)
        setInfos((old) => {
          const next = new Map(old);
          // A way cut at a tile edge: keep the longer shape.
          for (const s of found) {
            const prev = next.get(s.way);
            if (!prev || prev.coords.length < s.coords.length) next.set(s.way, s);
          }
          return next;
        });
      setNote(reason ? tNow("setup.tryAgain", { reason }) : null);
      if (again) {
        again = false;
        void load();
      }
    };
    const onMove = () => void load();
    map.on("moveend", onMove);
    void load();
    return () => {
      stopped = true;
      map.off("moveend", onMove);
    };
  }, [map, parse, fetchTile]);

  useEffect(() => {
    if (!map) return;
    ensureLayers(map);
    return () => removeLayers(map);
  }, [map]);

  useEffect(() => {
    if (map) drawStreets(map, infos.values(), setups);
  }, [map, infos, setups]);

  // Lanes of the loaded tiles on screen, rebuilt shortly after the map stops or a setup changes.
  const built = useRef<{ keys: string; setups: readonly StreetSetup[]; side: TrafficSide } | null>(null);
  useEffect(() => {
    if (!map || !lanes) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let seq = 0;
    const run = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (stopped || map.getZoom() < LANE_MIN_ZOOM) return;
        const b = map.getBounds();
        const keys = tilesFor([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
          .map(([x, y]) => `${x}/${y}`)
          .filter((k) => xmls.current.has(k));
        const sig = keys.join(",");
        const same =
          built.current?.keys === sig &&
          built.current.setups === setups &&
          built.current.side === trafficSide;
        if (!keys.length || same) return;
        const mine = ++seq;
        try {
          const g = await lanes.build(keys, setups, trafficSide);
          if (stopped || mine !== seq) return;
          built.current = { keys: sig, setups, side: trafficSide };
          drawLanes(map, g);
          setDrawn({ g, setups });
          setLaneError(null);
        } catch (err) {
          if (stopped || mine !== seq) return;
          built.current = null;
          drawLanes(map, null);
          setDrawn(null);
          setLaneError(tNow("setup.lanesFailed", { error: engineErrorText(err) }));
        }
      }, 250);
    };
    map.on("moveend", run);
    run();
    return () => {
      stopped = true;
      clearTimeout(timer);
      map.off("moveend", run);
    };
  }, [map, lanes, setups, tileCount, trafficSide]);

  useEffect(() => {
    if (map) selectStreet(map, selected);
  }, [map, selected, infos]);

  // Junctions coloured by their traffic lights: OSM's, or the planner's where set.
  useEffect(() => {
    if (map) drawJunctions(map, drawn?.g ?? null, junctions);
  }, [map, drawn, junctions]);
  useEffect(() => {
    if (map) selectJunction(map, junction?.key ?? null);
  }, [map, junction, drawn]);

  // Tap a junction (from zoom 16, where they are drawn) or a street to select it; tap elsewhere to close.
  const drawnRef = useRef(drawn);
  drawnRef.current = drawn;
  useEffect(() => {
    if (!map) return;
    const onClick = (ev: MapMouseEvent) => {
      const hit = map.getLayer(JUNCTION_LAYER)
        ? map
            .queryRenderedFeatures(ev.point, { layers: [JUNCTION_LAYER] })
            .find((f) => f.properties?.crossing)
        : undefined;
      const key = hit?.properties?.key;
      const j =
        typeof key === "string"
          ? drawnRef.current?.g?.junctions.find((x) => junctionKey(x.nodes) === key)
          : null;
      if (j) {
        setSelected(null);
        pickJunction({
          key: junctionKey(j.nodes),
          nodes: j.nodes,
          ways: j.ways,
          osmSignals: j.signals,
          lonlat: middle(j.ring),
        });
        return;
      }
      pickJunction(null);
      const { x, y } = ev.point;
      const hits = map.getLayer(HIT_LAYER)
        ? map.queryRenderedFeatures(
            [
              [x - 12, y - 12],
              [x + 12, y + 12],
            ],
            { layers: [HIT_LAYER] },
          )
        : [];
      const way = hits[0]?.properties?.way;
      setSelected(typeof way === "number" ? way : null);
    };
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
  }, [map]);

  const setupOf = (way: number) => setups.find((s) => s.way === way);
  const info = selected !== null ? infos.get(selected) : undefined;
  const setup = info ? setupOf(info.way) : undefined;
  // Real lanes only when built with the setups as they are now; until then the typical cross-section.
  const profile =
    info && drawn?.setups === setups ? drawn.g?.roads.find((r) => r.way === info.way)?.lanes : undefined;

  const change = (patch: Partial<StreetSetup>) => {
    if (!info) return;
    const mid = info.coords[Math.floor(info.coords.length / 2)]!;
    const base: StreetSetup = setup ?? { way: info.way };
    onChange(upsert(setups, { ...base, ...patch, way: info.way, name: info.name, at: mid }));
  };

  const show = (s: StreetSetup) => {
    setSelected(s.way);
    if (map && s.at) map.easeTo({ center: s.at, zoom: Math.max(map.getZoom(), 16) });
  };

  const junctionSetup = junction ? junctionSetupOf(junctions, junction.nodes) : undefined;
  const junctionName = (ways: readonly number[]) =>
    [...new Set(ways.map((w) => infos.get(w)?.name).filter((n): n is string => !!n))].slice(0, 3).join(" / ");
  const changeJunction = (signals: boolean | null) => {
    if (!junction || !onJunctionsChange) return;
    const name = junctionName(junction.ways);
    onJunctionsChange(
      setJunction(
        junctions,
        { nodes: junction.nodes, lonlat: junction.lonlat, ...(name ? { name } : {}) },
        signals,
      ),
    );
  };
  const showJunction = (j: JunctionSetup) => {
    setSelected(null);
    pickJunction({
      key: junctionKey(j.nodes),
      nodes: j.nodes,
      ways: [],
      osmSignals: false,
      lonlat: j.lonlat,
    });
    if (map) map.easeTo({ center: j.lonlat, zoom: Math.max(map.getZoom(), LANE_MIN_ZOOM + 1) });
  };
  // A junction chosen from the list: its streets and OSM's lights once its shape is drawn.
  useEffect(() => {
    if (!junction || junction.ways.length) return;
    const j = drawn?.g?.junctions.find((x) => x.nodes.some((n) => junction.nodes.includes(n)));
    if (j)
      pickJunction({
        key: junctionKey(j.nodes),
        nodes: j.nodes,
        ways: j.ways,
        osmSignals: j.signals,
        lonlat: middle(j.ring),
      });
  }, [drawn, junction]);

  const listed = useMemo(
    () => [...setups].sort((a, b) => (a.name || "").localeCompare(b.name || "") || a.way - b.way),
    [setups],
  );

  const body = (
    <div className="flex flex-col gap-4 px-4 pt-1 pb-6 md:px-5">
      <div>
        <h2 className="text-lg font-semibold">{t("setup.title")}</h2>
        <p className={`mt-1 text-sm text-slate-600 ${info ? "hidden md:block" : ""}`}>{t("setup.intro")}</p>
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {laneError && !error && (
        <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {laneError}
        </p>
      )}
      {note && !error && (
        <p role="status" className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
          {note}
        </p>
      )}

      {junction ? (
        <JunctionForm
          name={junctionName(junction.ways) || junctionSetup?.name || ""}
          osmSignals={junction.osmSignals}
          known={junction.ways.length > 0}
          setup={junctionSetup}
          editable={editable && !!onJunctionsChange}
          onSet={changeJunction}
          onClose={() => pickJunction(null)}
        />
      ) : info ? (
        <StreetForm
          info={info}
          setup={setup}
          lanes={profile}
          editable={editable}
          delays={delays}
          onPatch={change}
          onReset={() => onChange(setups.filter((s) => s.way !== info.way))}
          onClose={() => setSelected(null)}
        />
      ) : selected !== null ? (
        <p className="text-sm text-slate-600">{t("setup.moveToLoad")}</p>
      ) : (
        <p className="rounded-xl border border-dashed border-slate-300 px-3.5 py-3 text-sm text-slate-600">
          {t("setup.noneSelected")}
        </p>
      )}

      <Legend />

      <section aria-label={t("setup.listLabel")}>
        <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
          {t("setup.listTitle", { count: setups.length })}
        </h3>
        {listed.length === 0 ? (
          <p className="mt-1 text-sm text-slate-600">{t("setup.listEmpty")}</p>
        ) : (
          <ul className="mt-1 flex flex-col">
            {listed.map((s) => (
              <li key={s.way}>
                <button
                  type="button"
                  onClick={() => show(s)}
                  aria-current={s.way === selected ? "true" : undefined}
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-start hover:bg-slate-100 aria-[current=true]:bg-amber-50"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {s.name || t("setup.streetNum", { way: s.way })}
                  </span>
                  <span className="shrink-0 text-xs text-slate-500">{summary(s, t, tn)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-slate-500">{t("setup.saved")}</p>
      </section>

      <section aria-label={t("setup.junction.listTitle", { count: junctions.length })}>
        <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
          {t("setup.junction.listTitle", { count: junctions.length })}
        </h3>
        {junctions.length === 0 ? (
          <p className="mt-1 text-sm text-slate-600">
            {t("setup.junction.listEmpty", { zoom: LANE_MIN_ZOOM })}
          </p>
        ) : (
          <ul className="mt-1 flex flex-col">
            {junctions.map((j) => (
              <li key={junctionKey(j.nodes)}>
                <button
                  type="button"
                  onClick={() => showJunction(j)}
                  aria-current={junction?.key === junctionKey(j.nodes) ? "true" : undefined}
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-start hover:bg-slate-100 aria-[current=true]:bg-amber-50"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {j.name || t("setup.junction.unnamed")}
                  </span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {t(j.signals ? "setup.junction.yes" : "setup.junction.no")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );

  return panel ? createPortal(body, panel) : body;
}

/** Purpose: the panel of one junction: traffic lights as OSM maps them, or set by the planner. */
function JunctionForm({
  name,
  osmSignals,
  known,
  setup,
  editable,
  onSet,
  onClose,
}: {
  name: string;
  osmSignals: boolean;
  /** Whether its shape is drawn (so what OSM maps is known). */
  known: boolean;
  setup: JunctionSetup | undefined;
  editable: boolean;
  onSet: (signals: boolean | null) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const state = setup ? (setup.signals ? "yes" : "no") : "osm";
  return (
    <section aria-label={t("setup.junction.title")} className="flex flex-col gap-3.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold">{name || t("setup.junction.unnamed")}</h3>
          {known && (
            <p className="text-xs text-slate-500">
              {t(osmSignals ? "setup.junction.osmYes" : "setup.junction.osmNo")}
            </p>
          )}
        </div>
        {setup && <span className="tag shrink-0 bg-slate-900 text-white">{t("setup.setUp")}</span>}
        <button
          type="button"
          className="icon-btn -mt-2 -me-2"
          aria-label={t("setup.close")}
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <div role="group" aria-label={t("setup.junction.lights")} className="seg [&>button]:min-h-11">
        <button type="button" aria-pressed={state === "osm"} disabled={!editable} onClick={() => onSet(null)}>
          {t("setup.junction.asOsm")}
        </button>
        <button type="button" aria-pressed={state === "yes"} disabled={!editable} onClick={() => onSet(true)}>
          {t("setup.junction.yes")}
        </button>
        <button type="button" aria-pressed={state === "no"} disabled={!editable} onClick={() => onSet(false)}>
          {t("setup.junction.no")}
        </button>
      </div>
      <p className="text-sm text-slate-700">{t("setup.junction.note")}</p>
    </section>
  );
}

/** Purpose: a short list of what a setup sets, for the list of streets. */
function summary(s: StreetSetup, t: Translate, tn: TranslatePlural): string {
  const parts: string[] = [];
  if (s.sections) parts.push(t("setup.sum.custom"));
  if (s.oneway != null) parts.push(t(s.oneway ? "setup.oneway" : "setup.twoway"));
  if (s.traffic_lanes != null) parts.push(tn("setup.sum.lanes", s.traffic_lanes));
  if (s.bus_lane != null) parts.push(t(s.bus_lane ? "setup.sum.busLane" : "setup.sum.noBusLane"));
  if (s.bike_lane != null) parts.push(t(s.bike_lane ? "setup.sum.bikeLane" : "setup.sum.noBikeLane"));
  if (s.separated != null) parts.push(t(s.separated ? "setup.sum.separated" : "setup.sum.painted"));
  if (s.tram != null) parts.push(t(s.tram === "own_lane" ? "setup.sum.tramOwn" : "setup.sum.tramMixed"));
  if (s.cars_morning_peak != null) parts.push(t("setup.sum.morning", { cars: s.cars_morning_peak }));
  if (s.cars_evening_peak != null) parts.push(t("setup.sum.evening", { cars: s.cars_evening_peak }));
  return parts.join(" · ");
}

function StreetForm({
  info,
  setup,
  lanes,
  editable,
  delays,
  onPatch,
  onReset,
  onClose,
}: {
  info: StreetInfo;
  setup: StreetSetup | undefined;
  /** The street's lanes from OpenStreetMap with the setup applied (ADR-0047), once built. */
  lanes?: readonly LaneProfile[];
  editable: boolean;
  delays: DelayShares;
  onPatch: (p: Partial<StreetSetup>) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const e = effective(info, setup);
  const osmLanes = osmTrafficLanes(info);
  const facts = [
    CLASS_LABEL[info.class] ? t(CLASS_LABEL[info.class]!) : info.class,
    info.oneway ? t("setup.oneway") : null,
    info.maxspeed_kmh ? t("setup.speed", { speed: Math.round(info.maxspeed_kmh) }) : null,
    info.width_m ? t("setup.width", { width: info.width_m }) : null,
    info.tram ? t("setup.tramRails") : null,
  ].filter(Boolean);
  const v = verdicts(info, e, delays);
  // A custom layout: the planner's sections, or (set up with the earlier lane controls) the lanes they drew.
  const legacy =
    !!setup &&
    [setup.oneway, setup.traffic_lanes, setup.bus_lane, setup.bike_lane, setup.separated, setup.tram].some(
      (x) => x != null,
    );
  const custom = !!setup?.sections || legacy;
  const start = () =>
    lanes && lanes.length ? sectionsFromLanes(lanes) : sectionsFromInfo(info, e.trafficLanes || osmLanes);
  const shown = setup?.sections ?? (custom ? start() : []);
  const customise = () => onPatch({ ...OSM_LANES, sections: start() });
  return (
    <section
      aria-label={t("setup.formLabel", { name: info.name || t("setup.unnamedLower") })}
      className="flex flex-col gap-3.5"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold">{info.name || t("setup.unnamed")}</h3>
          <p className="text-xs text-slate-500">{facts.join(" · ")}</p>
        </div>
        {setup && <span className="tag shrink-0 bg-slate-900 text-white">{t("setup.setUp")}</span>}
        <button
          type="button"
          className="icon-btn -mt-2 -me-2"
          aria-label={t("setup.close")}
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      <div role="group" aria-label={t("setup.lay.mode")} className="seg [&>button]:min-h-11">
        <button
          type="button"
          aria-pressed={!custom}
          disabled={!editable}
          onClick={() => custom && onPatch(OSM_LANES)}
        >
          {t("setup.lay.osm")}
        </button>
        <button
          type="button"
          aria-pressed={custom}
          disabled={!editable}
          onClick={() => !custom && customise()}
        >
          {t("setup.lay.custom")}
        </button>
      </div>

      {custom ? (
        <SectionEditor
          key={info.way}
          sections={shown}
          streetWidth={info.width_m}
          editable={editable}
          onChange={(sections) => onPatch({ ...OSM_LANES, sections })}
        />
      ) : (
        <>
          <CrossSection e={e} oneway={e.oneway} lanes={lanes} />
          <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm text-slate-700">{t("setup.lay.osmNote")}</p>
            {editable && (
              <button type="button" className="btn btn-dark w-full" onClick={customise}>
                {t("setup.lay.customise")}
              </button>
            )}
          </div>
        </>
      )}

      <fieldset disabled={!editable} className="flex flex-col gap-3.5">
        {e.trafficLanes > 0 && (
          <div role="group" aria-label={t("setup.traffic")}>
            <div className="font-medium">{t("setup.traffic")}</div>
            <div className="text-xs text-slate-500">
              {t("setup.trafficPeakHint", { cars: peakCarsDefault(info.class) })}
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {(
                [
                  [
                    "cars_morning_peak",
                    "setup.morningPeak",
                    projectServiceDay().peaks[0] ?? DEFAULT_SERVICE_DAY.peaks[0],
                  ],
                  [
                    "cars_evening_peak",
                    "setup.eveningPeak",
                    projectServiceDay().peaks[1] ?? DEFAULT_SERVICE_DAY.peaks[1],
                  ],
                ] as const
              ).map(([field, label, win]) => (
                <label key={field} className="flex flex-col gap-1 text-sm">
                  <span>{t(label, { from: clock(win?.[0]), to: clock(win?.[1]) })}</span>
                  <span className="flex items-center gap-1.5">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={MAX_PEAK_CARS}
                      step={10}
                      className="input min-h-11 w-full min-w-0 tabular-nums"
                      placeholder={String(peakCarsDefault(info.class))}
                      value={setup?.[field] ?? ""}
                      onChange={(ev) => onPatch({ [field]: parsePeakCars(ev.target.value) })}
                    />
                    <span className="shrink-0 text-xs text-slate-500">{t("setup.carsPerHour")}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
      </fieldset>

      <section aria-label={t("setup.reliability")}>
        <h4 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
          {t("setup.reliability")}
        </h4>
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {v.map((x, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span
                className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${LEVEL_STYLE[x.level].cls}`}
                aria-label={t(`severity.${x.level}`)}
              >
                {LEVEL_STYLE[x.level].mark}
              </span>
              <span>
                <b className="font-semibold">{t("setup.who", { who: t(WHO[x.who]) })}</b> {x.text}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {editable && setup && (
        <button type="button" className="btn w-full" onClick={onReset}>
          {t("setup.reset")}
        </button>
      )}
    </section>
  );
}

/** Purpose: seconds after midnight as "7:00"; empty when unknown. */
function clock(sec: number | undefined): string {
  if (sec == null) return "";
  const m = Math.round(sec / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

function Legend() {
  const { t } = useI18n();
  const items: [keyof typeof PRIORITY_COLOR, MessageKey][] = [
    ["separated", "setup.legend.separated"],
    ["painted", "setup.legend.painted"],
    ["mixed", "setup.legend.mixed"],
    ["other", "setup.legend.other"],
  ];
  const lanes: [LaneKind, MessageKey][] = [
    ["traffic", "setup.x.car"],
    ["bus", "setup.x.bus"],
    ["bike", "setup.x.bike"],
    ["tram", "setup.x.tram"],
    ["pavement", "setup.x.walk"],
    ["green", "setup.x.green"],
  ];
  return (
    <ul aria-label={t("setup.legend")} className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600">
      {items.map(([k, l]) => (
        <li key={k} className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-5 rounded-full" style={{ background: PRIORITY_COLOR[k] }} />
          {t(l)}
        </li>
      ))}
      <li className="col-span-2 flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-5 rounded-full border-2 border-slate-900 bg-white" />{" "}
        {t("setup.legend.yours")}
      </li>
      <li className="col-span-2 mt-1 font-medium text-slate-700">
        {t("setup.legend.lanes", { zoom: LANE_MIN_ZOOM })}
      </li>
      <li className="col-span-2 flex items-center gap-1.5">
        <span
          className="inline-block h-2.5 w-5 rounded-sm border border-slate-400"
          style={{ background: SIGNAL_JUNCTION_COLOR }}
        />
        {t("setup.legend.signals")}
      </li>
      {lanes.map(([k, l]) => (
        <li key={k} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-5 rounded-sm border border-slate-400"
            style={{ background: LANE_COLOR[k] }}
          />
          <span className="first-letter:uppercase">{t(l)}</span>
        </li>
      ))}
    </ul>
  );
}
