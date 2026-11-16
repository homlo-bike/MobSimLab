import json
from typing import Any

import pytest

from mobsim_worker.jobs.sweep import measure, pareto, run_sweep, variants


def line(consumption: float, disturbed: float, unplaced: int = 0) -> dict[str, Any]:
    return {
        "planned": {
            "consumption": consumption,
            "punctuality": 0.99,
            "disturbed_punctuality": disturbed,
            "knock_on_s": 10.0,
            "residual_delay_s": 5.0,
            "unplaced": unplaced,
        }
    }


class FakeKernel:
    """A kernel whose punctuality falls with the delayed share and whose fleet grows with the spare share."""

    def __init__(self) -> None:
        self.params: list[dict[str, Any]] = []

    def run(self, params_json: str) -> str:
        p = json.loads(params_json)
        self.params.append(p)
        if p.get("delayed_share") == 0.9:
            raise ValueError("refused")
        spare = p.get("spare_share", 0.15)
        disturbed = 1.0 - p.get("delayed_share", 0.2)
        verdict = "works" if disturbed > 0.75 else "delays_pile_up"
        return json.dumps(
            {
                "verdict": verdict,
                "fleet": {"vehicles": round(10 * (1 + spare)), "peak_out": 10},
                "lines": [line(0.6, disturbed), line(0.7, disturbed + 0.05, 1)],
            }
        )


class Recorder:
    def __init__(self, stop_after: int | None = None) -> None:
        self.steps: list[dict[str, Any]] = []
        self.stop_after = stop_after

    def report(self, step: dict[str, Any], result: dict[str, Any]) -> None:
        self.steps.append(step)

    def should_stop(self) -> bool:
        return self.stop_after is not None and len(self.steps) >= self.stop_after


def test_grid_is_every_combination_in_order() -> None:
    v = variants(
        {
            "design": "grid",
            "parameters": [
                {"name": "spare_share", "values": [0.1, 0.2]},
                {"name": "seed", "values": [1, 2, 3]},
            ],
        }
    )
    assert len(v) == 6
    assert v[0] == {"spare_share": 0.1, "seed": 1} and v[-1] == {"spare_share": 0.2, "seed": 3}


def test_latin_hypercube_covers_every_stratum_once_and_repeats_with_the_seed() -> None:
    d = {
        "design": "latin_hypercube",
        "parameters": [
            {"name": "delayed_share", "min": 0.0, "max": 1.0},
            {"name": "seed", "min": 1, "max": 100},
        ],
        "samples": 10,
        "seed": 7,
    }
    v = variants(d)
    assert len(v) == 10
    strata = sorted(int(x["delayed_share"] * 10) for x in v)
    assert strata == list(range(10))
    assert all(float(x["seed"]).is_integer() and 1 <= x["seed"] <= 100 for x in v)
    assert variants(d) == v
    assert variants({**d, "seed": 8}) != v


def test_measure_takes_the_worst_line() -> None:
    m = measure(
        {
            "verdict": "near_limit",
            "fleet": {"vehicles": 12, "peak_out": 10},
            "lines": [line(0.6, 0.9), line(0.8, 0.95, 2)],
        }
    )
    assert m["verdict_rank"] == 1
    assert m["vehicles"] == 12 and m["unplaced"] == 2
    assert m["max_consumption"] == 0.8 and m["min_disturbed_punctuality"] == 0.9


def test_pareto_keeps_only_variants_nothing_beats() -> None:
    rows = [
        {"i": 0, "metrics": {"vehicles": 10, "min_punctuality": 0.8}},
        {"i": 1, "metrics": {"vehicles": 12, "min_punctuality": 0.9}},
        {"i": 2, "metrics": {"vehicles": 12, "min_punctuality": 0.85}},
        {"i": 3, "metrics": {}},
    ]
    obj = [{"metric": "vehicles", "better": "lower"}, {"metric": "min_punctuality", "better": "higher"}]
    assert pareto(rows, obj) == [0, 1]


def test_sweep_runs_every_variant_over_the_shared_settings() -> None:
    k = FakeKernel()
    rec = Recorder()
    outcome, result = run_sweep(
        k,
        {
            "params": {"from_s": 25200, "to_s": 32400, "seed": 3},
            "design": {
                "design": "grid",
                "parameters": [
                    {"name": "delayed_share", "values": [0.1, 0.3, 0.9]},
                    {"name": "spare_share", "values": [0.1, 0.2]},
                ],
            },
            "objectives": [
                {"metric": "vehicles", "better": "lower"},
                {"metric": "min_disturbed_punctuality", "better": "higher"},
            ],
        },
        rec,
    )
    assert outcome == "done"
    assert result["total"] == 6 and len(result["variants"]) == 6
    assert all(p["from_s"] == 25200 and p["seed"] == 3 for p in k.params)
    failed = [v for v in result["variants"] if "error" in v]
    assert [v["params"]["delayed_share"] for v in failed] == [0.9, 0.9]
    # Fewer vehicles (spare 0.1) and better punctuality (delayed 0.1) win: one variant beats all others.
    assert result["pareto"] == [0]
    assert rec.steps[0] == {"step": "variant", "n": 1, "total": 6}


def test_sweep_stops_between_variants_and_keeps_what_it_found() -> None:
    outcome, result = run_sweep(
        FakeKernel(),
        {
            "params": {"from_s": 0, "to_s": 3600},
            "design": {
                "design": "grid",
                "parameters": [{"name": "delayed_share", "values": [0.1, 0.2, 0.3]}],
            },
            "objectives": [{"metric": "min_disturbed_punctuality", "better": "higher"}],
        },
        Recorder(stop_after=2),
    )
    assert outcome == "stopped"
    assert len(result["variants"]) == 1 and result["pareto"] == [0]


def test_the_real_kernel_sweeps_the_example_metro() -> None:
    pytest.importorskip("mobsim_kernels")
    from mobsim_worker.jobs.capacity import load_kernel

    outcome, result = run_sweep(
        load_kernel("example:metro", ""),
        {
            "params": {"from_s": 25200, "to_s": 28800, "stability_runs": 2},
            "design": {"design": "grid", "parameters": [{"name": "delayed_share", "values": [0.0, 0.5]}]},
            "objectives": [{"metric": "min_disturbed_punctuality", "better": "higher"}],
        },
        Recorder(),
    )
    assert outcome == "done"
    a, b = result["variants"]
    assert a["verdict"] is not None and "error" not in a and "error" not in b
    assert a["metrics"]["min_disturbed_punctuality"] >= b["metrics"]["min_disturbed_punctuality"]
    assert 0 in result["pareto"]
