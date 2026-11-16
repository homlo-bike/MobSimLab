import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/messages";
import type { PreferencesDoc } from "../../workspace/preferences";
import type { SavedStreetLine } from "../street-lines/saved";
import { MODES } from "../street-lines/modes";
import type { LonLat } from "../street-lines/types";
import { loadDepotEngine } from "./engine";
import {
  DEPOT_LAYERS,
  depotsGeoJson,
  draftGeoJson,
  ensureDepotLayers,
  removeDepotLayers,
  setDepotData,
  sweptGeoJson,
} from "./mapLayers";
import {
  ALL_MODES,
  depotFit,
  depotInput,
  inRing,
  lineFleet,
  linesOf,
  moveLane,
  newDepot,
  newId,
  resizeLane,
  ringArea,
  snapToRing,
  ZONE_COLOR,
  ZONE_KINDS,
  ZONE_LABEL,
} from "./model";
import type {
  DepotEngine,
  DepotEngineLoader,
  DepotsDoc,
  GateKind,
  Issue,
  Lane,
  LaneAngle,
  Report,
  SavedDepot,
  Sizing,
  Zone,
} from "./types";

type Tool =
  | { kind: "idle" }
  | { kind: "outline"; points: LonLat[] }
  | { kind: "zone"; points: LonLat[] }
  | { kind: "gate"; gate: GateKind }
  | { kind: "move" }
  | { kind: "copy" };

const GATE_LABEL: Record<GateKind, MessageKey> = {
  entrance: "depot.gate.entrance",
  exit: "depot.gate.exit",
  both: "depot.gate.both",
};
const ANGLES: LaneAngle[] = [90, 60, 45];
const NO_LINES: readonly SavedStreetLine[] = [];

interface Props {
  /** The map to draw on; `null` until the map has loaded. */
  map: MapLibreMap | null;
  /** Where the side panel renders; inline when `null`. */
  panel?: HTMLElement | null;
  /** The project's depots (drawing kind `depots`). */
  doc: DepotsDoc | null;
  /** Told about every change, so the project can save it. */
  onDoc: (doc: DepotsDoc) => void;
  /** The project's street lines: those using a depot set its vehicles and fleet. */
  lines?: readonly SavedStreetLine[];
  /** Project preferences: the depot values `depot.*` the project changed. */
  prefs?: PreferencesDoc["values"];
  /** Depot layout module loader; tests inject a fake. */
  loadEngine?: DepotEngineLoader;
}

/**
 * Purpose: the road depot tool (07-simulation §7): depots shared by all bus, BRT, trolleybus and intercity
 * bus lines. The planner draws the outline, places entrance and exit gates on it, draws zones (parking,
 * charging, maintenance, reserve, circulation) with straight or angled bays, and lets the auto layout fill
 * them with drive-through lanes; lanes can then be moved, copied, resized, given chargers or removed. Every
 * change is checked: the swept path in and out of each lane, the driving network from the entrances and to
 * the exits, and a slot for every vehicle of the lines using the depot. Dynamic sizing tells the area the
 * fleet needs and what the outline holds.
 * Side effects: adds layers and a click handler to the map while mounted; runs the depot layout module.
 */
