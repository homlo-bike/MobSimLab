"""The demand model run (ADR-0019): the four-step model in ``mobsim_worker.demand`` on the run's bundle.

AequilibraE is in the ``demand`` extra of the worker; it is imported only when a demand run starts, so a
worker built without it still runs capacity runs and fails a demand run with a clear message.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Literal, Protocol


class Reporter(Protocol):
    """Where the run reports to and learns that it should stop."""

    def report(self, step: dict[str, Any], result: dict[str, Any]) -> None: ...  # noqa: D102

    def should_stop(self) -> bool: ...  # noqa: D102


@dataclass
class RunFile:
    """A file saved next to the run's result."""

    name: str
    media_type: str
    content: bytes


def run_demand_job(
    network: str, lines: str, settings: dict[str, Any], reporter: Reporter
) -> tuple[Literal["done", "stopped"], dict[str, Any], list[RunFile]]:
    """Run the demand model on the run's bundle with the run's values.

    Args:
        network: ``{"tiles": [OSM XML]}``, the street tiles of the model area the API added; or the bundle
            itself (a bundle that carries its streets, with ``lines`` empty).
        lines: The bundle (contracts/demand-input.schema.json) as JSON text, or empty.
        settings: ``{"values": {key: number}}``.
        reporter: Where progress goes.

    Raises:
        RuntimeError: This worker was built without the demand model.
        ValueError: The bundle or the values cannot be used (``InputError``).
    """
    try:
        from mobsim_worker.demand.model import run_demand  # noqa: PLC0415
    except ImportError as e:
        raise RuntimeError("this worker was built without the demand model (the 'demand' extra)") from e
    if lines:
        tiles = json.loads(network).get("tiles", []) if network else []
        outcome, result, files = run_demand(lines, dict(settings or {}), reporter, list(tiles))
    else:
        outcome, result, files = run_demand(network, dict(settings or {}), reporter)
    return outcome, result, [RunFile(f.name, f.media_type, f.content) for f in files]
