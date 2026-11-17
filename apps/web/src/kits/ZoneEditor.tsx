import { Marker, type Map as MapLibreMap, type MapMouseEvent } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { tNow, useI18n } from "../i18n/i18n";
import { centralValues, findMode, type PluginTool } from "../plugins/registry";
import { dispatchRules, loadKits, zoneSystem } from "./engine";
import { fmtInt } from "./format";
import { Issues, Stat } from "./Issues";
import { drawKit, ensureKitLayers, loadLocal, removeKitLayers, saveLocal, setKitColor } from "./mapLayers";
import type { DispatchResult, Kits, KitsLoader, LonLat, ZoneView } from "./types";

const PREFIX = "zone";

/** What the planner drew, kept on this device per project. */
export interface ZoneDoc {
  name: string;
  mode: string;
  ring: LonLat[];
  requestsPerHour: number;
  fleet: number;
  /** Service hours as HH:MM. */
  from: string;
  to: string;
}

/** An on-demand zone as the journey planner shows it. */
export interface DemandZone {
  id: string;
  name: string;
  color: string;
  ring: LonLat[];
  view: ZoneView;
  /** The simulated day, when the planner ran it for the zone as drawn now. */
  simulated?: { wait_s: number; ride_s: number };
}

interface Props {
  map: MapLibreMap | null;
  panel?: HTMLElement | null;
  /** The plugin tool (service zone kit) with the modes it draws. */
  tool: PluginTool;
  storageKey: string;
  loadKits?: KitsLoader;
  onZoneChange?: (zone: DemandZone | null) => void;
}

function emptyDoc(tool: PluginTool): ZoneDoc {
  return {
    name: tNow("drt.defaultName"),
    mode: tool.modes[0] ?? "",
    ring: [],
    requestsPerHour: 30,
    fleet: 4,
    from: "06:00",
    to: "22:00",
  };
}

/** Purpose: seconds after midnight of HH:MM (0 when empty). */
const secs = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 3600 + (m || 0) * 60;
};

/**
 * Purpose: the service zone kit's editor (ADR-0036 §6): click the zone's outline on the map, set the
 * requests an hour, the fleet and the service hours; the panel shows the vehicles needed, the busy share,
 * the average wait, ride and door-to-door time and the live checks, from the kit's continuous-approximation
 * estimate. "Simulate the day" runs the kit's dispatch simulation (ADR-0042) for the zone as drawn.
 * Side effects: adds layers, markers and a click handler to the map while mounted; stores the drawing in
 * this device's storage under `storageKey`.
 */
