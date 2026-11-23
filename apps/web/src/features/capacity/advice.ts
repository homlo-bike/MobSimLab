/**
 * What to improve after the system test (Simulator → Test the system): for each rail line, the part of the
 * railway that limits it (a terminal's platforms or a track section) with advice when it is at or over the
 * recommended limit (UIC 406), trips that do not fit, delays that pile up; for every line, vehicles fuller
 * than their places; for each street line, delays that pile up. The thresholds are the test's own: the
 * verdicts (capacityText.ts), the places per vehicle (loads.ts) and the block length the kernel reports
 * (braking distance plus sighting distance); no new value is introduced here.
 */
import { clock } from "../journey-planner/format";
import type { Translate } from "../../i18n/i18n";
import type { EngineText } from "../../i18n/engine";
import type { Finding } from "../advice/Findings";
import type { LineState } from "./CapacityResults";
import { pct, perHour, practicalMaximum, secs, VERDICTS } from "./capacityText";
import type { LineLoad } from "./loads";
import type { StopPlaces } from "./crowdMap";
import type { Locate } from "./place";
import type { StreetLineResult } from "./streetRun";
import type { Point } from "./types";
import type { LonLat } from "../street-lines/types";

const count = (x: number) => new Intl.NumberFormat().format(Math.round(x));

/**
 * Purpose: rule-based advice on a bottleneck track section (Homlo's choice, no extra run). A platform track
 * or a switch area gets advice on stops or switches. On plain line with lineside signals (fixed block), a
 * section at least two blocks long gets a block signal at its middle: each half is then still a full block
 * (the train's braking distance at line speed plus the sighting distance), so the next train can follow
 * into the first half sooner. A shorter section is already as short as stopping allows. Under cab
 * signalling and on sight, signals do not set the spacing.
 * Output: the advice and, when the topology is at hand, where the new signal would stand.
 */
export function sectionAdvice(
  p: Point,
  t: Translate,
  locate: Locate | null,
): { advice: string; at?: LonLat } {
  const s = p.bottleneck_section;
  if (!s) return { advice: t("advice.cap.sectionFix") };
  const vars = {
    section: p.bottleneck,
    length: count(s.length_m),
    block: count(s.block_m),
    speed: count(s.speed_kmh),
  };
  if (s.kind === "platform") return { advice: t("advice.cap.sectionPlatform", vars) };
  if (s.kind === "switches") return { advice: t("advice.cap.sectionSwitches", vars) };
  if (s.kind === "on_sight" || s.protection === "line_of_sight")
    return { advice: t("advice.cap.sectionSight", vars) };
  if (s.protection !== "fixed_block") return { advice: t("advice.cap.sectionCab", vars) };
  if (s.length_m >= 2 * s.block_m) {
    // The middle of the section, on its longest piece.
    const mid = Math.min(s.to_m, Math.max(s.from_m, s.from_m + s.length_m / 2));
    const at = locate?.(s.track, mid) ?? undefined;
    return {
      advice: t("advice.cap.signalAdd", { ...vars, track: s.track, at: count(mid) }),
      ...(at ? { at } : {}),
    };
  }
  return { advice: t("advice.cap.signalShort", vars) };
}

/**
 * Purpose: the system test's findings with advice.
 * Inputs: the rail lines as shown (planned point and frequencies tried), the recommended limit, the
 * passenger loads by `rail:<id>` / `street:<index>`, the street lines' results, translators.
 * Output: unranked findings (FindingsList ranks them).
 */
