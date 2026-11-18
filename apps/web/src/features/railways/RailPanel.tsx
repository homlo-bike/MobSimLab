import { ObjectComments } from "../comments/Comments";
import { usePublishChecks } from "../../shell/checks";
import { hasMessage, type Translate, useI18n } from "../../i18n/i18n";
import { signalById } from "./doc";
import { field, input, levelOpts, Num, Row, Section, Segmented, Stat } from "./panelControls";
import { offeredModes, usePlannedModes } from "../../projects/plannedModes";
import { POWER, RAIL_MODES } from "./modes";
import {
  ChecksSection,
  DiamondSection,
  ExistingSection,
  LevelCrossingsSection,
  SignalsSection,
  StreetRunningSection,
} from "./RailNetworkSections";
import { SignalInspector, StationInspector, SwitchInspector } from "./RailInspectors";
import type { RailPanelProps as Props } from "./railPanelTypes";
import { ServiceLinesPanel } from "./ServiceLinesPanel";
import { TrackInspector } from "./TrackInspector";
import type { Power, RailMode, TrackUse } from "./types";

export type {
  NewStationOpts,
  NewSwitchOpts,
  NewTrackOpts,
  RailPanelActions,
  RailPanelProps,
  RailTool,
} from "./railPanelTypes";

/**
 * Purpose: the railway side panel, laid out like the railways tab of the mockup: mode and its
 * design values, settings for new elements, the inspector for the selection, and live checks.
 */
