import { Marker, type Map as MapLibreMap, type MapMouseEvent } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { tNow, useI18n } from "../i18n/i18n";
import type { PluginLineInput } from "../features/journey-planner/network";
import { centralValues, contextLabel, findMode, type PluginTool } from "../plugins/registry";
import { loadKits, vesselType } from "./engine";
import { fmtDur, fmtInt, fmtLen } from "./format";
import { Issues, Stat } from "./Issues";
import {
  drawKit,
  ensureKitLayers,
  loadLocal,
  removeKitLayers,
  saveLocal,
  setKitColor,
  stationElement,
} from "./mapLayers";
import type { Kits, KitsLoader, LonLat, Pier, SpeedZone, WaterCall, WaterView } from "./types";

const PREFIX = "water";

/** What the planner drew, kept on this device per project. */
export interface WaterDoc {
  name: string;
  mode: string;
  vessel: string;
  piers: Pier[];
  calls: WaterCall[];
  zones: SpeedZone[];
  headwayMin: number;
  /** Planner's overrides, over the parameter values. */
  layoverS: number | null;
  paxPerCall: number | null;
  speedKn: number | null;
}

type Tool = "pier" | "via" | "zone";

interface Props {
  map: MapLibreMap | null;
  panel?: HTMLElement | null;
  /** The plugin tool (water route kit) with the modes it draws. */
  tool: PluginTool;
  storageKey: string;
  loadKits?: KitsLoader;
  onLineChange?: (line: PluginLineInput | null) => void;
}

function emptyDoc(tool: PluginTool): WaterDoc {
  const mode = findMode(tool.modes[0] ?? "")?.mode;
  return {
    name: tNow("ferry.defaultName"),
    mode: mode?.id ?? "",
    vessel: mode?.defaultContext ?? "",
    piers: [],
    calls: [],
    zones: [],
    headwayMin: 15,
    layoverS: null,
    paxPerCall: null,
    speedKn: null,
  };
}

/** Purpose: the drawing with pier `i` and its calls removed; later pier indices shift down. */
export function removePier(doc: WaterDoc, i: number): WaterDoc {
  return {
    ...doc,
    piers: doc.piers.filter((_, k) => k !== i),
    calls: doc.calls
      .filter((c) => c.pier !== i)
      .map((c) => ({ ...c, pier: c.pier > i ? c.pier - 1 : c.pier })),
  };
}

/**
 * Purpose: the water route kit's editor (ADR-0036 §6, ADR-0037 §3): click piers in calling order, add via
 * points to keep a leg on the water, draw speed zones; the panel sets the vessel type, headway, berths and
 * gangways, and shows running time, vessels, capacity, the berth check and the other live checks.
 * Side effects: adds layers, markers and a click handler to the map while mounted; stores the drawing in
 * this device's storage under `storageKey`.
 */
