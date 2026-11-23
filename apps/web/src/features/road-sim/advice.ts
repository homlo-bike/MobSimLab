/**
 * What to improve after a road run (Simulator → Road simulation): each street line that keeps badly to
 * time, bunches or runs out of charge, the vehicles that got stuck or did not get back, and the places where
 * the lines lost the most time, each with advice. A line is flagged from `road.advice_on_time_share` and
 * `road.advice_bunched_share` (assumption library); the places are ranked by the minutes lost there.
 */
import type { Translate } from "../../i18n/i18n";
import type { PreferencesDoc } from "../../workspace/preferences";
import type { Finding } from "../advice/Findings";
import { central } from "./params";
import type { RoadHotspot, RoadResult } from "./types";

/** Places with lost time shown as findings, most lost first. */
const PLACES_SHOWN = 5;

const pct = (x: number) => `${Math.round(x * 100)} %`;
const min = (s: number) => (s < 600 ? (s / 60).toFixed(1) : String(Math.round(s / 60)));

/** Purpose: the place's name for a sentence: the street, or "a junction" / "a street" when OSM names none. */
function placeName(h: RoadHotspot, t: Translate): string {
  if (h.name) return h.name;
  return t(h.kind === "junction" ? "advice.road.unnamedJunction" : "advice.road.unnamedStreet");
}

/**
 * Purpose: the road run's findings with advice.
 * Inputs: the run's result, the project's values (for the thresholds), the translator.
 * Output: unranked findings (FindingsList ranks them).
 */
export function roadFindings(
  result: RoadResult,
  prefs: PreferencesDoc["values"] | undefined,
  t: Translate,
): Finding[] {
  const out: Finding[] = [];
  const names = new Map(result.lines.map((l) => [l.index, l.name]));
  const spots = result.hotspots ?? [];
  for (const l of result.lines) {
    if (l.problem) {
      out.push({
        key: `cannot:${l.index}`,
        severity: "problem",
        weight: 100,
        title: t("advice.road.cannotRun", { line: l.name }),
        advice: t("advice.road.cannotRunFix", { problem: l.problem }),
      });
      continue;
    }
    if ((l.trips_run ?? 0) === 0) continue;
    const onTime = l.punctuality ?? 1;
    const onTimeLimit = central("road.advice_on_time_share", l.mode, prefs);
    if (onTime < onTimeLimit) {
      const signals = l.lost_signals_s ?? 0;
      const traffic = l.lost_traffic_s ?? 0;
      const parts = [
        signals > traffic
          ? t("advice.road.mostlySignals", { signals: min(signals), traffic: min(traffic) })
          : t("advice.road.mostlyTraffic", { signals: min(signals), traffic: min(traffic) }),
      ];
      const planned = l.planned_run_s ?? 0;
      const run = l.run_cycle_s ?? 0;
      if (planned > 0 && run > planned)
        parts.push(t("advice.road.moreTime", { run: min(run), planned: min(planned) }));
      out.push({
        key: `late:${l.index}`,
        severity: onTime < onTimeLimit - 0.15 ? "problem" : "warning",
        weight: (onTimeLimit - onTime) * 100,
        title: t("advice.road.late", { line: l.name, share: pct(onTime), limit: pct(onTimeLimit) }),
        advice: parts.join(" "),
      });
    }
    const bunched = l.bunched_share ?? 0;
    const bunchLimit = central("road.advice_bunched_share", l.mode, prefs);
    if (bunched > bunchLimit)
      out.push({
        key: `bunch:${l.index}`,
        severity: "warning",
        weight: (bunched - bunchLimit) * 100,
        title: t("advice.road.bunched", { line: l.name, share: pct(bunched) }),
        advice: t("advice.road.bunchedFix"),
      });
    const e = l.energy_use;
    if (e && e.ran_out > 0)
      out.push({
        key: `charge:${l.index}`,
        severity: "problem",
        weight: 50 + e.ran_out,
        title: t("advice.road.ranOut", { line: l.name, n: e.ran_out }),
        advice: t("advice.road.ranOutFix"),
      });
  }
  const stuck = new Map<number, { n: number; at: RoadHotspot["lonlat"] | null }>();
  const notBack = new Map<number, number>();
  for (const ev of result.events) {
    if (ev.kind === "gridlock") {
      const s = stuck.get(ev.line) ?? { n: 0, at: ev.lonlat };
      s.n += 1;
      stuck.set(ev.line, s);
    } else if (ev.kind === "not_back") notBack.set(ev.line, (notBack.get(ev.line) ?? 0) + 1);
  }
  for (const [line, s] of stuck)
    out.push({
      key: `stuck:${line}`,
      severity: "problem",
      weight: 40 + s.n,
      title: t("advice.road.stuck", { line: names.get(line) ?? "", n: s.n }),
      advice: t("advice.road.stuckFix"),
      ...(s.at ? { at: s.at } : {}),
    });
  for (const [line, n] of notBack)
    out.push({
      key: `back:${line}`,
      severity: "warning",
      weight: 30 + n,
      title: t("advice.road.notBack", { line: names.get(line) ?? "", n }),
      advice: t("advice.road.notBackFix"),
    });
  spots.slice(0, PLACES_SHOWN).forEach((h, i) => {
    const lines = h.lines
      .map((x) => names.get(x) ?? "")
      .filter(Boolean)
      .join(", ");
    const vars = { place: placeName(h, t), min: min(h.lost_s), lines };
    out.push({
      key: `spot:${i}`,
      severity: "warning",
      // Places come after the lines' own findings of the same severity, most lost first.
      weight: 10 - i,
      title: t(`advice.road.spot.${h.kind}`, vars),
      advice: t(`advice.road.spot.${h.kind}Fix`),
      at: h.lonlat,
    });
  });
  return out;
}
