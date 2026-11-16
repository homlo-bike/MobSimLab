"""The rail capacity run of the simulator tab, run on the server (crates/rail-sim/src/capacity.rs).

It does what the panel does in the browser (``apps/web/src/features/capacity/CapacityRun.tsx``): run the
period, then, if asked, the frequency sweep of every line one point at a time, stopping a line's sweep after
two points in a row that do not fit. The kernel is the same Rust code, here through ``mobsim_kernels``.
After every step it reports what it has found so far, and it stops between steps when the run is cancelled.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any, Literal, Protocol

#: Verdicts that count as working (crates/rail-sim/src/capacity.rs `Verdict`, best first).
WORKING = ("works", "near_limit")

#: The example network the kernels know by name.
EXAMPLE_NETWORK = "example:metro"


class CapacityKernel(Protocol):
    """A network and its lines, ready for runs (``mobsim_kernels.CapacityRunner``). JSON in, JSON out."""

    def lines(self) -> str: ...  # noqa: D102

    def notes(self) -> str: ...  # noqa: D102

    def run(self, params_json: str) -> str: ...  # noqa: D102

    def sweep_headways(self, params_json: str, line: int, works: bool) -> str: ...  # noqa: D102

    def sweep_point(self, params_json: str, line: int, headway_s: float) -> str: ...  # noqa: D102


class Reporter(Protocol):
    """Where the run reports to (the run's row) and learns that it should stop."""

    def report(self, step: dict[str, Any], result: dict[str, Any]) -> None:
        """Save what the run is doing now and what it has found so far."""
        ...

    def should_stop(self) -> bool:
        """Whether to stop before the next step (cancelled by a planner, or the worker is stopping)."""
        ...


Outcome = Literal["done", "stopped"]


def load_kernel(network: str, lines: str) -> CapacityKernel:
    """Compile a network and read its lines with the Rust kernel.

    Args:
        network: ``"example:metro"`` or the railway editor's topology export (JSON text).
        lines: The lines file (JSON text); ignored for the example, which has its own.

    Returns:
        The kernel.

    Raises:
        ValueError: The network or the lines cannot be read; the message says why.
    """
    import mobsim_kernels  # noqa: PLC0415 (the Rust module is only in the image and in local builds)

    if network == EXAMPLE_NETWORK:
        lines = mobsim_kernels.CapacityRunner.example_lines()
    kernel: CapacityKernel = mobsim_kernels.CapacityRunner(network, lines)
    return kernel


def run_capacity(
    kernel: CapacityKernel,
    params: dict[str, Any],
    sweep: bool,
    reporter: Reporter,
) -> tuple[Outcome, dict[str, Any]]:
    """Run the period and, if asked, the frequency sweep.

    Args:
        kernel: The loaded network and lines.
        params: ``CapacityParams``; missing fields take the kernel's defaults.
        sweep: Whether to try other frequencies for every line.
        reporter: Gets the progress after every step and says when to stop.

    Returns:
        ``"done"`` or ``"stopped"`` (stopped between steps), with the result:
        ``{"notes", "run", "lines": [{"info", "planned", "sweep", "sweeping"}]}``.
    """
    p = json.dumps(params)
    notes: list[str] = json.loads(kernel.notes())
    infos: list[dict[str, Any]] = json.loads(kernel.lines())
    result: dict[str, Any] = {"notes": notes, "run": None, "lines": []}
    reporter.report({"step": "planning"}, result)
    run = json.loads(kernel.run(p))
    result["run"] = run
    index = {str(i["id"]): k for k, i in enumerate(infos)}
    lines: list[dict[str, Any]] = []
    for lr in run["lines"]:
        k = index.get(str(lr["line"]))
        info = infos[k] if k is not None else {"id": lr["line"], "name": lr["name"], "bands": []}
        lines.append({"info": info, "planned": lr["planned"], "sweep": [], "sweeping": sweep})
    result["lines"] = lines
    if not sweep:
        return "done", result

    def stop_sweeping() -> tuple[Outcome, dict[str, Any]]:
        for line in lines:
            line["sweeping"] = False
        return "stopped", result

    for line in lines:
        li = index.get(str(line["info"]["id"]))
        if li is None:
            line["sweeping"] = False
            continue
        works = line["planned"]["verdict"] in WORKING
        reporter.report({"step": "sweeping", "line": line["info"]["name"]}, result)
        if reporter.should_stop():
            return stop_sweeping()
        headways: list[float] = json.loads(kernel.sweep_headways(p, li, works))
        for n, h in enumerate(headways, start=1):
            if reporter.should_stop():
                return stop_sweeping()
            reporter.report(
                {
                    "step": "sweeping",
                    "line": line["info"]["name"],
                    "headway_s": h,
                    "n": n,
                    "total": len(headways),
                },
                result,
            )
            line["sweep"].append(json.loads(kernel.sweep_point(p, li, h)))
            # Shorter headways only get harder: stop after two in a row that do not fit.
            last = line["sweep"][-2:]
            if works and len(last) == 2 and all(x["verdict"] == "not_enough_capacity" for x in last):
                break
        line["sweeping"] = False
    return "done", result


KernelLoader = Callable[[str, str], CapacityKernel]
