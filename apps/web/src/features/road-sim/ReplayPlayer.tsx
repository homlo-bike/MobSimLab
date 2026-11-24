/**
 * The replay player on the map (FR-SIM-06): play, pause, reset, speed and a time slider over a replay of
 * vehicles (replay.ts), with the legend of their colours. Used by the road simulation and the system test.
 */
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useI18n } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/messages";
import { engineErrorText } from "../../i18n/engine";
import { clock } from "../journey-planner/format";
import { VEHICLE_STATES, type VehicleState, type VehicleVisuals } from "../../workspace/preferences";
import { ensureReplayLayers, hasServiceTimes, removeReplayLayers, replaySpan, setReplayTime } from "./replay";
import type { Replay } from "./types";

const SPEEDS = [1, 10, 30, 60, 120, 300] as const;
const message = (e: unknown) => engineErrorText(e);

/**
 * Purpose: the replay of a finished run on the map, with play, pause, reset, speed and a time slider.
 * Inputs: `load` gives the replay (called again only when it changes), the map, the vehicle colours, and an
 * optional heading and note under the legend.
 */
export function ReplayPlayer({
  load,
  map,
  visuals,
  title,
  children,
}: {
  load: () => Promise<Replay>;
  map: MapLibreMap | null;
  visuals: VehicleVisuals;
  title?: string;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const [replay, setReplay] = useState<Replay | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(60);
  const last = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    load().then(
      (r) => {
        if (!live) return;
        setReplay(r);
        setTime(replaySpan(r)[0]);
      },
      (e: unknown) => live && setFailed(message(e)),
    );
    return () => {
      live = false;
    };
  }, [load]);

  useEffect(() => {
    if (!map || !replay) return;
    ensureReplayLayers(map);
    return () => removeReplayLayers(map);
  }, [map, replay]);

  useEffect(() => {
    if (map && replay && map.getSource("road-replay")) setReplayTime(map, replay, time, visuals);
  }, [map, replay, time, visuals]);

  useEffect(() => {
    if (!playing || !replay) return;
    const end = replaySpan(replay)[1];
    let raf = 0;
    const tick = (now: number) => {
      const dt = last.current === null ? 0 : (now - last.current) / 1000;
      last.current = now;
      let stop = false;
      setTime((x) => {
        const next = Math.min(end, x + dt * speed);
        if (next >= end) stop = true;
        return next;
      });
      if (stop) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      last.current = null;
    };
  }, [playing, replay, speed]);

  if (failed)
    return (
      <p role="alert" className="text-sm text-red-700">
        {t("road.replay.failed", { error: failed })}
      </p>
    );
  if (!replay) return <p className="text-sm text-slate-600">{t("road.replay.loading")}</p>;
  const [a, b] = replaySpan(replay);
  return (
    <section className="space-y-2 rounded-[10px] border border-slate-200 bg-white px-3 py-2 text-sm">
      <h3 className="caps">{title ?? t("road.replay")}</h3>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn" onClick={() => setPlaying((p) => !p)}>
          {playing ? t("road.pause") : t("road.play")}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setPlaying(false);
            setTime(a);
          }}
        >
          {t("road.reset")}
        </button>
        <label className="flex items-center gap-1">
          {t("road.speed")}
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="field">
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
        <span className="ms-auto tabular-nums" aria-live="off">
          {clock(time)}
        </span>
      </div>
      <input
        type="range"
        className="w-full"
        min={a}
        max={b}
        step={replay.frame_s}
        value={time}
        aria-label={t("road.time")}
        onChange={(e) => setTime(Number(e.target.value))}
      />
      <VehicleLegend visuals={visuals} />
      {!hasServiceTimes(replay) && <p className="text-xs text-slate-600">{t("road.replay.noService")}</p>}
      {children}
    </section>
  );
}

const STATE_LABEL = {
  on_time: "visuals.onTime",
  late: "visuals.late",
  very_late: "visuals.veryLate",
  out_of_service: "visuals.outOfService",
  parked: "visuals.parked",
} as const satisfies Record<VehicleState, MessageKey>;

/** Purpose: what each vehicle colour of the replay means, with the project's delays. */
function VehicleLegend({ visuals }: { visuals: VehicleVisuals }) {
  const { t } = useI18n();
  const text = (k: VehicleState) =>
    k === "on_time"
      ? t("visuals.legend.onTime", { min: visuals.on_time_min })
      : k === "late"
        ? t("visuals.legend.late", { from: visuals.on_time_min, to: visuals.late_min })
        : k === "very_late"
          ? t("visuals.legend.veryLate", { min: visuals.late_min })
          : t(STATE_LABEL[k]);
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-xs text-slate-700">
      {VEHICLE_STATES.map((k) => (
        <li key={k} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 rounded-full border border-white shadow-[0_0_0_1px_rgba(15,23,42,.25)]"
            style={{ background: visuals.colors[k] }}
          />
          {text(k)}
        </li>
      ))}
    </ul>
  );
}