export function RailPanel(props: Props) {
  const { t } = useI18n();
  // Only the railway systems the project plans to use (Project preferences), and the one chosen now.
  const planned = usePlannedModes();
  const { doc, view, tool, sel, draft, actions: a } = props;
  const p = view.params;
  const kind = sel
    ? doc.stations.some((s) => s.id === sel.id)
      ? "station"
      : doc.tracks.some((t) => t.id === sel.id)
        ? "track"
        : doc.switches.some((s) => s.id === sel.id)
          ? "switch"
          : signalById(doc, sel.id, view.signals)
            ? "signal"
            : null
    : null;
  const issues = [...view.issues, ...(props.extraIssues ?? [])];
  // In a project the checks go to the notifications button in the top bar; on its own the panel lists them.
  const checksElsewhere = usePublishChecks("rail", t("checks.railway"), [
    ...(props.error ? [{ severity: "error" as const, text: props.error }] : []),
    ...issues.map((i) => ({
      severity: i.severity,
      text: i.text,
      ...(i.at || i.ref_id ? { onShow: () => a.showIssue(i.at, i.ref_id) } : {}),
    })),
  ]);

  return (
    <div className="flex flex-col gap-3 p-4 text-sm">
      <h2 className="text-xl font-semibold">{t("rail.title")}</h2>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-slate-600">{t("rail.modeForNew")}</span>
        <select value={doc.mode} onChange={(e) => a.setMode(e.target.value as RailMode)} className={field}>
          {offeredModes(RAIL_MODES, (m) => m.id, planned, doc.mode).map((m) => (
            <option key={m.id} value={m.id}>
              {t(m.label)}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-slate-600">
        {t("rail.params", {
          gauge: p.gauge_mm,
          centres: p.track_centre_m,
          minRadius: p.min_radius_m,
          radius: p.recommended_radius_m,
          gradient: p.max_gradient_permille,
          speed: p.design_speed_kmh,
          platform: p.platform_length_m,
          height: p.platform_height_mm,
          power: electrification(t, String(p.electrification)),
        })}
      </p>
      {/* The network's figures only while nothing is selected or being drawn. */}
      {!sel && !draft && (
        <div className="grid grid-cols-2 gap-2">
          <Stat value={`${view.counts.route_km.toFixed(2)} km`} label={t("rail.stat.route")} />
          <Stat value={`${view.counts.track_km.toFixed(2)} km`} label={t("rail.stat.track")} />
          <Stat value={String(doc.stations.length)} label={t("rail.stat.stations")} />
          <Stat value={String(doc.switches.length)} label={t("rail.stat.switches")} />
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={a.fit}
          className="flex-1 rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
        >
          {t("rail.zoomAll")}
        </button>
        <button
          type="button"
          onClick={a.clear}
          className="flex-1 rounded border border-slate-300 px-2 py-1 hover:bg-red-50"
        >
          {t("rail.clear")}
        </button>
      </div>

      {tool === "station" && (
        <Section title={t("rail.newStation")}>
          <Segmented
            label={t("rail.stationLevel")}
            value={props.stationOpts.level}
            options={levelOpts(t)}
            onChange={(level) => a.setStationOpts({ ...props.stationOpts, level })}
          />
          <Row label={t("rail.sidePlatforms")}>
            <Num
              label={t("rail.sidePlatforms")}
              unit=""
              value={props.stationOpts.sides}
              onChange={(sides) =>
                a.setStationOpts({ ...props.stationOpts, sides: Math.min(2, Math.round(sides)) })
              }
            />
          </Row>
          <Row label={t("rail.islandPlatforms")}>
            <Num
              label={t("rail.islandPlatforms")}
              unit=""
              value={props.stationOpts.islands}
              onChange={(islands) =>
                a.setStationOpts({ ...props.stationOpts, islands: Math.min(4, Math.round(islands)) })
              }
            />
          </Row>
        </Section>
      )}

      {(tool === "track" || draft) && (
        <Section title={draft ? t("rail.drawingTrack") : t("rail.newTrack")}>
          <Segmented<1 | 2>
            label={t("rail.tracks")}
            value={props.trackOpts.tracks}
            options={[
              { id: 1, label: t("rail.single") },
              { id: 2, label: t("rail.double") },
            ]}
            onChange={(tracks) => a.setTrackOpts({ ...props.trackOpts, tracks })}
          />
          <Segmented
            label={t("rail.level")}
            value={props.trackOpts.level}
            options={levelOpts(t)}
            onChange={(level) => a.setTrackOpts({ ...props.trackOpts, level })}
          />
          <Row label={t("rail.electrification")}>
            <select
              value={props.trackOpts.power}
              onChange={(e) => a.setTrackOpts({ ...props.trackOpts, power: e.target.value as Power })}
              className={input}
            >
              {POWER.map((o) => (
                <option key={o.id} value={o.id}>
                  {t(o.label)}
                </option>
              ))}
            </select>
          </Row>
          <Segmented<TrackUse>
            label={t("rail.use")}
            value={props.trackOpts.use}
            options={[
              { id: "running", label: t("rail.running") },
              { id: "storage", label: t("rail.storage") },
            ]}
            onChange={(use) => a.setTrackOpts({ ...props.trackOpts, use })}
          />
          {draft && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={a.finishDraft}
                className="flex-1 rounded bg-emerald-800 px-2 py-1 text-white"
              >
                {t("rail.finish")}
              </button>
              <button
                type="button"
                onClick={a.cancelDraft}
                className="flex-1 rounded border border-slate-300 px-2 py-1"
              >
                {t("rail.cancel")}
              </button>
            </div>
          )}
        </Section>
      )}

      {(tool === "turnout" || tool === "crossover") && (
        <Section title={tool === "turnout" ? t("rail.newTurnout") : t("rail.newCrossover")}>
          <Row label={t("rail.element")}>
            <select
              value={props.switchOpts.element ?? p.default_turnout}
              onChange={(e) => a.setSwitchOpts({ ...props.switchOpts, element: e.target.value })}
              className={input}
            >
              {view.turnouts.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Row>
          {tool === "turnout" ? (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={props.switchOpts.junction}
                onChange={(e) => a.setSwitchOpts({ ...props.switchOpts, junction: e.target.checked })}
              />
              {t("rail.doubleJunction")}
            </label>
          ) : (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={props.switchOpts.scissors}
                onChange={(e) => a.setSwitchOpts({ ...props.switchOpts, scissors: e.target.checked })}
              />
              {t("rail.scissors")}
            </label>
          )}
        </Section>
      )}

      {kind === "station" && sel && (
        <StationInspector st={doc.stations.find((s) => s.id === sel.id)!} {...props} />
      )}
      {kind === "track" && sel && <TrackInspector t={doc.tracks.find((s) => s.id === sel.id)!} {...props} />}
      {kind === "switch" && sel && (
        <SwitchInspector sw={doc.switches.find((s) => s.id === sel.id)!} {...props} />
      )}
      {kind === "signal" && sel && <SignalInspector sg={signalById(doc, sel.id, view.signals)!} {...props} />}
      {/* Generated signals get new ids when the design changes, so only the planner's own carry comments. */}
      {kind && sel && (kind !== "signal" || doc.signals?.some((s) => s.id === sel.id)) && (
        <ObjectComments type={kind} id={sel.id} />
      )}

      <ServiceLinesPanel doc={doc} view={view} setDoc={a.setDoc} show={a.showIssue} {...props.service} />

      <SignalsSection view={view} actions={a} />

      {props.existingRailways && <ExistingSection view={view} actions={a} />}

      <DiamondSection doc={props.doc} view={view} actions={a} />

      <StreetRunningSection view={view} actions={a} />

      <LevelCrossingsSection view={view} streetNote={props.streetNote} actions={a} />

      {props.terrainError && (
        <div role="status" className="flex flex-wrap items-center gap-2 text-xs text-amber-800">
          <p>{t("rail.terrainFailed", { reason: props.terrainError })}</p>
          {props.onRetryTerrain && (
            <button type="button" className="btn" onClick={props.onRetryTerrain}>
              {t("save.retry")}
            </button>
          )}
        </div>
      )}

      {checksElsewhere ? (
        props.error && <p className="text-red-700">{props.error}</p>
      ) : (
        <ChecksSection view={view} issues={issues} error={props.error} actions={a} />
      )}
    </div>
  );
}

/** Purpose: the electrification of a mode in words ("overhead", "third rail"), else the engine's id. */
function electrification(t: Translate, id: string): string {
  const key = `rail.power.${id}`;
  return hasMessage(key) ? t(key).toLowerCase() : id.replace("_", " ");
}
