import { useI18n, withNodes } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/messages";
import { update } from "./doc";
import { COLORS, fmtM, fmtTime, LEVEL_LABEL, POWER } from "./modes";
import { field, input, levelOpts, ModeRow, Remove, Row, Section, Segmented } from "./panelControls";
import type { RailPanelProps as Props } from "./railPanelTypes";
import type { Power, StorageRole, Structure, Track, TrackElevation, TrackUse, TunnelMethod } from "./types";

const VERTEX: Record<string, MessageKey> = {
  leadstart: "rail.curve.outOfStart",
  lead_start: "rail.curve.outOfStart",
  leadend: "rail.curve.intoEnd",
  lead_end: "rail.curve.intoEnd",
};

/** Construction methods for a track's underground stretches (cost estimate), as message keys. */
const TUNNEL_OPTS: TunnelMethod[] = ["auto", "cut_and_cover", "tbm"];

/** Structures for a track's elevated stretches (cost estimate). */
const STRUCTURE_OPTS: Structure[] = ["auto", "elevated", "viaduct", "bridge"];

/** What trains stand on a storage track for. */
const STORAGE_ROLES: StorageRole[] = ["layover", "overnight", "both"];

export function TrackInspector({ t: track, doc, view, sel, actions: a }: Props & { t: Track }) {
  const { t: tr } = useI18n();
  const t = track;
  const tv = view.tracks.find((x) => x.id === t.id);
  const set = (f: (x: Track) => Track) => a.setDoc(update(doc, "tracks", t.id, f));
  const pi = sel?.pi !== undefined ? t.points[sel.pi] : undefined;
  return (
    <Section title={t.name || tr("rail.trackN", { id: t.id })}>
      <input
        aria-label={tr("rail.trackName")}
        placeholder={tr("rail.name")}
        value={t.name}
        onChange={(e) => set((x) => ({ ...x, name: e.target.value }))}
        className={field}
      />
      <ModeRow value={tv?.mode ?? t.mode ?? doc.mode} onChange={(m) => set((x) => ({ ...x, mode: m }))} />
      {tv && (
        <p className="text-xs text-slate-600">
          {fmtM(tv.length_m)} · {tv.tracks === 2 ? tr("rail.doubleTrack") : tr("rail.singleTrack")}
          {tv.speed &&
            ` · ${tr("rail.trackSpeed", { speed: Math.round(tv.speed.max_kmh), time: fmtTime(tv.speed.time_s) })}`}
        </p>
      )}
      <Segmented<1 | 2>
        label={tr("rail.tracks")}
        value={t.tracks}
        options={[
          { id: 1, label: tr("rail.single") },
          { id: 2, label: tr("rail.double") },
        ]}
        onChange={(tracks) => set((x) => ({ ...x, tracks }))}
      />
      <Segmented
        label={tr("rail.level")}
        value={t.level}
        options={levelOpts(tr)}
        onChange={(level) => set((x) => ({ ...x, level }))}
      />
      <Row label={tr("rail.electrification")}>
        <select
          value={t.power}
          onChange={(e) => set((x) => ({ ...x, power: e.target.value as Power }))}
          className={input}
        >
          {POWER.map((o) => (
            <option key={o.id} value={o.id}>
              {tr(o.label)}
            </option>
          ))}
        </select>
      </Row>
      <Row label={tr("rail.bed")}>
        <select
          value={t.bed}
          onChange={(e) => set((x) => ({ ...x, bed: e.target.value as Track["bed"] }))}
          className={input}
        >
          <option value="auto">{tr("rail.power.auto")}</option>
          <option value="ballast">{tr("rail.bed.ballast")}</option>
          <option value="embedded">{tr("rail.bed.embedded")}</option>
        </select>
      </Row>
      {tv?.levels.some((z) => z.level === "underground" || z.level === "underground2") && (
        <Row label={tr("rail.tunnel")}>
          <select
            aria-label={tr("rail.tunnel")}
            value={t.tunnel ?? "auto"}
            onChange={(e) => set((x) => ({ ...x, tunnel: e.target.value as TunnelMethod }))}
            className={input}
          >
            {TUNNEL_OPTS.map((o) => (
              <option key={o} value={o}>
                {tr(`rail.tunnel.${o}`)}
              </option>
            ))}
          </select>
        </Row>
      )}
      {tv?.levels.some((z) => z.level === "elevated" || z.level === "elevated2") && (
        <Row label={tr("rail.structure")}>
          <select
            aria-label={tr("rail.structure")}
            value={t.structure ?? "auto"}
            onChange={(e) => set((x) => ({ ...x, structure: e.target.value as Structure }))}
            className={input}
          >
            {STRUCTURE_OPTS.map((o) => (
              <option key={o} value={o}>
                {tr(`rail.structure.${o}`)}
              </option>
            ))}
          </select>
        </Row>
      )}
      <Segmented<TrackUse>
        label={tr("rail.use")}
        value={t.use}
        options={[
          { id: "running", label: tr("rail.running") },
          { id: "storage", label: tr("rail.storage") },
        ]}
        onChange={(use) => set((x) => ({ ...x, use }))}
      />
      {t.use === "storage" && (
        <Row label={tr("rail.storageRole")}>
          <select
            aria-label={tr("rail.storageRole")}
            value={t.storage_role ?? ""}
            onChange={(e) =>
              set((x) => ({ ...x, storage_role: (e.target.value || null) as StorageRole | null }))
            }
            className={input}
          >
            <option value="">{tr("rail.storageRole.auto")}</option>
            {STORAGE_ROLES.map((o) => (
              <option key={o} value={o}>
                {tr(`rail.storageRole.${o}`)}
              </option>
            ))}
          </select>
        </Row>
      )}
      {t.use === "storage" &&
        (doc.yards ?? [])
          .filter((y) => y.tracks.includes(t.id))
          .map((y) => (
            <p key={y.id} className="text-xs text-slate-600">
              {tr("rail.inYard", { name: y.name })}
            </p>
          ))}
      {pi && sel?.pi !== undefined && (
        <div className="flex flex-col gap-2 rounded border border-amber-300 bg-amber-50 p-2">
          <b>{tr("rail.pointN", { n: sel.pi + 1 })}</b>
          <Segmented
            label={tr("rail.pointLevel")}
            value={pi.level ?? t.level}
            options={levelOpts(tr)}
            onChange={(level) =>
              set((x) => ({ ...x, points: x.points.map((q, i) => (i === sel.pi ? { ...q, level } : q)) }))
            }
          />
          <Row label={tr("rail.radiusEmpty")}>
            <input
              type="number"
              aria-label={tr("rail.curveRadius")}
              value={pi.radius_m ?? ""}
              min={0}
              onChange={(e) => {
                const v = e.target.value === "" ? null : Math.max(1, Number(e.target.value));
                set((x) => ({
                  ...x,
                  points: x.points.map((q, i) => (i === sel.pi ? { ...q, radius_m: v } : q)),
                }));
              }}
              className="w-20 rounded border border-slate-300 px-1 py-0.5 text-end"
            />
          </Row>
          <button
            type="button"
            className="rounded border border-red-300 px-2 py-1 text-red-700"
            onClick={() => {
              set((x) => ({ ...x, points: x.points.filter((_, i) => i !== sel.pi) }));
              a.select({ id: t.id });
            }}
          >
            {tr("rail.removePoint")}
          </button>
        </div>
      )}
      {tv && tv.curves.length > 0 && (
        <table className="w-full text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="text-start">{tr("rail.curve")}</th>
              <th className="text-end">R</th>
              <th className="text-end">{tr("rail.transition")}</th>
              <th className="text-end">{tr("rail.cant")}</th>
              <th className="text-end">{tr("rail.speed")}</th>
            </tr>
          </thead>
          <tbody>
            {tv.curves.map((c, i) => (
              <tr
                key={i}
                className={c.pi !== null ? "cursor-pointer hover:bg-slate-100" : ""}
                onClick={() => c.pi !== null && a.select({ id: t.id, pi: c.pi })}
                style={{ color: c.radius_m < view.params.min_radius_m ? COLORS.error : undefined }}
              >
                <td>
                  {c.pi !== null
                    ? tr("rail.pointN", { n: c.pi + 1 })
                    : VERTEX[c.kind]
                      ? tr(VERTEX[c.kind]!)
                      : c.kind}
                </td>
                <td className="text-end font-mono">{Math.round(c.radius_m)} m</td>
                <td className="text-end font-mono">{Math.round(c.transition_m)} m</td>
                <td className="text-end font-mono">{Math.round(c.cant_mm)} mm</td>
                <td className="text-end font-mono">{Math.round(c.speed_kmh)} km/h</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {tv?.elevation ? (
        <ElevationProfile e={tv.elevation} />
      ) : (
        tv?.level_profile && tv.ramps.length > 0 && <LevelProfile pts={tv.level_profile} />
      )}
      {tv && tv.ramps.length > 0 && (
        <ul className="text-xs text-slate-600">
          {tv.ramps.map((r, i) => (
            <li key={i}>
              {tr("rail.ramp", {
                from: tr(LEVEL_LABEL[r.from]),
                to: tr(LEVEL_LABEL[r.to]),
                dh: r.dh_m.toFixed(1),
                length: fmtM(r.length_m),
              })}
              {r.gradient_permille !== undefined && ` · ${r.gradient_permille.toFixed(1)} ‰`}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-slate-500">{tr("rail.trackHint")}</p>
      <Remove what={tr("rail.deleteTrack")} onClick={() => a.remove(t.id)} />
    </Section>
  );
}

/**
 * Purpose: a track's vertical profile from its levels and ramps, relative to street level, while there are
 * no terrain heights: where the ramps are and how they climb.
 */
function LevelProfile({ pts }: { pts: [number, number][] }) {
  const { t } = useI18n();
  if (pts.length < 2) return null;
  const len = pts[pts.length - 1]![0] || 1;
  const hs = pts.map((p) => p[1]);
  const lo = Math.min(0, ...hs);
  const hi = Math.max(0, ...hs, lo + 1);
  const W = 260;
  const H = 70;
  const y = (h: number) => (H - 4 - ((h - lo) / (hi - lo)) * (H - 8)).toFixed(1);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${((p[0] / len) * W).toFixed(1)},${y(p[1])}`).join(" ");
  return (
    <div className="space-y-1">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[70px] w-full rounded bg-slate-50"
        role="img"
        aria-label={t("rail.levelProfileAria")}
      >
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="#a16207" strokeWidth={1} strokeDasharray="3 2" />
        <path d={d} fill="none" stroke="var(--diagram-ink, #1e293b)" strokeWidth={1.5} />
      </svg>
      <p className="text-[11px] text-slate-500">{t("rail.levelProfileNote")}</p>
    </div>
  );
}

/**
 * Purpose: a track's vertical profile from the terrain: the ground and the rail top along the track,
 * with its height range and steepest gradient.
 */
function ElevationProfile({ e }: { e: TrackElevation }) {
  const { t } = useI18n();
  const pts = e.profile;
  if (pts.length < 2) return null;
  const len = pts[pts.length - 1]![0] || 1;
  const zs = pts.flatMap((p) => [p[1], p[2]]);
  const lo = Math.min(...zs);
  const hi = Math.max(...zs, lo + 1);
  const W = 260;
  const H = 70;
  const line = (k: 1 | 2) =>
    pts
      .map(
        (p, i) =>
          `${i ? "L" : "M"}${((p[0] / len) * W).toFixed(1)},${(H - ((p[k] - lo) / (hi - lo)) * H).toFixed(1)}`,
      )
      .join(" ");
  const steep = Math.abs(e.steepest_permille);
  return (
    <div className="space-y-1">
      <p className="text-xs text-slate-600">
        {withNodes(
          t("rail.profileRange", {
            min: e.rail_min_m.toFixed(1),
            max: e.rail_max_m.toFixed(1),
            limit: e.max_permille,
          }),
          {
            steep: (
              <span className={steep > e.max_permille + 0.5 ? "font-semibold text-red-700" : undefined}>
                {steep.toFixed(1)} ‰
              </span>
            ),
          },
        )}
      </p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[70px] w-full rounded bg-slate-50"
        role="img"
        aria-label={t("rail.profileAria")}
      >
        <path d={line(1)} fill="none" stroke="#a16207" strokeWidth={1} strokeDasharray="3 2" />
        <path d={line(2)} fill="none" stroke="var(--diagram-ink, #1e293b)" strokeWidth={1.5} />
      </svg>
      <p className="text-[11px] text-slate-500">{t("rail.profileLegend")}</p>
    </div>
  );
}
