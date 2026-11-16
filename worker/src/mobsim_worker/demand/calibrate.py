"""Calibration of the demand model to observed data (09 §2.3).

The planner gives what was observed, in tables or as CSV in the Demand section: the share of trips by mode,
the mean length of a car trip, and weekday boardings of lines and stops. The run repeats the whole model, at
most ``demand.calibration.max_iterations`` times:

- the mode constants (``demand.mode.asc.*``, relative to car) move by ``ln(observed share / modelled share)``,
  damped by ``demand.calibration.damping``; without observed shares, the public transport constant moves by
  the ratio of observed to modelled boardings on the counted lines and stops;
- the exponential terms of every purpose's deterrence (``demand.deterrence.*.exponential``) scale by the ratio
  of modelled to observed mean car trip length, damped the same way;

until every share and the trip length are within ``demand.calibration.tolerance`` (relative). The result says
how well the last round fits: observed and modelled shares, each count with its GEH (counts spread over
``demand.calibration.geh_hours`` hours, as GEH is meant for hourly flows), the %RMSE of the counts, and the
fitted values the planner can save to Project preferences.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from typing import TYPE_CHECKING, Any

from mobsim_worker.demand.inputs import MODES, PURPOSES, Bundle, InputError, Values

if TYPE_CHECKING:
    from mobsim_worker.demand.model import Outcome, RunFile

#: Largest number of observed counts a run takes.
MAX_COUNTS = 5000
ASC = {"transit": "demand.mode.asc.transit", "walk": "demand.mode.asc.walk", "cycle": "demand.mode.asc.cycle"}


@dataclass
class Count:
    """Observed weekday boardings of a line or a stop, by id or name."""

    kind: str  # "line" or "stop"
    id: str
    value: float


@dataclass
class Observed:
    """What the planner observed."""

    mode_shares: dict[str, float] | None = None
    mean_car_km: float | None = None
    counts: list[Count] = field(default_factory=list)

    def any(self) -> bool:
        """Whether there is anything to calibrate to or compare with."""
        return bool(self.mode_shares or self.mean_car_km or self.counts)


def parse_observed(raw: Any) -> Observed | None:
    """Read ``{"mode_shares": {mode: share}, "mean_car_km": km, "counts": [{"kind", "id", "value"}]}``.

    Shares may be fractions or percentages; they are scaled to add up to 1.

    Raises:
        InputError: Something is not in that form.
    """
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise InputError("the observed data are not in the expected form")
    shares = raw.get("mode_shares")
    out = Observed()
    if shares:
        if not isinstance(shares, dict) or set(shares) - set(MODES):
            raise InputError(f"observed mode shares must be given for {', '.join(MODES)}")
        vals = {}
        for m, v in shares.items():
            if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) or v < 0:
                raise InputError(f"the observed share of {m} must be a number of at least 0")
            vals[m] = float(v)
        total = sum(vals.values())
        if total <= 0:
            raise InputError("the observed mode shares add up to 0")
        out.mode_shares = {m: vals.get(m, 0.0) / total for m in MODES}
    km = raw.get("mean_car_km")
    if km is not None:
        if not isinstance(km, (int, float)) or isinstance(km, bool) or not (0 < km < 1000):
            raise InputError("the observed mean car trip must be a length in km above 0")
        out.mean_car_km = float(km)
    counts = raw.get("counts") or []
    if not isinstance(counts, list) or len(counts) > MAX_COUNTS:
        raise InputError(f"at most {MAX_COUNTS} observed counts can be used")
    for i, c in enumerate(counts):
        if not isinstance(c, dict) or c.get("kind") not in ("line", "stop"):
            raise InputError(f"observed count {i + 1} must be of a line or a stop")
        v = c.get("value")
        if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) or v < 0:
            raise InputError(f"observed count {i + 1} must be a number of at least 0")
        out.counts.append(Count(kind=str(c["kind"]), id=str(c.get("id") or ""), value=float(v)))
    return out if out.any() else None


def _norm(s: str) -> str:
    return " ".join(s.lower().split())


def modelled_count(result: dict[str, Any], c: Count) -> float | None:
    """Modelled weekday boardings of a counted line or stop (by id, else by name); None if it is not there."""
    t = result["transit"]
    key = _norm(c.id)
    if c.kind == "line":
        hits = [ln for ln in t["lines"] if ln["id"] == c.id] or [
            ln for ln in t["lines"] if _norm(ln["name"]) == key
        ]
        if not hits:
            return None
        return float(sum(sum(p["boardings"]["day"]) for ln in hits for p in ln["patterns"]))
    if c.id in t["stops"]:
        return float(t["stops"][c.id]["boardings"])
    named = [s for s in t["stops"].values() if _norm(s["name"]) == key]
    return float(sum(s["boardings"] for s in named)) if named else None


def geh(modelled: float, observed: float) -> float:
    """The GEH statistic of two hourly flows."""
    s = modelled + observed
    return math.sqrt(2.0 * (modelled - observed) ** 2 / s) if s > 0 else 0.0


def fit(result: dict[str, Any], obs: Observed, values: Values) -> dict[str, Any]:
    """How well a result fits the observed data."""
    t = result["totals"]
    total = max(float(t["trips"]), 1e-9)
    shares = {m: float(t["by_mode"][m]) / total for m in MODES}
    hours = max(values["demand.calibration.geh_hours"], 1e-6)
    counts = []
    sq = 0.0
    obs_sum = 0.0
    n = 0
    under5 = 0
    for c in obs.counts:
        m = modelled_count(result, c)
        row: dict[str, Any] = {"kind": c.kind, "id": c.id, "observed": c.value, "modelled": None, "geh": None}
        if m is not None:
            g = geh(m / hours, c.value / hours)
            row["modelled"] = round(m, 1)
            row["geh"] = round(g, 2)
            sq += (m - c.value) ** 2
            obs_sum += c.value
            n += 1
            under5 += g < 5
        counts.append(row)
    rmse = math.sqrt(sq / n) / (obs_sum / n) * 100 if n and obs_sum > 0 else None
    return {
        "mode_shares": {
            m: {
                "observed": None if obs.mode_shares is None else round(obs.mode_shares[m], 4),
                "modelled": round(shares[m], 4),
            }
            for m in MODES
        },
        "mean_car_km": {"observed": obs.mean_car_km, "modelled": t.get("car_km")},
        "counts": counts,
        "matched": n,
        "rmse_pct": None if rmse is None else round(rmse, 1),
        "geh_under_5_share": round(under5 / n, 3) if n else None,
    }


def adjust(
    values: dict[str, float], f: dict[str, Any], obs: Observed, damping: float
) -> tuple[dict[str, float], float]:
    """New mode constants and deterrence from one round's fit; the largest relative gap that is left."""
    out = dict(values)
    gaps = [0.0]
    if obs.mode_shares:
        sh = f["mode_shares"]
        car_o, car_m = sh["car"]["observed"], sh["car"]["modelled"]
        for m, key in ASC.items():
            o, mod = sh[m]["observed"], sh[m]["modelled"]
            if o > 0 and mod > 0 and car_o > 0 and car_m > 0:
                out[key] = values[key] + damping * (math.log(o / mod) - math.log(car_o / car_m))
            if o > 0 or mod > 0:
                gaps.append(abs(mod - o) / max(o, 1e-3))
    elif f["matched"]:
        o = sum(c["observed"] for c in f["counts"] if c["modelled"] is not None)
        mod = sum(c["modelled"] for c in f["counts"] if c["modelled"] is not None)
        if o > 0 and mod > 0:
            out[ASC["transit"]] = values[ASC["transit"]] + damping * math.log(o / mod)
            gaps.append(abs(mod - o) / o)
    km_o, km_m = obs.mean_car_km, f["mean_car_km"]["modelled"]
    if km_o and km_m:
        ratio = (km_m / km_o) ** damping
        for p in PURPOSES:
            key = f"demand.deterrence.{p}.exponential"
            c = values[key] if values[key] < 0 else -0.01
            out[key] = c * ratio
        gaps.append(abs(km_m - km_o) / km_o)
    return out, max(gaps)