export function capacityFindings(
  lines: readonly LineState[],
  limit: number,
  loads: Record<string, LineLoad>,
  streets: readonly StreetLineResult[],
  t: Translate,
  tx: (f: EngineText) => string = (f) => f.text,
  locate: Locate | null = null,
  places: StopPlaces = {},
): Finding[] {
  const out: Finding[] = [];
  const most = new Map<string, number>();
  for (const l of lines) {
    const p = l.planned;
    const name = l.info.name;
    const max = practicalMaximum([p, ...l.sweep]);
    if (max !== null) most.set(`rail:${l.info.id}`, max);
    const rank = VERDICTS[p.verdict].rank;
    if (p.problems.length && p.verdict === "not_enough_capacity" && p.unplaced <= 0) {
      out.push({
        key: `stopped:${l.info.id}`,
        severity: "problem",
        weight: 100,
        title: t("advice.cap.stopped", {
          line: name,
          problem: tx({ text: p.problems[0]!, msg: p.problem_msgs?.[0] }),
        }),
        advice: t("advice.cap.stoppedFix"),
      });
      continue;
    }
    if (p.unplaced > 0)
      out.push({
        key: `unplaced:${l.info.id}`,
        severity: "problem",
        weight: 90 + p.unplaced,
        title: t("advice.cap.unplaced", { line: name, n: p.unplaced }),
        advice: t("advice.cap.unplacedFix", { terminal: p.terminal }),
      });
    // The limiting part: at or over the recommended limit (near_limit and worse).
    if (rank >= 1 && p.unplaced <= 0) {
      const terminal = p.terminal_share > p.consumption;
      const share = Math.max(p.consumption, p.terminal_share);
      const vars = { line: name, share: pct(share), limit: pct(limit) };
      const sec = terminal ? { advice: t("advice.cap.terminalFix") } : sectionAdvice(p, t, locate);
      out.push({
        key: `part:${l.info.id}`,
        severity: rank >= 2 ? "problem" : "warning",
        weight: share * 100,
        title: terminal
          ? t("advice.cap.terminal", { ...vars, terminal: p.terminal })
          : t("advice.cap.section", { ...vars, section: p.bottleneck }),
        advice: [sec.advice, ...(rank === 1 ? [t("advice.cap.nearNote")] : [])].join(" "),
        ...(sec.at ? { at: sec.at } : {}),
      });
    }
    if (!p.stable && p.unplaced <= 0)
      out.push({
        key: `late:${l.info.id}`,
        severity: "problem",
        weight: 60 + p.residual_delay_s / 60,
        title: t("advice.cap.pileUp", { line: name, late: secs(p.residual_delay_s, t) }),
        advice: t("advice.cap.pileUpFix"),
      });
  }
  for (const [key, load] of Object.entries(loads)) {
    const b = load.busiest;
    if (!b || load.daily <= 0 || b.occupancy <= 1) continue;
    const n = most.get(key);
    const rail = lines.find((l) => `rail:${l.info.id}` === key);
    const now = rail ? rail.planned.per_hour : undefined;
    const [a, z] = [places[key]?.get(b.from), places[key]?.get(b.to)];
    out.push({
      ...(a && z ? { at: [(a[0] + z[0]) / 2, (a[1] + z[1]) / 2] as LonLat } : {}),
      key: `full:${key}`,
      severity: "problem",
      weight: 50 + Math.min(b.occupancy, 5) * 10,
      title: t("advice.cap.full", {
        line: load.name,
        share: Number.isFinite(b.occupancy) ? pct(b.occupancy) : "–",
        from: b.from,
        to: b.to,
        time: `${clock(b.hour_s)}–${clock(b.hour_s + 3600)}`,
      }),
      advice:
        n !== undefined && now !== undefined && n > now
          ? t("advice.cap.fullMore", { left: count(load.left_behind), n: perHour(n) })
          : t("advice.cap.fullLonger", { left: count(load.left_behind) }),
    });
  }
  for (const r of streets)
    if (!r.stable)
      out.push({
        key: `street:${r.index}`,
        severity: "problem",
        weight: 60 + r.residual_delay_s / 60,
        title: t("advice.cap.streetPileUp", { line: r.name, late: secs(r.residual_delay_s, t) }),
        advice: t("advice.cap.streetPileUpFix"),
      });
  return out;
}