export function ZoneEditor({
  map,
  panel = null,
  tool,
  storageKey,
  loadKits: load = loadKits,
  onZoneChange,
}: Props) {
  const { t } = useI18n();
  const [kits, setKits] = useState<Kits | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<ZoneDoc>(() => loadLocal(storageKey, emptyDoc(tool)));

  useEffect(() => {
    let alive = true;
    load().then(
      (k) => alive && setKits(k),
      (e) => setError(tNow("drt.engineFailed", { error: e instanceof Error ? e.message : String(e) })),
    );
    return () => {
      alive = false;
    };
  }, [load]);
  useEffect(() => saveLocal(storageKey, doc), [storageKey, doc]);

  const found = findMode(doc.mode) ?? findMode(tool.modes[0] ?? "");
  const color = found?.mode.colour ?? "#9333ea";
  const prefix = found?.mode.parameterPrefix ?? "drt";
  const system = useMemo(() => zoneSystem(centralValues(doc.mode, "*"), prefix), [doc.mode, prefix]);

  const view: ZoneView | null = useMemo(() => {
    if (!kits) return null;
    try {
      return kits.estimateZone({
        ring: doc.ring,
        requests_per_hour: doc.requestsPerHour,
        fleet: doc.fleet,
        start_s: secs(doc.from),
        end_s: secs(doc.to),
        system,
        parameter_prefix: prefix,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [kits, doc.ring, doc.requestsPerHour, doc.fleet, doc.from, doc.to, system, prefix]);

  // The trip-by-trip simulation (ADR-0042), run on request; it belongs to the inputs it ran with.
  const simInput = useMemo(
    () =>
      doc.ring.length >= 3
        ? {
            zone: {
              ring: doc.ring,
              requests_per_hour: doc.requestsPerHour,
              fleet: doc.fleet,
              start_s: secs(doc.from),
              end_s: secs(doc.to),
              system,
              parameter_prefix: prefix,
            },
            rules: dispatchRules(centralValues(doc.mode, "*"), prefix),
          }
        : null,
    [doc.ring, doc.requestsPerHour, doc.fleet, doc.from, doc.to, doc.mode, system, prefix],
  );
  const [sim, setSim] = useState<{ input: typeof simInput; result: DispatchResult } | null>(null);
  const [simulating, setSimulating] = useState(false);
  const day = sim && sim.input === simInput ? sim.result : null;
  const simulate = () => {
    if (!kits || !simInput) return;
    setSimulating(true);
    // Let the status show before the run blocks the page for a moment.
    setTimeout(() => {
      try {
        setSim({ input: simInput, result: kits.simulateZone(simInput) });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSimulating(false);
      }
    }, 0);
  };

  const changed = useRef(onZoneChange);
  changed.current = onZoneChange;
  useEffect(() => {
    if (!view || doc.ring.length < 3) return changed.current?.(null);
    changed.current?.({
      id: tool.id,
      name: doc.name,
      color,
      ring: doc.ring,
      view,
      ...(day && day.served > 0 ? { simulated: { wait_s: day.mean_wait_s, ride_s: day.mean_ride_s } } : {}),
    });
  }, [view, day, doc.name, doc.ring, color, tool.id]);

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
    const ring = doc.ring;
    drawKit(map, PREFIX, {
      lines: ring.length >= 2 ? [{ coords: ring.length >= 3 ? [...ring, ring[0]!] : ring }] : [],
      points: [],
      zones: ring.length >= 3 ? [ring] : [],
    });
  }, [map, doc.ring]);

  // Outline points as draggable markers.
  useEffect(() => {
    if (!map) return;
    const markers = doc.ring.map((p, i) => {
      const el = document.createElement("div");
      el.setAttribute("aria-label", tNow("drt.point", { n: i + 1 }));
      Object.assign(el.style, {
        width: "12px",
        height: "12px",
        borderRadius: "50%",
        background: "#fff",
        border: `3px solid ${color}`,
        cursor: "grab",
      });
      el.addEventListener("click", (e) => e.stopPropagation());
      const mk = new Marker({ element: el, draggable: true }).setLngLat(p).addTo(map);
      mk.on("dragend", () => {
        const q = mk.getLngLat();
        setDoc((d) => ({ ...d, ring: d.ring.map((x, k) => (k === i ? [q.lng, q.lat] : x)) }));
      });
      return mk;
    });
    return () => markers.forEach((mk) => mk.remove());
  }, [map, doc.ring, color]);

  useEffect(() => {
    if (!map) return;
    const onClick = (e: MapMouseEvent) =>
      setDoc((d) => ({ ...d, ring: [...d.ring, [e.lngLat.lng, e.lngLat.lat]] }));
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
  }, [map]);

  const num = (v: string, min = 0) => Math.max(min, Number(v) || 0);
  const field = "rounded-lg border border-slate-300 px-2 py-1.5";
  const mins = (s: number) => t("drt.min", { n: Math.round(s / 60) });

  const body = (
    <div className="flex flex-col gap-3 px-4 pt-1 pb-5 text-sm md:px-5">
      <input
        aria-label={t("kit.lineName")}
        className={field}
        value={doc.name}
        onChange={(e) => setDoc({ ...doc, name: e.target.value })}
      />
      <p className="text-xs text-slate-500">{t("drt.hint")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-600">{t("drt.points", { n: doc.ring.length })}</span>
        <button
          type="button"
          className="btn min-h-8 px-2 text-xs"
          disabled={doc.ring.length === 0}
          onClick={() => setDoc((d) => ({ ...d, ring: d.ring.slice(0, -1) }))}
        >
          {t("drt.removeLast")}
        </button>
        <button
          type="button"
          className="btn min-h-8 px-2 text-xs"
          disabled={doc.ring.length === 0}
          onClick={() => setDoc((d) => ({ ...d, ring: [] }))}
        >
          {t("drt.clear")}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">{t("drt.requests")}</span>
          <input
            type="number"
            min={0}
            className={field}
            value={doc.requestsPerHour}
            onChange={(e) => setDoc({ ...doc, requestsPerHour: num(e.target.value) })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">{t("drt.fleet")}</span>
          <input
            type="number"
            min={0}
            className={field}
            value={doc.fleet}
            onChange={(e) => setDoc({ ...doc, fleet: Math.round(num(e.target.value)) })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">{t("drt.from")}</span>
          <input
            type="time"
            className={field}
            value={doc.from}
            onChange={(e) => setDoc({ ...doc, from: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">{t("drt.to")}</span>
          <input
            type="time"
            className={field}
            value={doc.to}
            onChange={(e) => setDoc({ ...doc, to: e.target.value })}
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-2.5 py-1.5 text-red-900">
          {error}
        </p>
      )}
      {!kits && !error && <p className="text-slate-500">{t("drt.starting")}</p>}
      {view && doc.ring.length >= 3 && (
        <div className="grid grid-cols-2 gap-2" aria-label={t("kit.summary")}>
          <Stat label={t("drt.area")} value={t("drt.km2", { n: view.area_km2.toFixed(1) })} />
          <Stat label={t("drt.trip")} value={t("drt.km", { n: view.mean_trip_km.toFixed(1) })} />
          <Stat label={t("drt.needed")} value={String(view.vehicles_needed)} />
          <Stat label={t("drt.busy")} value={`${Math.round(view.utilisation * 100)} %`} />
          <Stat label={t("drt.wait")} value={view.wait_s === null ? t("drt.tooFew") : mins(view.wait_s)} />
          <Stat label={t("drt.ride")} value={mins(view.ride_s)} />
          <Stat
            label={t("drt.doorToDoor")}
            value={view.door_to_door_s === null ? t("drt.tooFew") : mins(view.door_to_door_s)}
          />
          <Stat label={t("drt.occupancy")} value={view.mean_occupancy.toFixed(1)} />
          <Stat label={t("drt.vkm")} value={fmtInt(view.vehicle_km_per_day)} />
          <Stat label={t("drt.vhours")} value={fmtInt(view.vehicle_hours_per_day)} />
        </div>
      )}
      {view && <Issues issues={view.issues} where={() => null} source={tool.id} label={tool.label} />}
      {kits && simInput && (
        <button type="button" className="btn self-start" disabled={simulating} onClick={simulate}>
          {simulating ? t("drt.simulating") : t("drt.simulate")}
        </button>
      )}
      {day && (
        <section aria-labelledby="drt-sim-title" className="flex flex-col gap-2">
          <h3 id="drt-sim-title" className="text-xs font-semibold text-slate-700">
            {t("drt.sim.title")}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <Stat
              label={t("drt.sim.served")}
              value={t("drt.sim.servedOf", { served: fmtInt(day.served), requests: fmtInt(day.requests) })}
            />
            <Stat label={t("drt.sim.rejected")} value={fmtInt(day.rejected)} />
            <Stat label={t("drt.wait")} value={mins(day.mean_wait_s)} />
            <Stat label={t("drt.sim.p90Wait")} value={mins(day.p90_wait_s)} />
            <Stat label={t("drt.ride")} value={mins(day.mean_ride_s)} />
            <Stat
              label={t("drt.sim.detour")}
              value={`+${Math.round(Math.max(0, day.mean_detour_factor - 1) * 100)} %`}
            />
            <Stat label={t("drt.sim.shared")} value={`${Math.round(day.shared_share * 100)} %`} />
            <Stat label={t("drt.occupancy")} value={day.mean_occupancy.toFixed(1)} />
            <Stat label={t("drt.vkm")} value={fmtInt(day.vehicle_km)} />
            <Stat label={t("drt.sim.empty")} value={`${Math.round(day.empty_share * 100)} %`} />
            <Stat label={t("drt.sim.perVehicleHour")} value={day.riders_per_vehicle_hour.toFixed(1)} />
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-600">
                <th className="font-medium">{t("drt.sim.hour")}</th>
                <th className="font-medium">{t("drt.requests")}</th>
                <th className="font-medium">{t("drt.sim.served")}</th>
                <th className="font-medium">{t("drt.wait")}</th>
              </tr>
            </thead>
            <tbody>
              {day.hours.map((h) => (
                <tr key={h.start_s}>
                  <td>{`${String(Math.floor(h.start_s / 3600) % 24).padStart(2, "0")}:${String(Math.floor((h.start_s % 3600) / 60)).padStart(2, "0")}`}</td>
                  <td>{h.requests}</td>
                  <td>{h.served}</td>
                  <td>{h.served > 0 ? mins(h.mean_wait_s) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-slate-500">{t("drt.sim.method")}</p>
        </section>
      )}
      <p className="text-[11px] text-slate-500">
        {t("drt.method")}{" "}
        {t("kit.valuesFrom", {
          plugin: found?.plugin.name ?? t("drt.plugin"),
          context: found?.mode.label ?? doc.mode,
        })}{" "}
        {t("kit.keptHere")}
      </p>
    </div>
  );
  return panel ? createPortal(body, panel) : body;
}
