"""Calendar runs (ADR-0020): many years, one date, or a row of dates, from representative day types.

Simulating every day of several years in detail is too slow, so a calendar run simulates one
representative day per day type (weekday, Saturday, Sunday, public holiday) and expands it with the
calendar:

* ``years``: a year's figures are each day type's day figures times the number of days of that type in
  the year (from the project calendar: weekdays, weekends and the public holidays it counts), plus the
  year's fixed operating cost (upkeep and the overheads on it).
* ``date``: one date, simulated as its day type.
* ``days``: every date from a first to a last one, each as its day type. Each day starts from the depot
  as planned; the kernel does not carry trains, delays or charge from one day to the next.

The rail service of each day type is run in the rail capacity kernel over that day type's service day
(first to last departure), once per distinct service day: its verdict, trains and punctuality tell
whether that day works. The day figures (vehicle-km, vehicle-hours, passengers, energy, operating cost)
come with the run, worked out by the web app from the same models as the Tables tab, so the run and the
tables agree.
"""

from __future__ import annotations

import json
from typing import Any

from mobsim_worker.jobs.capacity import CapacityKernel, Outcome, Reporter
from mobsim_worker.jobs.sweep import VERDICTS

#: Day types of the project calendar (apps/web/src/workspace/calendar.ts ``DAY_TYPES``).
DAY_TYPES = ("weekday", "saturday", "sunday", "holiday")

#: Figures of a day, summed over a period.
FIGURES = ("vehicle_km", "vehicle_hours", "passengers", "energy_kwh", "operating_cost")


def _worst(verdicts: list[str]) -> str | None:
    known = [v for v in verdicts if v in VERDICTS]
    return max(known, key=VERDICTS.index) if known else None


def _day_summary(run: dict[str, Any]) -> dict[str, Any]:
    """What a calendar run keeps of a representative day's capacity run."""
    fleet = run.get("fleet") or {}
    lines = []
    for lr in run.get("lines", []):
        p = lr.get("planned") or {}
        lines.append(
            {
                "line": lr.get("line"),
                "name": lr.get("name"),
                "verdict": p.get("verdict"),
                "punctuality": p.get("punctuality"),
                "disturbed_punctuality": p.get("disturbed_punctuality"),
                "consumption": p.get("consumption"),
                "unplaced": p.get("unplaced"),
            }
        )
    return {
        "verdict": run.get("verdict"),
        "trips": fleet.get("trips"),
        "vehicles": fleet.get("vehicles"),
        "peak_out": fleet.get("peak_out"),
        "lines": lines,
    }


def expand(plan: dict[str, Any], days: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Each period's day counts and figures: day figures times day counts, plus the fixed operating cost.

    Args:
        plan: The run's plan: ``periods`` (``label``, ``counts`` per day type, ``share_of_year`` of the fixed
            cost), ``fixed_per_year`` (``operating_cost``).
        days: Per day type, ``per_day`` figures (a figure may be null when it is unknown).

    Returns:
        One row per period: ``label``, ``counts``, ``days``, and each figure's total (null when any day type
        that occurs has it unknown).
    """
    fixed = (plan.get("fixed_per_year") or {}).get("operating_cost")
    out = []
    for period in plan["periods"]:
        counts = {dt: int(period["counts"].get(dt, 0)) for dt in DAY_TYPES}
        totals: dict[str, float | None] = {}
        for f in FIGURES:
            total: float | None = 0.0
            for dt, n in counts.items():
                if n == 0:
                    continue
                v = (days.get(dt) or {}).get("per_day", {}).get(f)
                if v is None:
                    total = None
                    break
                total += float(v) * n  # type: ignore[operator]
            totals[f] = total
        if totals["operating_cost"] is not None and fixed is not None:
            totals["operating_cost"] += float(fixed) * float(period.get("share_of_year", 1.0))
        out.append(
            {
                "label": period["label"],
                "counts": counts,
                "days": sum(counts.values()),
                **totals,
            }
        )
    return out


def run_calendar(
    kernel: CapacityKernel | None,
    settings: dict[str, Any],
    reporter: Reporter,
) -> tuple[Outcome, dict[str, Any]]:
    """Run each day type's representative day and expand the figures over the plan's periods.

    Args:
        kernel: The rail network and its lines, or None when the project has no rail service to run.
        settings: The stored input: ``params`` (``CapacityParams`` other than the period) and ``plan``:
            ``mode`` (years, date or days), ``day_types`` (per day type: ``from_s``, ``to_s``, ``per_day``),
            ``periods`` and ``fixed_per_year``.
        reporter: Gets the progress after every step and says when to stop.

    Returns:
        ``"done"`` or ``"stopped"``, with ``{"mode", "notes", "run": {"verdict"}, "day_types", "periods"}``.
    """
    plan = settings["plan"]
    params = {k: v for k, v in dict(settings.get("params") or {}).items() if k not in ("from_s", "to_s")}
    used = [dt for dt in DAY_TYPES if any(int(p["counts"].get(dt, 0)) > 0 for p in plan["periods"])]
    day_types: dict[str, dict[str, Any]] = {
        dt: {**plan["day_types"][dt], "days": sum(int(p["counts"].get(dt, 0)) for p in plan["periods"])}
        for dt in used
    }
    result: dict[str, Any] = {
        "mode": plan["mode"],
        "notes": json.loads(kernel.notes()) if kernel is not None else [],
        "run": {"verdict": None},
        "day_types": day_types,
        "periods": [],
    }
    if kernel is not None:
        # Day types with the same service day share one run.
        done: dict[tuple[float, float], dict[str, Any]] = {}
        for n, dt in enumerate(used, start=1):
            window = (float(day_types[dt]["from_s"]), float(day_types[dt]["to_s"]))
            if reporter.should_stop():
                return "stopped", result
            reporter.report({"step": "day", "day_type": dt, "n": n, "total": len(used)}, result)
            if window not in done:
                run = json.loads(kernel.run(json.dumps({**params, "from_s": window[0], "to_s": window[1]})))
                done[window] = _day_summary(run)
            day_types[dt]["rail"] = done[window]
        result["run"]["verdict"] = _worst([d["rail"]["verdict"] for d in day_types.values() if "rail" in d])
    reporter.report({"step": "expanding"}, result)
    result["periods"] = expand(plan, day_types)
    return "done", result
