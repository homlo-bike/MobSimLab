import { type Translate, type TranslatePlural, useI18n } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/messages";
import { COLORS, fmtM } from "./modes";
import { Section } from "./panelControls";
import type { RailPanelActions } from "./railPanelTypes";
import type { IssueView, LonLat, Network, RailView, Severity, SignalKind, Slip, SwitchKind } from "./types";

const CHIP: Record<Severity, string> = {
  ok: COLORS.ok,
  info: COLORS.info,
  warning: COLORS.warn,
  error: COLORS.error,
};

/** Who uses a path crossing the track, for the level crossing list. */
const PATH_USERS = {
  foot: "rail.pathUsers.foot",
  cycle: "rail.pathUsers.cycle",
  foot_cycle: "rail.pathUsers.foot_cycle",
} as const satisfies Record<string, MessageKey>;

/** How a level crossing is protected, for the level crossing list. */
const PROTECTION = {
  barriers: "rail.barriers",
  traffic_signals: "rail.trafficSignals",
  path_gates: "rail.gates",
  marked: "rail.markedCrossing",
} as const satisfies Record<string, MessageKey>;

/** Each kind of switch in the switch list. */
const SWITCH_KIND = {
  turnout: "rail.tool.turnout",
  double_junction: "rail.kind.doubleJunction",
  crossover: "rail.tool.crossover",
  scissors: "rail.scissors",
} as const satisfies Record<SwitchKind, MessageKey>;

/** Purpose: the point at a chainage (m) along a centre line of longitude and latitude; null for an empty line. */
export function pointAlong(line: readonly LonLat[], s: number): LonLat | null {
  const first = line[0];
  if (!first) return null;
  const R = 6_371_000;
  let done = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
    const d = Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * ((Math.PI / 180) * R);
    if (d > 0 && done + d >= s) {
      const f = Math.max(0, (s - done) / d);
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }
    done += d;
  }
  return line[line.length - 1]!;
}

/**
 * Purpose: every switch of the drawing (turnouts, double junctions, crossovers) with its track and position,
 * so a switch can be picked from the panel; a click selects it and shows it on the map.
 */
