"""Runs one simulation run job: takes the run, runs it, writes progress and the result, settles the job.

The run's row in ``simulation.run`` is the source of truth. The worker only starts a run that is still
``queued`` (a planner may have cancelled it), writes only while it is ``running``, and settles the run
before the job, so the API never shows a finished job with an open run.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any, Protocol

import structlog
from psycopg.types.json import Jsonb

from mobsim_worker.jobs.capacity import KernelLoader, load_kernel, run_capacity
from mobsim_worker.queue import Connection, Job, Queue

log = structlog.get_logger("mobsim_worker")

#: Seconds between heartbeats while a run reports progress (the queue fails a job after 120 s without one).
HEARTBEAT_EVERY_S = 30.0

#: Seconds between checks of ``cancel_requested`` while a run reports progress.
CANCEL_CHECK_EVERY_S = 1.0

STOPPED = "the background worker was stopped before the run finished; start it again"

TAKE = """
UPDATE simulation.run SET status = 'running', started_at = now()
WHERE id = %(id)s::uuid AND status = 'queued'
RETURNING kind, input, network, lines, cancel_requested
"""

PROGRESS = """
UPDATE simulation.run SET progress = %(progress)s, result = %(result)s
WHERE id = %(id)s::uuid AND status = 'running'
"""

SETTLE = """
UPDATE simulation.run
SET status = %(status)s, progress = NULL, result = %(result)s, error = %(error)s, finished_at = now()
WHERE id = %(id)s::uuid AND status = 'running'
"""


class StopSignal(Protocol):
    """Set when the worker is stopping (a ``threading.Event`` or a ``multiprocessing`` event)."""

    def is_set(self) -> bool: ...  # noqa: D102

    def wait(self, timeout: float | None = None) -> bool: ...  # noqa: D102


CANCELLED = "SELECT cancel_requested OR status <> 'running' FROM simulation.run WHERE id = %(id)s::uuid"


class RunReporter:
    """Writes a run's progress to its row, beats the job's heartbeat and tells the run when to stop."""

    def __init__(
        self,
        conn: Connection,
        queue: Queue,
        job: Job,
        run_id: str,
        stop: StopSignal,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        """Create a reporter for one run."""
        self.conn = conn
        self.queue = queue
        self.job = job
        self.run_id = run_id
        self.stop = stop
        self.clock = clock
        self.cancelled = False
        self.lost = False
        self._beat = clock()
        self._checked = -CANCEL_CHECK_EVERY_S

    def report(self, step: dict[str, Any], result: dict[str, Any]) -> None:
        """Save the current step and what the run has found so far, and beat the heartbeat when due."""
        self.conn.execute(PROGRESS, {"id": self.run_id, "progress": Jsonb(step), "result": Jsonb(result)})
        if self.clock() - self._beat >= HEARTBEAT_EVERY_S:
            self._beat = self.clock()
            if not self.queue.touch(self.job):
                self.lost = True

    def should_stop(self) -> bool:
        """Whether to stop: the worker is stopping, the job was lost, or a planner cancelled the run."""
        if self.stop.is_set() or self.lost:
            return True
        now = self.clock()
        if now - self._checked >= CANCEL_CHECK_EVERY_S:
            self._checked = now
            row = self.conn.execute(CANCELLED, {"id": self.run_id}).fetchone()
            self.cancelled = bool(row is None or row[0])
        return self.cancelled


def settle(conn: Connection, run_id: str, status: str, result: Any, error: str | None) -> None:
    """Settle a running run: done, cancelled or failed."""
    conn.execute(
        SETTLE,
        {
            "id": run_id,
            "status": status,
            "result": None if result is None else Jsonb(result),
            "error": None if error is None else error[:2000],
        },
    )


def process(
    conn: Connection,
    queue: Queue,
    job: Job,
    stop: StopSignal,
    loader: KernelLoader = load_kernel,
) -> str:
    """Run the job's simulation run and settle the run and the job.

    Args:
        conn: Autocommit connection as the ``mobsimlab_worker`` role.
        queue: The run queue.
        job: The job taken from it.
        stop: Set when the worker is stopping; the run stops between steps.
        loader: Loads the kernel for a network and its lines.

    Returns:
        How the run ended: ``done``, ``cancelled``, ``failed``, ``stopped`` or ``skipped``.
    """
    run_id = str(job.data.get("runId", ""))
    row = conn.execute(TAKE, {"id": run_id}).fetchone() if run_id else None
    if row is None:
        # Cancelled while queued, or not a run at all: nothing to do.
        queue.complete(job, {"skipped": "the run is not queued"})
        log.info("run skipped", run=run_id, job=job.id)
        return "skipped"
    kind, settings, network, lines, cancel_requested = row
    bound = log.bind(run=run_id, job=job.id, kind=kind)
    bound.info("run started")
    reporter = RunReporter(conn, queue, job, run_id, stop)
    try:
        if kind != "capacity":
            raise ValueError(f"this worker cannot run {kind!r} runs")
        if cancel_requested:
            settle(conn, run_id, "cancelled", None, None)
            queue.complete(job, {"status": "cancelled"})
            return "cancelled"
        kernel = loader(network, lines)
        outcome, result = run_capacity(kernel, dict(settings["params"]), bool(settings["sweep"]), reporter)
    except Exception as e:  # noqa: BLE001 (any failure of the run is reported on the run)
        message = str(e) or type(e).__name__
        bound.warning("run failed", error=message)
        settle(conn, run_id, "failed", None, message)
        queue.fail(job, message)
        return "failed"
    if outcome == "done":
        settle(conn, run_id, "done", result, None)
        queue.complete(job, {"status": "done"})
        bound.info("run done", verdict=(result.get("run") or {}).get("verdict"))
        return "done"
    if reporter.cancelled and not stop.is_set() and not reporter.lost:
        settle(conn, run_id, "cancelled", result, None)
        queue.complete(job, {"status": "cancelled"})
        bound.info("run cancelled")
        return "cancelled"
    settle(conn, run_id, "failed", result, STOPPED)
    queue.fail(job, STOPPED)
    bound.info("run stopped")
    return "stopped"
