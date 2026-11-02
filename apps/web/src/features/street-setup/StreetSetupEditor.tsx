import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchStreetTile, loadStreetInfos } from "../street-lines/engine";
import { MIN_LOAD_ZOOM, tilesFor } from "../street-lines/tiles";
import type { TileFetcher } from "../street-lines/types";
import { CrossSection } from "./CrossSection";
import {
  drawStreets,
  ensureLayers,
  HIT_LAYER,
  PRIORITY_COLOR,
  removeLayers,
  selectStreet,
} from "./mapLayers";
import { CLASS_LABEL, effective, osmTrafficLanes, upsert, type Verdict, verdicts } from "./model";
import type { StreetInfo, StreetInfoLoader, StreetSetup, TramShare } from "./types";

interface Props {
  /** The map; `null` until it has loaded. */
  map: MapLibreMap | null;
  /** Where the side panel renders; inline when `null`. */
  panel?: HTMLElement | null;
  /** The project's street setups. */
  setups: readonly StreetSetup[];
  /** Told about every change. */
  onChange: (setups: StreetSetup[]) => void;
  /** Whether the planner may change setups (view-only projects only look). */
  editable?: boolean;
  /** Street tile loader (OSM XML); tests inject a fake. */
  fetchTile?: TileFetcher;
  /** Street parser loader; tests inject a fake. */
  loadInfos?: StreetInfoLoader;
}

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
 * Side effects: adds layers and a tap handler to the map while mounted; fetches street tiles.
 */