export function SwitchesSection({
  doc,
  view,
  selected,
  actions: a,
}: {
  doc: Network;
  view: RailView;
  selected: number | null;
  actions: RailPanelActions;
}) {
  const { t } = useI18n();
  const list = [...doc.switches].sort((x, y) => x.track - y.track || x.s - y.s);
  return (
    <Section title={list.length ? `${t("rail.switches")} · ${list.length}` : t("rail.switches")}>
      {list.length === 0 ? (
        <p className="text-xs text-slate-600">{t("rail.switchesNone")}</p>
      ) : (
        <ul className="flex max-h-60 flex-col gap-0.5 overflow-y-auto" aria-label={t("rail.switches")}>
          {list.map((sw) => {
            const track = doc.tracks.find((x) => x.id === sw.track);
            const centre = view.tracks.find((x) => x.id === sw.track)?.centre ?? [];
            const sv = view.switches.find((x) => x.id === sw.id);
            const at = pointAlong(centre, sv?.s0 ?? sw.s);
            return (
              <li key={sw.id}>
                <button
                  type="button"
                  aria-current={selected === sw.id ? "true" : undefined}
                  onClick={() => a.showIssue(at, sw.id)}
                  className={`flex w-full items-start gap-2 rounded px-1 py-0.5 text-start hover:bg-slate-100 ${
                    selected === sw.id ? "bg-blue-50 font-medium" : ""
                  }`}
                >
                  <span className="font-mono text-xs text-slate-500">{sw.id}</span>
                  <span>
                    {t("rail.switchItem", {
                      kind: t(SWITCH_KIND[sw.kind]),
                      track: track?.name || t("rail.trackN", { id: sw.track }),
                      at: fmtM(sw.s),
                    })}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

/** Purpose: counts of the plan's signals by kind, for the panel. */
function signalSummary(tn: TranslatePlural, list: RailView["signals"]): string {
  const n = (k: SignalKind) => list.filter((s) => s.kind === k).length;
  const markers = list.filter((s) => !s.lineside).length;
  const parts = [
    tn("rail.count.main", n("main")),
    tn("rail.count.block", n("block") - markers),
    markers ? tn("rail.count.markers", markers) : "",
    n("shunting") ? tn("rail.count.shunting", n("shunting")) : "",
    n("distant") ? tn("rail.count.distant", n("distant")) : "",
    n("speed") ? tn("rail.count.speed", n("speed")) : "",
    n("speed_warning") ? tn("rail.count.speedWarning", n("speed_warning")) : "",
  ];
  return parts.filter(Boolean).join(" · ");
}

/** Purpose: the planner's changes to the generated signals in a sentence. */
function signalEdits(t: Translate, tn: TranslatePlural, view: RailView): string {
  const own = view.signals.filter((s) => !s.auto).length;
  const parts = [
    own ? tn("rail.edits.own", own) : "",
    view.signals_removed ? tn("rail.edits.removed", view.signals_removed) : "",
  ].filter(Boolean);
  return parts.length ? t("rail.edits", { list: parts.join(", ") }) : "";
}

/** Purpose: the plan's signals by kind, the planner's changes, and resetting them. */
export function SignalsSection({ view, actions: a }: { view: RailView; actions: RailPanelActions }) {
  const { t, tn } = useI18n();
  return (
    <Section
      title={view.signals.length ? `${t("rail.signals")} · ${view.signals.length}` : t("rail.signals")}
    >
      <p className="text-xs text-slate-600">
        {view.signals.length
          ? t("rail.signalsSome", { summary: signalSummary(tn, view.signals) })
          : t("rail.signalsNone")}
      </p>
      {view.signals_edited && (
        <>
          <p className="text-xs text-slate-600">{signalEdits(t, tn, view)}</p>
          <button
            type="button"
            onClick={a.resetSignals}
            className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
          >
            {t("rail.resetSignals")}
          </button>
        </>
      )}
    </Section>
  );
}

/** Purpose: joins of the drawn tracks to existing railways from OpenStreetMap. */
export function ExistingSection({ view, actions: a }: { view: RailView; actions: RailPanelActions }) {
  const { t, tn } = useI18n();
  return (
    <Section title={`${t("rail.existing")} · ${tn("rail.joins", view.existing_joins.length)}`}>
      <p className="text-xs text-slate-600">{t("rail.existingNote", { count: view.existing_count })}</p>
      <ul className="flex flex-col gap-1">
        {view.existing_joins.map((j) => (
          <li key={`${j.track}-${j.end}`}>
            <button
              type="button"
              onClick={() => a.showIssue(j.lonlat, j.track)}
              className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-start hover:bg-slate-100"
            >
              <span style={{ color: COLORS.existing }}>●</span>
              <span>
                {j.name || t("rail.unnamedRailway")} · {j.railway.replace("_", " ")} ·{" "}
                {j.continues ? t("rail.continues") : t("rail.newTurnoutExisting")}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Purpose: the stretches where trams run in the street. */
export function StreetRunningSection({ view, actions: a }: { view: RailView; actions: RailPanelActions }) {
  const { t, tn } = useI18n();
  return (
    <Section title={`${t("rail.streetRunning")} · ${view.street_running.length}`}>
      <p className="text-xs text-slate-600">{t("rail.streetRunningNote")}</p>
      <ul className="flex flex-col gap-1">
        {view.street_running.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => a.showIssue(r.lonlat, r.track)}
              className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-start hover:bg-slate-100"
            >
              <span style={{ color: r.running === "mixed" ? COLORS.warn : COLORS.info }}>
                {r.running === "mixed" ? "▲" : "●"}
              </span>
              <span>
                {r.street || t("rail.unnamedStreet")} · {fmtM(r.length_m)} ·{" "}
                {r.running === "reserved"
                  ? t("rail.ownLane")
                  : r.running === "mixed"
                    ? t("rail.inTraffic")
                    : t("rail.pedestrianZone")}{" "}
                · {Math.round(r.speed_limit_kmh)} km/h
                {r.bus ? ` · ${t("rail.buses")}` : ""}
                {r.stops.length ? ` · ${tn("rail.stops", r.stops.length)}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Purpose: the level crossings with streets and paths. */
export function LevelCrossingsSection({
  view,
  streetNote,
  actions: a,
}: {
  view: RailView;
  streetNote?: string | null;
  actions: RailPanelActions;
}) {
  const { t } = useI18n();
  return (
    <Section title={`${t("rail.levelCrossings")} · ${view.level_crossings.length}`}>
      <p className="text-xs text-slate-600">{t("rail.levelCrossingsNote")}</p>
      {streetNote && <p className="text-xs text-amber-800">{streetNote}</p>}
      <ul className="flex flex-col gap-1">
        {view.level_crossings.map((x) => (
          <li key={x.id}>
            <button
              type="button"
              onClick={() => a.showIssue(x.lonlat, x.track)}
              className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-start hover:bg-slate-100"
            >
              <span style={{ color: x.standard ? COLORS.info : COLORS.warn }}>{x.standard ? "●" : "▲"}</span>
              <span>
                {x.street || (x.path ? t("rail.unnamedPath") : t("rail.unnamedStreet"))} ·{" "}
                {Math.round(x.angle_deg)}° · {x.path ? `${t(PATH_USERS[x.path])} · ` : ""}
                {t(PROTECTION[x.protection])}
                {x.bus ? ` · ${t("rail.buses")}` : ""}
                {x.trolley_wire ? ` · ${t("rail.trolleyWire")}` : ""}
                {x.standard ? "" : ` · ${t("rail.specialSafety")}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Purpose: the design's live checks and the plugins' checks. */
export function ChecksSection({
  view,
  issues,
  error,
  actions: a,
}: {
  view: RailView;
  issues: IssueView[];
  error: string | null;
  actions: RailPanelActions;
}) {
  const { t, tn } = useI18n();
  return (
    <Section
      title={`${t("rail.checks")} · ${tn("rail.errors", view.counts.errors)} · ${tn("rail.warnings", view.counts.warnings)}`}
    >
      {error && <p className="text-red-700">{error}</p>}
      <ul className="flex flex-col gap-1">
        {issues.map((i, n) => (
          <li key={n}>
            <button
              type="button"
              disabled={!i.at && !i.ref_id}
              onClick={() => a.showIssue(i.at, i.ref_id)}
              className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-start hover:bg-slate-100 disabled:hover:bg-transparent"
            >
              <span
                className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                style={{ background: CHIP[i.severity] }}
                aria-label={t(`severity.${i.severity}`)}
              />
              <span>{i.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * Purpose: the same-level crossings of two alignments. A diamond of two single tracks can be made a
 * single or double slip from the catalogue, so trains can also turn from one track to the other.
 */
export function DiamondSection({
  doc,
  view,
  actions: a,
}: {
  doc: Network;
  view: RailView;
  actions: RailPanelActions;
}) {
  const { t } = useI18n();
  const diamonds = view.crossings.filter((c) => c.kind === "diamond");
  if (!diamonds.length) return null;
  const slips = doc.slips ?? [];
  const setSlip = (crossing: string, slip: Slip | null) =>
    a.setDoc({
      ...doc,
      slips: [...slips.filter((s) => s.crossing !== crossing), ...(slip ? [slip] : [])],
    });
  return (
    <Section title={`${t("rail.diamonds")} · ${diamonds.length}`}>
      <p className="text-xs text-slate-600">{t("rail.diamondsNote")}</p>
      <ul className="flex flex-col gap-2">
        {diamonds.map((c) => {
          const slip = slips.find((s) => s.crossing === c.id) ?? null;
          const built = view.slips.find((s) => s.crossing === c.id);
          const spec = view.slip_elements.find((e) => e.id === slip?.element);
          return (
            <li key={c.id} className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => a.showIssue(c.lonlat, c.tracks[0])}
                className="rounded px-1 py-0.5 text-start hover:bg-slate-100"
              >
                {t("rail.diamondTracks", {
                  a: c.tracks[0],
                  b: c.tracks[1],
                  angle: c.angle_deg.toFixed(1),
                  ratio: c.ratio_n.toFixed(1),
                })}
                {built ? (built.ok ? ` · ${t("rail.slipBuilt")}` : ` · ${t("rail.slipNotPossible")}`) : ""}
              </button>
              {c.single_tracks && (
                <label className="flex items-center gap-2 px-1 text-xs">
                  <span>{t("rail.trackwork")}</span>
                  <select
                    aria-label={t("rail.trackworkAt", { id: c.id })}
                    className="flex-1 rounded border border-slate-300 px-1 py-0.5"
                    value={slip?.element ?? ""}
                    onChange={(e) =>
                      setSlip(
                        c.id,
                        e.target.value ? { crossing: c.id, element: e.target.value, side: 0 } : null,
                      )
                    }
                  >
                    <option value="">{t("rail.diamond")}</option>
                    {view.slip_elements.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {slip && spec?.element === "single_slip" && (
                <button
                  type="button"
                  className="btn btn-ghost self-start px-1 text-xs"
                  onClick={() => setSlip(c.id, { ...slip, side: slip.side === 1 ? 0 : 1 })}
                >
                  {t("rail.turnSlip")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