export function WaterRouteEditor({
  map,
  panel = null,
  tool,
  storageKey,
  loadKits: load = loadKits,
  onLineChange,
}: Props) {
  const { t, tn } = useI18n();
  const [kits, setKits] = useState<Kits | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<WaterDoc>(() => loadLocal(storageKey, emptyDoc(tool)));
  const [mode, setMode] = useState<Tool>("pier");
  const [leg, setLeg] = useState<number | null>(null);
  const [draft, setDraft] = useState<LonLat[]>([]);

  useEffect(() => {
    let alive = true;
    load().then(
      (k) => alive && setKits(k),
      (e) => setError(tNow("ferry.engineFailed", { error: e instanceof Error ? e.message : String(e) })),
    );
    return () => {
      alive = false;
    };
  }, [load]);
  useEffect(() => saveLocal(storageKey, doc), [storageKey, doc]);

  const found = findMode(doc.mode) ?? findMode(tool.modes[0] ?? "");
  const color = found?.mode.colour ?? "#0e7490";
  const values = useMemo(() => centralValues(doc.mode, doc.vessel), [doc.mode, doc.vessel]);
  const vessel = useMemo(
    () => vesselType(doc.vessel, values, doc.speedKn ? { service_speed_kn: doc.speedKn } : {}),
    [doc.vessel, doc.speedKn, values],
  );
  const layover = doc.layoverS ?? values["ferry.layover_s"] ?? 300;
  const pax = doc.paxPerCall ?? Math.round(vessel.capacity * (values["ferry.pax_per_call_share"] ?? 0.5));

  const view: WaterView | null = useMemo(() => {
    if (!kits) return null;
    try {
      return kits.buildWaterLine({
        piers: doc.piers,
        calls: doc.calls,
        vessel,
        headway_s: doc.headwayMin * 60,
        layover_s: layover,
        pax_per_call: pax,
        speed_zones: doc.zones,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [kits, doc.piers, doc.calls, doc.zones, doc.headwayMin, vessel, layover, pax]);

  const changed = useRef(onLineChange);
  changed.current = onLineChange;
  useEffect(() => {
    if (!view || view.directions.length < 2) return changed.current?.(null);
    const order = doc.calls.map((c) => c.pier);
    const stops = order.map((p) => ({
      name: doc.piers[p]?.name || tNow("ferry.pier", { n: p + 1 }),
      lonlat: doc.piers[p]!.lonlat,
    }));
    const n = order.length;
    // Stops are the calls in order; the backward direction visits them in reverse.
    const fwd = view.directions[0]!.map((s, k) => ({ stop: k, run_s: s.run_s, dwell_s: s.dwell_s }));
    const bwd = view.directions[1]!.map((s, k) => ({ stop: n - 1 - k, run_s: s.run_s, dwell_s: s.dwell_s }));
    changed.current?.({
      id: tool.id,
      name: doc.name,
      mode: doc.mode,
      color,
      stops,
      directions: [fwd, bwd],
      headwayS: doc.headwayMin * 60,
    });
  }, [view, doc.name, doc.mode, doc.calls, doc.piers, doc.headwayMin, color, tool.id]);

  useEffect(() => {
    if (!map) return;
    ensureKitLayers(map, PREFIX, color);
    return () => removeKitLayers(map, PREFIX);
  }, [map]);
  useEffect(() => {
    if (map) setKitColor(map, PREFIX, color);
  }, [map, color]);
  useEffect(() => {
    if (!map) return;
    const bad = new Set((view?.issues ?? []).filter((i) => i.level === "error").map((i) => i.section));
    drawKit(map, PREFIX, {
      lines: (view?.legs ?? []).map((l, i) => ({ coords: l.path, error: bad.has(i) })),
      points: doc.calls.flatMap((c) => c.via.map((lonlat) => ({ lonlat }))),
      zones: [...doc.zones.map((z) => z.ring), ...(draft.length ? [draft] : [])],
    });
  }, [map, view, doc.calls, doc.zones, draft]);

  useEffect(() => {
    if (!map) return;
    const markers = doc.piers.map((p, i) => {
      const el = stationElement(i + 1, p.name || tNow("ferry.pier", { n: i + 1 }), color, false);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        // In pier mode, clicking an existing pier calls there again (a loop or a return visit).
        if (latest.current.mode === "pier")
          setDoc((d) => ({ ...d, calls: [...d.calls, { pier: i, via: [] }] }));
      });
      const mk = new Marker({ element: el, draggable: true }).setLngLat(p.lonlat).addTo(map);
      mk.on("dragend", () => {
        const q = mk.getLngLat();
        setDoc((d) => ({
          ...d,
          piers: d.piers.map((x, k) => (k === i ? { ...x, lonlat: [q.lng, q.lat] } : x)),
        }));
      });
      return mk;
    });
    return () => markers.forEach((mk) => mk.remove());
  }, [map, doc.piers, color]);

  const latest = useRef({ mode, leg });
  latest.current = { mode, leg };
  useEffect(() => {
    if (!map) return;
    const onClick = (e: MapMouseEvent) => {
      const p: LonLat = [e.lngLat.lng, e.lngLat.lat];
      const { mode, leg } = latest.current;
      if (mode === "pier")
        setDoc((d) => ({
          ...d,
          piers: [
            ...d.piers,
            { name: tNow("ferry.pier", { n: d.piers.length + 1 }), lonlat: p, berths: 1, gangways: 1 },
          ],
          calls: [...d.calls, { pier: d.piers.length, via: [] }],
        }));
      else if (mode === "via")
        setDoc((d) => {
          const target = leg ?? d.calls.length - 2;
          const k = target + 1;
          if (k < 1 || k >= d.calls.length) return d;
          return { ...d, calls: d.calls.map((c, j) => (j === k ? { ...c, via: [...c.via, p] } : c)) };
        });
      else setDraft((z) => [...z, p]);
    };
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
  }, [map]);

  const setPier = (i: number, patch: Partial<Pier>) =>
    setDoc((d) => ({ ...d, piers: d.piers.map((x, k) => (k === i ? { ...x, ...patch } : x)) }));
  const where = (i: { station?: number; section?: number }) =>
    i.station !== undefined
      ? doc.piers[i.station]?.name || t("ferry.pierLower", { n: i.station + 1 })
      : i.section !== undefined
        ? t("ferry.legLower", { n: i.section + 1 })
        : null;
  const modes = tool.modes.map((id) => findMode(id)?.mode).filter((x) => x !== undefined);
  const hints: Record<Tool, string> = {
    pier: t("ferry.hint.pier"),
    via: t("ferry.hint.via", { n: (leg ?? doc.calls.length - 2) + 1 }),
    zone: t("ferry.hint.zone"),
  };
  const num = (v: string, min = 0) => Math.max(min, Number(v) || 0);

  const body = (
    <div className="flex flex-col gap-3 px-4 pt-1 pb-5 text-sm md:px-5">
      <input
        aria-label={t("kit.lineName")}
        className="rounded-lg border border-slate-300 px-2.5 py-1.5"
        value={doc.name}
        onChange={(e) => setDoc({ ...doc, name: e.target.value })}
      />
      <div className="seg" role="tablist" aria-label={t("kit.tool")}>
        <button type="button" role="tab" aria-selected={mode === "pier"} onClick={() => setMode("pier")}>
          {t("ferry.piers")}
        </button>
        <button type="button" role="tab" aria-selected={mode === "via"} onClick={() => setMode("via")}>
          {t("ferry.via")}
        </button>
        <button type="button" role="tab" aria-selected={mode === "zone"} onClick={() => setMode("zone")}>
          {t("ferry.zone")}
        </button>
      </div>
      <p className="text-xs text-slate-500">{hints[mode]}</p>
      {mode === "zone" && (
        <div className="flex gap-2">
          <button
            type="button"
            className="btn min-h-9"
            disabled={draft.length < 3}
            onClick={() => {
              setDoc((d) => ({
                ...d,
                zones: [
                  ...d.zones,
                  {
                    name: tNow("ferry.zoneName", { n: d.zones.length + 1 }),
                    ring: draft,
                    max_kn: values["ferry.harbour_speed_kn"] ?? 6,
                  },
                ],
              }));
              setDraft([]);
            }}
          >
            {t("ferry.finishZone")}
          </button>
          {draft.length > 0 && (
            <button type="button" className="btn min-h-9" onClick={() => setDraft([])}>
              {t("ferry.cancel")}
            </button>
          )}
        </div>
      )}
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-600">{t("ferry.vessel")}</span>
        <select
          className="rounded-lg border border-slate-300 px-2 py-1.5"
          value={`${doc.mode}|${doc.vessel}`}
          onChange={(e) => {
            const [m, v] = e.target.value.split("|");
            setDoc({ ...doc, mode: m!, vessel: v!, speedKn: null, paxPerCall: null });
          }}
        >
          {modes.flatMap((md) =>
            (md.contexts ?? []).map((c) => (
              <option key={`${md.id}|${c}`} value={`${md.id}|${c}`}>
                {contextLabel(md.id, c)}
              </option>
            )),
          )}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">{t("ferry.every")}</span>
          <input
            type="number"
            min={2}
            className="rounded-lg border border-slate-300 px-2 py-1.5"
            value={doc.headwayMin}
            onChange={(e) => setDoc({ ...doc, headwayMin: num(e.target.value, 2) })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">{t("ferry.speed")}</span>
          <input
            type="number"
            min={1}
            className="rounded-lg border border-slate-300 px-2 py-1.5"
            value={vessel.service_speed_kn}
            onChange={(e) => setDoc({ ...doc, speedKn: num(e.target.value, 1) })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">{t("ferry.layover")}</span>
          <input
            type="number"
            min={0}
            className="rounded-lg border border-slate-300 px-2 py-1.5"
            value={Math.round(layover / 6) / 10}
            onChange={(e) => setDoc({ ...doc, layoverS: num(e.target.value) * 60 })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">{t("ferry.pax")}</span>
          <input
            type="number"
            min={0}
            className="rounded-lg border border-slate-300 px-2 py-1.5"
            value={pax}
            onChange={(e) => setDoc({ ...doc, paxPerCall: num(e.target.value) })}
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-2.5 py-1.5 text-red-900">
          {error}
        </p>
      )}
      {!kits && !error && <p className="text-slate-500">{t("ferry.starting")}</p>}
      {view && view.legs.length > 0 && (
        <div className="grid grid-cols-2 gap-2" aria-label={t("kit.summary")}>
          <Stat label={t("kit.length")} value={fmtLen(view.length_m)} />
          <Stat label={t("kit.tripTime")} value={fmtDur(view.trip_time_s)} />
          <Stat label={t("ferry.vessels")} value={String(view.vessels)} />
          <Stat label={t("kit.capacity")} value={t("kit.pph", { n: fmtInt(view.capacity_pphpd) })} />
          <Stat label={t("ferry.roundTrip")} value={fmtDur(view.cycle_s)} />
          <Stat
            label={t("ferry.berthWaits")}
            value={
              view.holds ? t("ferry.holds", { n: view.holds, time: fmtDur(view.held_s) }) : t("ferry.none")
            }
          />
        </div>
      )}
      {view && <Issues issues={view.issues} where={where} />}
      <section aria-label={t("ferry.piers")} className="flex flex-col gap-2">
        <h3 className="font-semibold">{t("ferry.piers")}</h3>
        {doc.piers.length === 0 && <p className="text-slate-500">{t("ferry.noPiers")}</p>}
        {doc.piers.map((p, i) => {
          const use = view?.berths.find((b) => b.pier === i);
          return (
            <div key={i} className="rounded-lg border border-slate-200 p-2">
              <div className="flex items-center gap-2">
                <span className="w-5 text-center font-semibold" style={{ color }}>
                  {i + 1}
                </span>
                <input
                  aria-label={t("ferry.pierName", { n: i + 1 })}
                  className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1"
                  value={p.name}
                  onChange={(e) => setPier(i, { name: e.target.value })}
                />
                <button
                  type="button"
                  className="btn min-h-8 px-2 text-xs"
                  onClick={() => setDoc(removePier(doc, i))}
                >
                  {t("kit.delete")}
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs">
                <label className="flex items-center gap-1">
                  {t("ferry.berths")}
                  <input
                    type="number"
                    min={1}
                    aria-label={t("ferry.berthsOf", { n: i + 1 })}
                    className="w-14 rounded border border-slate-300 px-1.5 py-0.5"
                    value={p.berths}
                    onChange={(e) => setPier(i, { berths: num(e.target.value, 1) })}
                  />
                </label>
                <label className="flex items-center gap-1">
                  {t("ferry.gangways")}
                  <input
                    type="number"
                    min={1}
                    aria-label={t("ferry.gangwaysOf", { n: i + 1 })}
                    className="w-14 rounded border border-slate-300 px-1.5 py-0.5"
                    value={p.gangways}
                    onChange={(e) => setPier(i, { gangways: num(e.target.value, 1) })}
                  />
                </label>
                {use && (
                  <span className={use.holds ? "text-amber-800" : "text-slate-500"}>
                    {tn("ferry.upTo", use.peak)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </section>
      {view && view.legs.length > 0 && (
        <section aria-label={t("ferry.legs")} className="flex flex-col gap-1">
          <h3 className="font-semibold">{t("ferry.legs")}</h3>
          {view.legs.map((l, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                className={`rounded px-1.5 py-0.5 ${leg === i ? "bg-amber-100" : "bg-slate-100"}`}
                onClick={() => {
                  setLeg(i);
                  setMode("via");
                }}
              >
                {t("ferry.leg", { n: i + 1 })}
              </button>
              {fmtLen(l.length_m)}
              {t("setup.x.sep")}
              {fmtDur(l.time_s)}
              {l.slow_m > 0 && (
                <span className="text-slate-500">{t("ferry.slowed", { len: fmtLen(l.slow_m) })}</span>
              )}
              {(doc.calls[i + 1]?.via.length ?? 0) > 0 && (
                <button
                  type="button"
                  className="text-blue-700 underline"
                  onClick={() =>
                    setDoc((d) => ({
                      ...d,
                      calls: d.calls.map((c, j) => (j === i + 1 ? { ...c, via: [] } : c)),
                    }))
                  }
                >
                  {t("ferry.clearVia")}
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            className="self-start text-xs text-red-700 underline"
            onClick={() => setDoc((d) => ({ ...d, calls: d.calls.slice(0, -1) }))}
          >
            {t("ferry.removeLast")}
          </button>
        </section>
      )}
      {doc.zones.length > 0 && (
        <section aria-label={t("ferry.zones")} className="flex flex-col gap-1">
          <h3 className="font-semibold">{t("ferry.zones")}</h3>
          {doc.zones.map((z, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              {t("ferry.zoneLimit", { name: z.name })}
              <input
                type="number"
                min={1}
                aria-label={t("ferry.zoneLimitOf", { name: z.name })}
                className="w-14 rounded border border-slate-300 px-1.5 py-0.5"
                value={z.max_kn}
                onChange={(e) =>
                  setDoc((d) => ({
                    ...d,
                    zones: d.zones.map((x, k) => (k === i ? { ...x, max_kn: num(e.target.value, 1) } : x)),
                  }))
                }
              />
              {t("ferry.kn")}
              <button
                type="button"
                className="text-red-700 underline"
                onClick={() => setDoc((d) => ({ ...d, zones: d.zones.filter((_, k) => k !== i) }))}
              >
                {t("kit.remove")}
              </button>
            </div>
          ))}
        </section>
      )}
      <p className="text-[11px] text-slate-500">
        {t("kit.valuesFrom", {
          plugin: found?.plugin.name ?? t("ferry.plugin"),
          context: contextLabel(doc.mode, doc.vessel),
        })}{" "}
        {t("ferry.carLater")} {t("kit.keptHere")}
      </p>
    </div>
  );
  return panel ? createPortal(body, panel) : body;
}