export function StreetSetupEditor({
  map,
  panel = null,
  setups,
  onChange,
  editable = true,
  fetchTile = fetchStreetTile,
  loadInfos = loadStreetInfos,
}: Props) {
  const [parse, setParse] = useState<((xml: string) => StreetInfo[]) | null>(null);
  const [infos, setInfos] = useState<Map<number, StreetInfo>>(new Map());
  const [selected, setSelected] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>("Loading streets…");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadInfos()
      .then((p) => alive && setParse(() => p))
      .catch((err) =>
        setError(`The street engine did not start: ${err instanceof Error ? err.message : String(err)}`),
      );
    return () => {
      alive = false;
    };
  }, [loadInfos]);

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
        setNote(`Zoom in to street level to load streets (from zoom ${MIN_LOAD_ZOOM}).`);
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
      setNote("Loading streets…");
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
        } catch (err) {
          tiles.current.delete(want[i]!);
          reason ??= err instanceof Error ? err.message : "Some streets did not load.";
        }
      });
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
      setNote(reason ? `${reason} Move the map to try again.` : null);
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

  useEffect(() => {
    if (map) selectStreet(map, selected);
  }, [map, selected, infos]);

  // Tap a street to select it; tap elsewhere to close.
  useEffect(() => {
    if (!map) return;
    const onClick = (ev: MapMouseEvent) => {
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

  const listed = useMemo(
    () => [...setups].sort((a, b) => (a.name || "").localeCompare(b.name || "") || a.way - b.way),
    [setups],
  );

  const body = (
    <div className="flex flex-col gap-4 px-4 pt-1 pb-6 md:px-5">
      <div>
        <h2 className="text-lg font-semibold">Streets</h2>
        <p className="mt-1 text-sm text-slate-600">
          Tap a street to say how it is shared: traffic lanes, bus and bike lanes, separation and trams. Your
          setup overrides OpenStreetMap in the street line tool and the railway editor, for running times and
          the reliability and safety checks.
        </p>
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {note && !error && (
        <p role="status" className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
          {note}
        </p>
      )}

      {info ? (
        <StreetForm
          info={info}
          setup={setup}
          editable={editable}
          onPatch={change}
          onReset={() => onChange(setups.filter((s) => s.way !== info.way))}
          onClose={() => setSelected(null)}
        />
      ) : selected !== null ? (
        <p className="text-sm text-slate-600">Move the map to this street to load it.</p>
      ) : (
        <p className="rounded-xl border border-dashed border-slate-300 px-3.5 py-3 text-sm text-slate-600">
          No street selected. Tap a street on the map.
        </p>
      )}

      <Legend />

      <section aria-label="Streets set up">
        <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
          Streets set up · {setups.length}
        </h3>
        {listed.length === 0 ? (
          <p className="mt-1 text-sm text-slate-600">None yet: every street follows OpenStreetMap.</p>
        ) : (
          <ul className="mt-1 flex flex-col">
            {listed.map((s) => (
              <li key={s.way}>
                <button
                  type="button"
                  onClick={() => show(s)}
                  aria-current={s.way === selected ? "true" : undefined}
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-slate-100 aria-[current=true]:bg-amber-50"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{s.name || `Street ${s.way}`}</span>
                  <span className="shrink-0 text-xs text-slate-500">{summary(s)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-slate-500">
          Saved in this browser for this project until projects keep their drawings on the server.
        </p>
      </section>
    </div>
  );

  return panel ? createPortal(body, panel) : body;
}

/** Purpose: a short list of what a setup sets, for the list of streets. */
function summary(s: StreetSetup): string {
  const parts: string[] = [];
  if (s.traffic_lanes != null) parts.push(`${s.traffic_lanes} lanes`);
  if (s.bus_lane != null) parts.push(s.bus_lane ? "bus lane" : "no bus lane");
  if (s.bike_lane != null) parts.push(s.bike_lane ? "bike lane" : "no bike lane");
  if (s.separated != null) parts.push(s.separated ? "separated" : "painted");
  if (s.tram != null) parts.push(s.tram === "own_lane" ? "tram own lane" : "tram in traffic");
  return parts.join(" · ");
}

function StreetForm({
  info,
  setup,
  editable,
  onPatch,
  onReset,
  onClose,
}: {
  info: StreetInfo;
  setup: StreetSetup | undefined;
  editable: boolean;
  onPatch: (p: Partial<StreetSetup>) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const e = effective(info, setup);
  const osmLanes = osmTrafficLanes(info);
  const facts = [
    CLASS_LABEL[info.class] ?? info.class,
    info.oneway ? "one-way" : null,
    info.maxspeed_kmh ? `${Math.round(info.maxspeed_kmh)} km/h` : null,
    info.width_m ? `${info.width_m} m wide` : null,
    info.tram ? "tram rails" : null,
  ].filter(Boolean);
  const v = verdicts(info, e);
  return (
    <section aria-label={`Street setup: ${info.name || "unnamed street"}`} className="flex flex-col gap-3.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold">{info.name || "Unnamed street"}</h3>
          <p className="text-xs text-slate-500">{facts.join(" · ")}</p>
        </div>
        {setup && <span className="tag shrink-0 bg-slate-900 text-white">Set up</span>}
        <button type="button" className="icon-btn -mt-2 -mr-2" aria-label="Close street" onClick={onClose}>
          ✕
        </button>
      </div>

      <CrossSection e={e} oneway={info.oneway} />

      <fieldset disabled={!editable} className="flex flex-col gap-3.5">
        <Row label="Traffic lanes" hint={`Both directions, without bus or tram lanes. OSM: ${osmLanes}`}>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="icon-btn border border-slate-300"
              aria-label="Fewer traffic lanes"
              disabled={e.trafficLanes <= 1}
              onClick={() => onPatch({ traffic_lanes: e.trafficLanes - 1 })}
            >
              −
            </button>
            <output aria-label="Traffic lanes" className="w-8 text-center text-lg font-semibold tabular-nums">
              {e.trafficLanes}
            </output>
            <button
              type="button"
              className="icon-btn border border-slate-300"
              aria-label="More traffic lanes"
              disabled={e.trafficLanes >= 8}
              onClick={() => onPatch({ traffic_lanes: e.trafficLanes + 1 })}
            >
              +
            </button>
          </div>
        </Row>
        <Choice
          label="Bus lane"
          value={setup?.bus_lane ?? null}
          osm={info.bus_lane ? "yes" : "no"}
          options={[
            [true, "Yes"],
            [false, "No"],
          ]}
          onPick={(x) => onPatch({ bus_lane: x })}
        />
        <Choice
          label="Bike lane"
          value={setup?.bike_lane ?? null}
          osm={info.bike_lane ? "yes" : "no"}
          options={[
            [true, "Yes"],
            [false, "No"],
          ]}
          onPick={(x) => onPatch({ bike_lane: x })}
        />
        <Choice
          label="Separation from traffic"
          hint="A kerb, barrier or separate track bed between the bus, tram and bike lanes and the traffic."
          value={setup?.separated ?? null}
          osm={info.class === "busway" ? "yes" : "none"}
          options={[
            [true, "Kerb or barrier"],
            [false, "Painted"],
          ]}
          onPick={(x) => onPatch({ separated: x })}
        />
        <Choice<TramShare>
          label="Tram"
          hint={
            info.tram
              ? "Tram rails run in this street."
              : "For a tram the railway editor runs along this street."
          }
          value={setup?.tram ?? null}
          osm="by width"
          options={[
            ["own_lane", "Own lane"],
            ["mixed", "Mixed traffic"],
          ]}
          onPick={(x) => onPatch({ tram: x })}
        />
      </fieldset>

      <section aria-label="Reliability and safety">
        <h4 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
          Reliability and safety
        </h4>
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {v.map((x, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span
                className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${LEVEL_STYLE[x.level].cls}`}
                aria-label={x.level}
              >
                {LEVEL_STYLE[x.level].mark}
              </span>
              <span>
                <b className="font-semibold">{x.who}:</b> {x.text}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {editable && setup && (
        <button type="button" className="btn w-full" onClick={onReset}>
          Reset to OpenStreetMap
        </button>
      )}
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="font-medium">{label}</div>
        {hint && <div className="text-xs text-slate-500">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

/** A three-way choice: as OpenStreetMap says (unset), or one of the options. */
function Choice<T extends string | boolean>({
  label,
  hint,
  value,
  osm,
  options,
  onPick,
}: {
  label: string;
  hint?: string;
  value: T | null;
  osm: string;
  options: [T, string][];
  onPick: (v: T | null) => void;
}) {
  return (
    <div role="group" aria-label={label}>
      <div className="font-medium">{label}</div>
      {hint && <div className="text-xs text-slate-500">{hint}</div>}
      <div className="seg mt-1.5">
        <button type="button" aria-pressed={value === null} onClick={() => onPick(null)}>
          OSM <span className="font-normal opacity-75">({osm})</span>
        </button>
        {options.map(([v, l]) => (
          <button key={String(v)} type="button" aria-pressed={value === v} onClick={() => onPick(v)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

function Legend() {
  const items: [keyof typeof PRIORITY_COLOR, string][] = [
    ["separated", "Bus or tram lane, separated"],
    ["painted", "Bus or tram lane, painted"],
    ["mixed", "Main road, transit in traffic"],
    ["other", "Other streets"],
  ];
  return (
    <ul aria-label="Map legend" className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600">
      {items.map(([k, l]) => (
        <li key={k} className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-5 rounded-full" style={{ background: PRIORITY_COLOR[k] }} />
          {l}
        </li>
      ))}
      <li className="col-span-2 flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-5 rounded-full border-2 border-slate-900 bg-white" /> Set up by
        you
      </li>
    </ul>
  );
}
