import json
from typing import Any

import pytest

from mobsim_worker.jobs.capacity import run_capacity


def point(verdict: str, headway: float = 0) -> dict[str, Any]:
    return {"verdict": verdict, "headway_s": headway}


class FakeKernel:
    """Two lines: A works and fits up to 3 min, B does not work; every call is recorded."""

    def __init__(self) -> None:
        self.calls: list[tuple[Any, ...]] = []

    def lines(self) -> str:
        return json.dumps(
            [{"id": "A", "name": "Line A", "bands": []}, {"id": "B", "name": "Line B", "bands": []}]
        )

    def notes(self) -> str:
        return json.dumps(["a note"])

    def run(self, params_json: str) -> str:
        self.calls.append(("run", json.loads(params_json)))
        return json.dumps(
            {
                "verdict": "over_limit",
                "lines": [
                    {"line": "B", "name": "Line B", "planned": point("over_limit")},
                    {"line": "A", "name": "Line A", "planned": point("works")},
                ],
            }
        )

    def sweep_headways(self, params_json: str, line: int, works: bool) -> str:
        self.calls.append(("headways", line, works))
        return json.dumps([300, 240, 180, 120, 90, 60] if works else [600, 480])

    def sweep_point(self, params_json: str, line: int, headway_s: float) -> str:
        self.calls.append(("point", line, headway_s))
        fits = line == 1 or headway_s >= 180
        return json.dumps(point("works" if fits else "not_enough_capacity", headway_s))


class Recorder:
    def __init__(self, stop_after: int | None = None) -> None:
        self.steps: list[dict[str, Any]] = []
        self.stop_after = stop_after

    def report(self, step: dict[str, Any], result: dict[str, Any]) -> None:
        self.steps.append(step)

    def should_stop(self) -> bool:
        return self.stop_after is not None and len(self.steps) >= self.stop_after


def test_runs_the_period_and_sweeps_like_the_panel() -> None:
    k, rec = FakeKernel(), Recorder()
    outcome, result = run_capacity(k, {"from_s": 25200, "to_s": 32400}, True, rec)
    assert outcome == "done"
    assert result["notes"] == ["a note"] and result["run"]["verdict"] == "over_limit"
    # Lines in the run's order, matched to the kernel's line index by ID.
    assert [x["info"]["id"] for x in result["lines"]] == ["B", "A"]
    assert ("headways", 1, False) in k.calls and ("headways", 0, True) in k.calls
    b, a = result["lines"]
    assert [p["headway_s"] for p in b["sweep"]] == [600, 480]
    # A works: its sweep stops after two shorter headways in a row that do not fit.
    assert [p["headway_s"] for p in a["sweep"]] == [300, 240, 180, 120, 90]
    assert not a["sweeping"] and not b["sweeping"]
    assert rec.steps[0] == {"step": "planning"}
    assert {"step": "sweeping", "line": "Line A", "headway_s": 90, "n": 5, "total": 6} in rec.steps


def test_without_sweep_only_the_period_runs() -> None:
    k = FakeKernel()
    outcome, result = run_capacity(k, {"from_s": 0, "to_s": 3600}, False, Recorder())
    assert outcome == "done" and [c[0] for c in k.calls] == ["run"]
    assert all(not x["sweep"] and not x["sweeping"] for x in result["lines"])


def test_stops_between_steps_and_keeps_what_it_found() -> None:
    k = FakeKernel()
    outcome, result = run_capacity(k, {"from_s": 0, "to_s": 3600}, True, Recorder(stop_after=4))
    assert outcome == "stopped"
    assert result["run"] is not None
    # Planning, line B and its two points were reported; line A's sweep never started.
    assert [len(x["sweep"]) for x in result["lines"]] == [2, 0]
    assert all(not x["sweeping"] for x in result["lines"])


def test_the_real_kernel_gives_the_browser_result() -> None:
    kernels = pytest.importorskip("mobsim_kernels")
    from mobsim_worker.jobs.capacity import load_kernel

    k = load_kernel("example:metro", "")
    assert isinstance(k, kernels.CapacityRunner)
    outcome, result = run_capacity(k, {}, False, Recorder())
    # The same verdict as the WebAssembly module's test (crates/rail-sim-wasm/src/lib.rs).
    assert outcome == "done" and result["run"]["verdict"] == "near_limit"
    assert result["lines"][0]["info"]["id"] == "M1"
    with pytest.raises(ValueError, match="topology"):
        load_kernel("not a topology", "{}")