def calibrate(bundle: Bundle, reporter: Any, obs: Observed) -> tuple[Outcome, dict[str, Any], list[RunFile]]:
    """Run the model until it fits the observed data or the round limit; the last run's outcome and files."""
    from mobsim_worker.demand.model import DemandModel  # noqa: PLC0415

    v = bundle.values
    rounds = max(1, int(v["demand.calibration.max_iterations"]))
    damping = min(max(v["demand.calibration.damping"], 0.05), 1.0)
    tol = max(v["demand.calibration.tolerance"], 1e-6)
    fits_target = bool(obs.mode_shares or obs.mean_car_km or obs.counts)
    current = dict(v.values)
    history: list[dict[str, Any]] = []
    outcome: Outcome = "done"
    result: dict[str, Any] = {}
    files: list[RunFile] = []
    for k in range(1, rounds + 1):
        b = replace(bundle, values=Values(current), notes=list(bundle.notes))
        outcome, result, files = DemandModel(b, _Round(reporter, k, rounds)).run()
        if outcome != "done":
            return outcome, result, files
        f = fit(result, obs, b.values)
        new, gap = adjust(current, f, obs, damping)
        history.append(
            {
                "round": k,
                "gap": round(gap, 4),
                "rmse_pct": f["rmse_pct"],
                "shares": {m: f["mode_shares"][m]["modelled"] for m in MODES},
                "mean_car_km": f["mean_car_km"]["modelled"],
            }
        )
        if gap <= tol or k == rounds or not fits_target:
            if gap > tol and fits_target:
                result["notes"].append(
                    f"calibration stopped after {k} rounds {gap:.1%} away from the observed data"
                )
            changed = {
                key: round(current[key], 4)
                for key in (*ASC.values(), *(f"demand.deterrence.{p}.exponential" for p in PURPOSES))
                if abs(current[key] - v.values[key]) > 1e-9
            }
            result["uncalibrated"] = not (obs.mode_shares or obs.counts)
            result["calibration"] = {**f, "rounds": history, "fitted": changed}
            return outcome, result, files
        current = new
    return outcome, result, files


class _Round:
    """A reporter that adds the calibration round to each progress step."""

    def __init__(self, inner: Any, k: int, of: int) -> None:
        self.inner, self.k, self.of = inner, k, of

    def report(self, step: dict[str, Any], result: dict[str, Any]) -> None:
        self.inner.report({**step, "calibration_round": self.k, "calibration_rounds": self.of}, result)

    def should_stop(self) -> bool:
        return bool(self.inner.should_stop())