export function DepotEditor({
  map,
  panel = null,
  doc,
  onDoc,
  lines = NO_LINES,
  prefs,
  loadEngine = loadDepotEngine,
}: Props) {
  const { t } = useI18n();
  const depots = doc?.depots ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(depots[0]?.id ?? null);
  const selected = depots.find((d) => d.id === selectedId) ?? null;
  const [tool, setTool] = useState<Tool>({ kind: "idle" });
  const [laneId, setLaneId] = useState<string | null>(null);
  const [engine, setEngine] = useState<DepotEngine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [layoutIssues, setLayoutIssues] = useState<Issue[]>([]);
  const [sizing, setSizing] = useState<Sizing | null>(null);
  const [busy, setBusy] = useState<MessageKey | null>(null);
  const lane = selected?.layout?.lanes.find((l) => l.id === laneId) ?? null;

  useEffect(() => {
    let alive = true;
    loadEngine()
      .then((e) => alive && setEngine(e))
      .catch((err) => alive && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, [loadEngine]);

  /** Purpose: save the depots with one of them changed (or removed when `next` is null). */
  const save = (id: string, next: SavedDepot | null) =>
    onDoc({ depots: next ? depots.map((d) => (d.id === id ? next : d)) : depots.filter((d) => d.id !== id) });
  const patch = (f: (d: SavedDepot) => SavedDepot) => selected && save(selected.id, f(selected));
  const setLanes = (f: (lanes: Lane[]) => Lane[]) =>
    patch((d) => ({ ...d, layout: { lanes: f(d.layout?.lanes ?? []), aisles: d.layout?.aisles ?? [] } }));

  const input = useMemo(
    () => (selected ? depotInput(selected, lines, prefs) : null),
    [selected, lines, prefs],
  );
  const inputKey = input ? JSON.stringify(input) : "";

  // Check the depot a moment after each change: swept paths, driving network, capacity.
  useEffect(() => {
    setReport(null);
    if (!engine || !inputKey) return;
    const parsed = JSON.parse(inputKey) as NonNullable<typeof input>;
    if (parsed.boundary.length < 3) return;
    const timer = setTimeout(() => {
      try {
        setReport(engine.analyse(parsed));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [engine, inputKey]);

  // The picked lane's swept path in and out.
  const swept = useMemo(() => {
    if (!engine || !input || !lane) return [];
    try {
      return engine.envelope(input, lane.id);
    } catch {
      return [];
    }
  }, [engine, inputKey, lane?.id]);

  // Map layers.
  useEffect(() => {
    if (!map) return;
    ensureDepotLayers(map);
    return () => removeDepotLayers(map);
  }, [map]);
  useEffect(() => {
    if (map) setDepotData(map, "depots", depotsGeoJson(depots, selectedId, report, laneId));
  }, [map, depots, selectedId, report, laneId]);
  useEffect(() => {
    if (map)
      setDepotData(
        map,
        "draft",
        draftGeoJson(tool.kind === "outline" || tool.kind === "zone" ? tool.points : []),
      );
  }, [map, tool]);
  useEffect(() => {
    if (map) setDepotData(map, "swept", sweptGeoJson(swept));
  }, [map, swept]);

  // Map clicks for the tool in use.
  const latest = useRef({ tool, selected, lane, depots });
  latest.current = { tool, selected, lane, depots };
  useEffect(() => {
    if (!map) return;
    const onClick = (ev: MapMouseEvent) => {
      const { tool: tl, selected: d, lane: l } = latest.current;
      const at: LonLat = [ev.lngLat.lng, ev.lngLat.lat];
      if (tl.kind === "outline" || tl.kind === "zone") {
        const first = tl.points[0];
        if (first && tl.points.length >= 3) {
          const p = map.project(first);
          if (Math.hypot(p.x - ev.point.x, p.y - ev.point.y) < 10) return finish(tl);
        }
        setTool({ ...tl, points: [...tl.points, at] });
      } else if (tl.kind === "gate" && d) {
        const lonlat = d.boundary.length >= 3 ? snapToRing(d.boundary, at) : at;
        save(d.id, { ...d, gates: [...d.gates, { id: newId("g"), kind: tl.gate, lonlat }] });
        setTool({ kind: "idle" });
      } else if (tl.kind === "move" && d && l) {
        setLanesOf(d, (ls) => ls.map((x) => (x.id === l.id ? moveLane(l, at) : x)));
        setTool({ kind: "idle" });
      } else if (tl.kind === "copy" && d && l) {
        const id = newId("ln");
        setLanesOf(d, (ls) => [...ls, moveLane(l, at, id)]);
        setLaneId(id);
        setTool({ kind: "idle" });
      } else {
        const { x, y } = ev.point;
        const box: [[number, number], [number, number]] = [
          [x - 3, y - 3],
          [x + 3, y + 3],
        ];
        const hit = map.getLayer(DEPOT_LAYERS.slots)
          ? map.queryRenderedFeatures(box, { layers: [DEPOT_LAYERS.slots] })[0]
          : undefined;
        if (hit) {
          setSelectedId(String(hit.properties?.depot));
          setLaneId(String(hit.properties?.lane));
          return;
        }
        const other = latest.current.depots.find((o) => o.boundary.length >= 3 && inRing(o.boundary, at));
        if (other) setSelectedId(other.id);
        setLaneId(null);
      }
    };
    const setLanesOf = (d: SavedDepot, f: (lanes: Lane[]) => Lane[]) =>
      save(d.id, { ...d, layout: { lanes: f(d.layout?.lanes ?? []), aisles: d.layout?.aisles ?? [] } });
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
  });

  useEffect(() => {
    if (!map) return;
    map.getCanvas().style.cursor = tool.kind === "idle" ? "" : "crosshair";
    return () => {
      map.getCanvas().style.cursor = "";
    };
  }, [map, tool.kind]);

  // Escape stops drawing; Enter finishes an outline or a zone.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      const tl = latest.current.tool;
      if (ev.key === "Escape") setTool({ kind: "idle" });
      else if (ev.key === "Enter" && (tl.kind === "outline" || tl.kind === "zone")) finish(tl);
      else if ((ev.key === "Delete" || ev.key === "Backspace") && latest.current.lane) removeLane();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /** Purpose: close the outline or zone being drawn. */
  function finish(tl: Extract<Tool, { kind: "outline" | "zone" }>) {
    const d = latest.current.selected;
    setTool({ kind: "idle" });
    if (!d || tl.points.length < 3) return;
    if (tl.kind === "outline") {
      // Gates stay on the outline.
      const gates = d.gates.map((g) => ({ ...g, lonlat: snapToRing(tl.points, g.lonlat) }));
      save(d.id, { ...d, boundary: tl.points, gates });
    } else {
      const zone: Zone = {
        id: newId("z"),
        kind: d.zones.some((z) => z.kind === "parking") ? "charging" : "parking",
        ring: tl.points,
        angle_deg: 90,
        vehicles_per_lane: null,
        vehicle: null,
        aisle_width_m: null,
        heading_deg: null,
      };
      save(d.id, { ...d, zones: [...d.zones, zone] });
    }
  }

  function removeLane() {
    const l = latest.current.lane;
    if (!l) return;
    setLanes((ls) => ls.filter((x) => x.id !== l.id));
    setLaneId(null);
  }

  const addDepot = () => {
    const d = newDepot(t("depot.newName", { n: depots.length + 1 }));
    onDoc({ depots: [...depots, d] });
    setSelectedId(d.id);
    setLaneId(null);
    setSizing(null);
    setLayoutIssues([]);
    setTool({ kind: "outline", points: [] });
  };

  const autoLayout = () => {
    if (!engine || !input || !selected) return;
    setBusy("depot.busy.layout");
    // Let the panel show the note before the layout runs.
    setTimeout(() => {
      try {
        const g = engine.generate({ ...input, layout: null });
        save(selected.id, { ...selected, layout: g.layout });
        setLayoutIssues(g.issues);
        setLaneId(null);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
      setBusy(null);
    }, 20);
  };

  const size = () => {
    if (!engine || !input) return;
    setBusy("depot.busy.size");
    setTimeout(() => {
      try {
        setSizing(engine.size(input));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
      setBusy(null);
    }, 20);
  };

  const drawing = tool.kind === "outline" || tool.kind === "zone";
  const using = selected ? linesOf(selected, lines) : [];
  // The vehicles of the lines using the depot, for the zones' "sized for".
  const vehicleKeys: [string, string][] = (input?.vehicles ?? []).map((v) => [
    v.key,
    `${v.name} (${v.length_m} m)`,
  ]);
  const vehicleName = (key: string) => vehicleKeys.find(([k]) => k === key)?.[1] ?? key;
  const issues = [
    ...layoutIssues,
    ...(report?.issues ?? []),
    ...(report?.capacity.issues ?? []).filter(
      (i) => !(report?.issues ?? []).some((j) => j.message === i.message),
    ),
  ];
  const laneCheck = lane && report?.lanes.find((c) => c.lane === lane.id);
  const laneReach = lane && report?.reach.find((r) => r.lane === lane.id);

  const body = (
    <div className="flex flex-col gap-4 px-4 pt-1 pb-6 text-sm md:px-5">
      <div>
        <h2 className="text-lg font-semibold">{t("depot.title")}</h2>
        <p className="mt-1 text-slate-600">{t("depot.intro")}</p>
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-2 text-red-800">
          {t("depot.failed", { error })}
        </p>
      )}
      {busy && (
        <p role="status" className="text-slate-600">
          {t(busy)}
        </p>
      )}

      <section>
        <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">{t("depot.list")}</h3>
        {depots.length === 0 && <p className="mt-1 text-slate-600">{t("depot.none")}</p>}
        <ul className="mt-1 flex flex-col">
          {depots.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                aria-current={d.id === selectedId}
                onClick={() => {
                  setSelectedId(d.id);
                  setLaneId(null);
                  setSizing(null);
                  setLayoutIssues([]);
                  const b = d.boundary;
                  if (map && b.length >= 3) {
                    const xs = b.map((p) => p[0]);
                    const ys = b.map((p) => p[1]);
                    map.fitBounds(
                      [
                        [Math.min(...xs), Math.min(...ys)],
                        [Math.max(...xs), Math.max(...ys)],
                      ],
                      { padding: 60, maxZoom: 19 },
                    );
                  }
                }}
                className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-slate-100 aria-[current=true]:bg-amber-50"
              >
                <span className="min-w-0 flex-1 truncate font-medium">{d.name}</span>
                <span className="shrink-0 text-xs text-slate-500">
                  {t("depot.slotsN", { n: (d.layout?.lanes ?? []).reduce((s, l) => s + l.slots.length, 0) })}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn mt-2 min-h-10" onClick={addDepot}>
          {t("depot.add")}
        </button>
      </section>

      {selected && (
        <section
          aria-label={selected.name}
          className="flex flex-col gap-3 rounded-xl border border-slate-200 p-3"
        >
          <label className="block">
            <span className="font-medium">{t("depot.name")}</span>
            <input
              className="input mt-1 w-full"
              value={selected.name}
              onChange={(e) => patch((d) => ({ ...d, name: e.target.value }))}
            />
          </label>
          <fieldset>
            <legend className="font-medium">{t("depot.modes")}</legend>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
              {ALL_MODES.map((m) => (
                <label key={m} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={selected.modes.includes(m)}
                    onChange={(e) =>
                      patch((d) => ({
                        ...d,
                        modes: e.target.checked ? [...d.modes, m] : d.modes.filter((x) => x !== m),
                      }))
                    }
                  />
                  {t(MODES[m].label)}
                </label>
              ))}
            </div>
          </fieldset>

          {/* Outline */}
          <div>
            <h3 className="font-medium">{t("depot.outline")}</h3>
            <p className="text-slate-600">
              {selected.boundary.length >= 3
                ? t("depot.area", { area: Math.round(ringArea(selected.boundary)).toLocaleString() })
                : t("depot.noOutline")}
            </p>
            {drawing ? (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-amber-800">
                  {t(tool.kind === "outline" ? "depot.hint.outline" : "depot.hint.zone")}
                </span>
                <button
                  type="button"
                  className="btn btn-pri min-h-10"
                  disabled={tool.points.length < 3}
                  onClick={() => finish(tool)}
                >
                  {t("depot.finish")}
                </button>
                <button type="button" className="btn min-h-10" onClick={() => setTool({ kind: "idle" })}>
                  {t("depot.cancel")}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn mt-1 min-h-10"
                onClick={() => setTool({ kind: "outline", points: [] })}
              >
                {selected.boundary.length >= 3 ? t("depot.redrawOutline") : t("depot.drawOutline")}
              </button>
            )}
          </div>

          {/* Gates */}
          <div>
            <h3 className="font-medium">{t("depot.gates")}</h3>
            <p className="text-slate-600">{t("depot.gatesNote")}</p>
            <ul className="mt-1 flex flex-col gap-1">
              {selected.gates.map((g, i) => (
                <li key={g.id} className="flex items-center gap-2">
                  <span className="w-6 text-slate-500">{i + 1}</span>
                  <select
                    aria-label={t("depot.gateKind")}
                    value={g.kind}
                    onChange={(e) =>
                      patch((d) => ({
                        ...d,
                        gates: d.gates.map((x) =>
                          x.id === g.id ? { ...x, kind: e.target.value as GateKind } : x,
                        ),
                      }))
                    }
                    className="min-w-0 flex-1 rounded border border-slate-300 p-0.5"
                  >
                    {(Object.keys(GATE_LABEL) as GateKind[]).map((k) => (
                      <option key={k} value={k}>
                        {t(GATE_LABEL[k])}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-100"
                    onClick={() => patch((d) => ({ ...d, gates: d.gates.filter((x) => x.id !== g.id) }))}
                  >
                    {t("depot.remove")}
                  </button>
                </li>
              ))}
            </ul>
            {tool.kind === "gate" ? (
              <p className="mt-1 text-amber-800">{t("depot.hint.gate")}</p>
            ) : (
              <div className="mt-1 flex flex-wrap gap-2">
                {(Object.keys(GATE_LABEL) as GateKind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className="btn min-h-10"
                    disabled={selected.boundary.length < 3}
                    onClick={() => setTool({ kind: "gate", gate: k })}
                  >
                    {t("depot.addGate", { kind: t(GATE_LABEL[k]) })}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Zones */}
          <div>
            <h3 className="font-medium">{t("depot.zones")}</h3>
            <p className="text-slate-600">{t("depot.zonesNote")}</p>
            <ul className="mt-1 flex flex-col gap-2">
              {selected.zones.map((z, i) => (
                <ZoneRow
                  key={z.id}
                  zone={z}
                  index={i}
                  vehicles={vehicleKeys}
                  onChange={(nz) =>
                    patch((d) => ({ ...d, zones: d.zones.map((x) => (x.id === z.id ? nz : x)) }))
                  }
                  onRemove={() => patch((d) => ({ ...d, zones: d.zones.filter((x) => x.id !== z.id) }))}
                />
              ))}
            </ul>
            {!drawing && (
              <div className="mt-1 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn min-h-10"
                  disabled={selected.boundary.length < 3}
                  onClick={() => setTool({ kind: "zone", points: [] })}
                >
                  {t("depot.drawZone")}
                </button>
                <button
                  type="button"
                  className="btn min-h-10"
                  disabled={selected.boundary.length < 3}
                  onClick={() => finish({ kind: "zone", points: selected.boundary })}
                >
                  {t("depot.wholeZone")}
                </button>
              </div>
            )}
          </div>

          {/* Layout */}
          <div>
            <h3 className="font-medium">{t("depot.layout")}</h3>
            <p className="text-slate-600">{t("depot.layoutNote")}</p>
            <button
              type="button"
              className="btn btn-pri mt-1 min-h-10"
              disabled={!engine || selected.boundary.length < 3 || busy !== null}
              onClick={autoLayout}
            >
              {selected.layout ? t("depot.relayout") : t("depot.autoLayout")}
            </button>
            {lane ? (
              <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2">
                <p className="font-medium">
                  {t("depot.lane", { kind: t(ZONE_LABEL[lane.kind]), n: lane.slots.length })}
                </p>
                {laneCheck && (
                  <p className={laneCheck.entry_ok && laneCheck.exit_ok ? "text-slate-600" : "text-red-700"}>
                    {laneCheck.entry_ok && laneCheck.exit_ok
                      ? t("depot.laneOk")
                      : (laneCheck.message ?? t("depot.laneBad"))}
                  </p>
                )}
                {laneReach && (!laneReach.from_entrance || !laneReach.to_exit) && (
                  <p className="text-red-700">{t("depot.laneUnreached")}</p>
                )}
                <p className="text-xs text-slate-600">{t("depot.sweptNote")}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span>{t("depot.slots")}</span>
                  <button
                    type="button"
                    className="rounded border border-slate-300 px-2 hover:bg-white"
                    aria-label={t("depot.fewer")}
                    disabled={lane.slots.length <= 1}
                    onClick={() =>
                      setLanes((ls) =>
                        ls.map((x) => (x.id === lane.id ? resizeLane(x, x.slots.length - 1) : x)),
                      )
                    }
                  >
                    −
                  </button>
                  <span className="font-mono">{lane.slots.length}</span>
                  <button
                    type="button"
                    className="rounded border border-slate-300 px-2 hover:bg-white"
                    aria-label={t("depot.more")}
                    onClick={() =>
                      setLanes((ls) =>
                        ls.map((x) => (x.id === lane.id ? resizeLane(x, x.slots.length + 1) : x)),
                      )
                    }
                  >
                    +
                  </button>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={lane.slots.every((s) => s.charger)}
                      onChange={(e) =>
                        setLanes((ls) =>
                          ls.map((x) =>
                            x.id === lane.id
                              ? { ...x, slots: x.slots.map((s) => ({ ...s, charger: e.target.checked })) }
                              : x,
                          ),
                        )
                      }
                    />
                    {t("depot.chargers")}
                  </label>
                </div>
                {tool.kind === "move" || tool.kind === "copy" ? (
                  <p className="mt-1 text-amber-800">{t("depot.hint.place")}</p>
                ) : (
                  <div className="mt-1 flex flex-wrap gap-2">
                    <button type="button" className="btn min-h-10" onClick={() => setTool({ kind: "move" })}>
                      {t("depot.move")}
                    </button>
                    <button type="button" className="btn min-h-10" onClick={() => setTool({ kind: "copy" })}>
                      {t("depot.copy")}
                    </button>
                    <button type="button" className="btn min-h-10" onClick={removeLane}>
                      {t("depot.removeLane")}
                    </button>
                    <button type="button" className="btn min-h-10" onClick={() => setLaneId(null)}>
                      {t("depot.done")}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              selected.layout && <p className="mt-1 text-xs text-slate-600">{t("depot.hint.pick")}</p>
            )}
          </div>

          {/* Capacity */}
          {report && (
            <div>
              <h3 className="font-medium">{t("depot.capacity")}</h3>
              <p className="text-slate-600">
                {t("depot.capacitySummary", {
                  parking: report.capacity.slots.parking,
                  charging: report.capacity.slots.charging,
                  reserve: report.capacity.slots.reserve,
                  maintenance: report.capacity.slots.maintenance,
                  chargers: report.capacity.chargers,
                  kw: report.capacity.charger_power_kw,
                })}
              </p>
              {report.capacity.rows.length > 0 && (
                <table className="mt-1 w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="font-normal">{t("depot.col.vehicle")}</th>
                      <th className="text-right font-normal">{t("depot.col.needed")}</th>
                      <th className="text-right font-normal">{t("depot.col.slots")}</th>
                      <th className="text-right font-normal">{t("depot.col.placed")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.capacity.rows.map((r) => (
                      <tr key={r.vehicle} className={r.placed < r.needed ? "text-red-700" : ""}>
                        <td>
                          {r.name} ({r.length_m} m)
                        </td>
                        <td className="text-right font-mono">
                          {r.needed}
                          {r.charging_needed > 0 && ` (${r.charging_needed} ⚡)`}
                        </td>
                        <td className="text-right font-mono">
                          {r.fitting_slots}
                          {r.fitting_charging > 0 && ` (${r.fitting_charging} ⚡)`}
                        </td>
                        <td className="text-right font-mono">{r.placed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Lines */}
          <div>
            <h3 className="font-medium">{t("depot.lines")}</h3>
            {using.length === 0 ? (
              <p className="text-slate-600">{t("depot.noLines")}</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-0.5">
                {using.map(({ line, index }) => {
                  const problem = depotFit(selected, line);
                  return (
                    <li key={index} className="flex justify-between gap-2">
                      <span className="min-w-0 truncate">
                        {line.name || t("depot.lineN", { n: index + 1 })}
                      </span>
                      <span className={`shrink-0 ${problem ? "text-red-700" : "text-slate-500"}`}>
                        {problem ? t(problem) : t("depot.vehiclesN", { n: lineFleet(line, prefs) })}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-1 text-xs text-slate-500">{t("depot.linesNote")}</p>
          </div>

          {/* Sizing */}
          <div>
            <h3 className="font-medium">{t("depot.sizing")}</h3>
            <p className="text-slate-600">{t("depot.sizingNote")}</p>
            <button
              type="button"
              className="btn mt-1 min-h-10"
              disabled={!engine || busy !== null}
              onClick={size}
            >
              {t("depot.size")}
            </button>
            {sizing && (
              <div className="mt-1">
                <p className="text-slate-600">
                  {t("depot.sizingFor", { n: sizing.fleet, vehicle: vehicleName(sizing.vehicle) })}
                </p>
                <table className="mt-1 w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="font-normal">{t("depot.col.angle")}</th>
                      <th className="text-right font-normal">{t("depot.col.area")}</th>
                      <th className="text-right font-normal">{t("depot.col.rect")}</th>
                      <th className="text-right font-normal">{t("depot.col.holds")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[90, 60, 45].map((angle) => {
                      const f = sizing.footprints.find((x) => x.angle_deg === angle);
                      const holds = sizing.holds.find((h) => h.angle_deg === angle);
                      if (!f && !holds) return null;
                      return (
                        <tr key={angle}>
                          <td>{angle}°</td>
                          <td className="text-right font-mono">
                            {f ? `${Math.round(f.area_m2).toLocaleString()} m²` : "–"}
                          </td>
                          <td className="text-right font-mono">
                            {f ? `${Math.round(f.width_m)} × ${Math.round(f.depth_m)} m` : "–"}
                          </td>
                          <td className="text-right font-mono">{holds ? holds.vehicles : "–"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Issues */}
          {issues.length > 0 && (
            <div>
              <h3 className="font-medium">{t("depot.issues")}</h3>
              <ul className="mt-1 flex flex-col gap-1">
                {issues.map((i, k) => (
                  <li
                    key={k}
                    className={
                      i.severity === "error"
                        ? "text-red-700"
                        : i.severity === "warning"
                          ? "text-amber-800"
                          : "text-slate-600"
                    }
                  >
                    {i.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            type="button"
            className="btn min-h-10 w-fit text-red-700"
            onClick={() => {
              save(selected.id, null);
              setSelectedId(depots.find((d) => d.id !== selected.id)?.id ?? null);
              setLaneId(null);
            }}
          >
            {t("depot.delete")}
          </button>
        </section>
      )}
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
        {ZONE_KINDS.map((k) => (
          <li key={k} className="flex items-center gap-1">
            <span className="inline-block size-3 rounded-sm" style={{ background: ZONE_COLOR[k] }} />
            {t(ZONE_LABEL[k])}
          </li>
        ))}
      </ul>
    </div>
  );
  return panel ? createPortal(body, panel) : body;
}

/** One zone in the panel: kind, bay angle, vehicles per lane, the vehicle the slots are sized for. */
function ZoneRow({
  zone,
  index,
  vehicles,
  onChange,
  onRemove,
}: {
  zone: Zone;
  index: number;
  vehicles: [string, string][];
  onChange: (z: Zone) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const slots = zone.kind !== "circulation";
  return (
    <li
      className="rounded-lg border border-slate-200 p-2"
      style={{ borderLeft: `4px solid ${ZONE_COLOR[zone.kind]}` }}
    >
      <div className="flex items-center gap-2">
        <span className="text-slate-500">{index + 1}</span>
        <select
          aria-label={t("depot.zoneKind")}
          value={zone.kind}
          onChange={(e) => onChange({ ...zone, kind: e.target.value as Zone["kind"] })}
          className="min-w-0 flex-1 rounded border border-slate-300 p-0.5"
        >
          {ZONE_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(ZONE_LABEL[k])}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">{Math.round(ringArea(zone.ring)).toLocaleString()} m²</span>
        <button
          type="button"
          className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-100"
          onClick={onRemove}
        >
          {t("depot.remove")}
        </button>
      </div>
      {slots && (
        <div className="mt-1 grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
          <span>{t("depot.angle")}</span>
          <select
            value={zone.angle_deg}
            onChange={(e) => onChange({ ...zone, angle_deg: Number(e.target.value) as LaneAngle })}
            className="rounded border border-slate-300 p-0.5"
          >
            {ANGLES.map((a) => (
              <option key={a} value={a}>
                {a === 90 ? t("depot.straight") : t("depot.angled", { a })}
              </option>
            ))}
          </select>
          <span>{t("depot.perLane")}</span>
          <select
            value={zone.vehicles_per_lane ?? ""}
            onChange={(e) =>
              onChange({ ...zone, vehicles_per_lane: e.target.value ? Number(e.target.value) : null })
            }
            className="rounded border border-slate-300 p-0.5"
          >
            <option value="">{t("depot.auto")}</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <span>{t("depot.sizedFor")}</span>
          <select
            value={zone.vehicle ?? ""}
            onChange={(e) => onChange({ ...zone, vehicle: e.target.value || null })}
            className="min-w-0 rounded border border-slate-300 p-0.5"
          >
            <option value="">{t("depot.longest")}</option>
            {vehicles.map(([k, name]) => (
              <option key={k} value={k}>
                {name}
              </option>
            ))}
          </select>
        </div>
      )}
    </li>
  );
}
