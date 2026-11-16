"""A sweep of the rail capacity run's settings (ADR-0035 §7), asked for by an AI agent.

One capacity run per variant of the settings, in one job, so an agent tunes numbers without one call per
variant. The variants are every combination of the listed values (a full grid), or a Latin hypercube
(McKay, Beckman & Conover, *Technometrics* 21, 1979) over ranges, drawn with a seed so that the same sweep
gives the same variants. Each variant is measured (``METRICS``) and the result keeps the Pareto front over
the sweep's objectives. The design is checked by the API (apps/api/src/simulation/params.ts).
"""

from __future__ import annotations

import itertools
import json
import random
from typing import Any

from mobsim_worker.jobs.capacity import CapacityKernel, Outcome, Reporter

#: Verdicts best first (crates/rail-sim/src/capacity.rs `Verdict`); a variant's ``verdict_rank`` is the index.
VERDICTS = ("works", "near_limit", "over_limit", "delays_pile_up", "not_enough_capacity")

#: Settings that only take whole numbers; the Latin hypercube rounds them.
INTEGER_PARAMS = frozenset({"stability_runs", "seed"})


def variants(design: dict[str, Any]) -> list[dict[str, float]]:
    """List the settings of every variant of a design.

    Args:
        design: ``{"design": "grid", "parameters": [{"name", "values"}]}`` or
            ``{"design": "latin_hypercube", "parameters": [{"name", "min", "max"}], "samples", "seed"}``.

    Returns:
        One mapping of setting to value per variant, in a fixed order.
    """
    params = design["parameters"]
    names = [p["name"] for p in params]
    if design["design"] == "grid":
        return [
            dict(zip(names, combo, strict=True))
            for combo in itertools.product(*(p["values"] for p in params))
        ]
    n = int(design["samples"])
    rng = random.Random(int(design.get("seed", 1)))  # noqa: S311 (a seeded design, not a secret)
    columns: list[list[float]] = []
    for p in params:
        # One draw in each of n equal strata, then the strata shuffled: every range is covered evenly.
        lo, hi = float(p["min"]), float(p["max"])
        col = [lo + (hi - lo) * (k + rng.random()) / n for k in range(n)]
        rng.shuffle(col)
        if p["name"] in INTEGER_PARAMS:
            col = [float(round(v)) for v in col]
        columns.append(col)
    return [{name: columns[j][i] for j, name in enumerate(names)} for i in range(n)]


def measure(run: dict[str, Any]) -> dict[str, float]:
    """Measure one capacity run (``CapacityRun`` of crates/rail-sim/src/capacity.rs).

    Args:
        run: The kernel's run result.

    Returns:
        The sweep metrics (apps/api/src/simulation/params.ts ``SWEEP_METRICS``).
    """
    points = [line["planned"] for line in run.get("lines", [])]
    fleet = run.get("fleet") or {}
    out: dict[str, float] = {
        "verdict_rank": float(VERDICTS.index(run["verdict"])) if run.get("verdict") in VERDICTS else 4.0,
        "vehicles": float(fleet.get("vehicles", 0)),
        "peak_out": float(fleet.get("peak_out", 0)),
        "unplaced": float(sum(p.get("unplaced", 0) for p in points)),
    }
    if points:
        out["max_consumption"] = max(float(p["consumption"]) for p in points)
        out["min_punctuality"] = min(float(p["punctuality"]) for p in points)
        out["min_disturbed_punctuality"] = min(float(p["disturbed_punctuality"]) for p in points)
        out["max_knock_on_s"] = max(float(p["knock_on_s"]) for p in points)
        out["max_residual_delay_s"] = max(float(p["residual_delay_s"]) for p in points)
    return out


def pareto(rows: list[dict[str, Any]], objectives: list[dict[str, str]]) -> list[int]:
    """Find the variants no other variant beats on every objective.

    Args:
        rows: Measured variants: ``{"i", "metrics"}``; variants without every objective's metric are left out.
        objectives: ``[{"metric", "better": "lower" | "higher"}]``.

    Returns:
        The ``i`` of every variant on the Pareto front, in order.
    """

    def key(r: dict[str, Any]) -> tuple[float, ...] | None:
        m = r["metrics"]
        if any(o["metric"] not in m for o in objectives):
            return None
        return tuple(m[o["metric"]] if o["better"] == "lower" else -m[o["metric"]] for o in objectives)

    scored = [(r["i"], k) for r in rows if (k := key(r)) is not None]

    def dominated(a: tuple[float, ...]) -> bool:
        return any(all(x <= y for x, y in zip(b, a, strict=True)) and b != a for _, b in scored)

    return [i for i, k in scored if not dominated(k)]


def run_sweep(
    kernel: CapacityKernel,
    settings: dict[str, Any],
    reporter: Reporter,
) -> tuple[Outcome, dict[str, Any]]:
    """Run every variant of the sweep, reporting after each one.

    Args:
        kernel: The loaded network and lines.
        settings: The run's stored input: ``params`` (shared settings), ``design`` and ``objectives``.
        reporter: Gets the progress after every variant and says when to stop.

    Returns:
        ``"done"`` or ``"stopped"``, with ``{"design", "objectives", "total", "variants", "pareto"}``; each
        variant is ``{"i", "params", "verdict", "metrics"}`` or, when the kernel refused it, ``{"i", "params",
        "verdict": None, "metrics": {}, "error"}``.
    """
    base = dict(settings["params"])
    design = settings["design"]
    objectives = list(settings["objectives"])
    todo = variants(design)
    rows: list[dict[str, Any]] = []
    result: dict[str, Any] = {
        "design": design,
        "objectives": objectives,
        "total": len(todo),
        "variants": rows,
        "pareto": [],
    }
    for i, varied in enumerate(todo):
        reporter.report({"step": "variant", "n": i + 1, "total": len(todo)}, result)
        if reporter.should_stop():
            result["pareto"] = pareto(rows, objectives)
            return "stopped", result
        params = {**base, **{k: (int(v) if k in INTEGER_PARAMS else v) for k, v in varied.items()}}
        try:
            run = json.loads(kernel.run(json.dumps(params)))
        except Exception as e:  # noqa: BLE001 (one refused variant does not stop the sweep)
            rows.append({"i": i, "params": varied, "verdict": None, "metrics": {}, "error": str(e)[:500]})
            continue
        rows.append({"i": i, "params": varied, "verdict": run.get("verdict"), "metrics": measure(run)})
    result["pareto"] = pareto(rows, objectives)
    return "done", result
