"""The worker keeps a run's job alive while a step reports no progress (Damascus bug 28)."""

from __future__ import annotations

import threading
import time
from typing import Any

from mobsim_worker import runner
from mobsim_worker.queue import Job


class Rows:
    def __init__(self, row: Any) -> None:
        self.row = row

    def fetchone(self) -> Any:
        return self.row


class FakeConn:
    """Hands out one queued road run and accepts every other statement."""

    def execute(self, sql: str, params: Any = None) -> Rows:
        if sql == runner.TAKE:
            return Rows(("road", {"params": {}}, None, "[]", False))
        return Rows((False,))


class FakeQueue:
    def __init__(self, alive: bool = True) -> None:
        self.alive = alive
        self.touches = 0
        self.settled: list[str] = []

    def touch(self, job: Job) -> bool:
        self.touches += 1
        return self.alive

    def complete(self, job: Job, output: Any = None) -> bool:
        self.settled.append("completed")
        return True

    def fail(self, job: Job, message: str) -> bool:
        self.settled.append("failed: " + message)
        return True


def silent_road(seconds: float) -> runner.RoadRunner:
    """A road run whose background-traffic step reports nothing for ``seconds``."""

    def road(settings: Any, scenario: Any, tiles: Any, reporter: Any) -> Any:
        reporter.report({"step": "traffic"}, {})
        time.sleep(seconds)
        return ("stopped" if reporter.should_stop() else "done"), {}, None

    return road


def run(queue: FakeQueue, seconds: float, monkeypatch: Any) -> str:
    monkeypatch.setattr(runner, "HEARTBEAT_EVERY_S", 0.02)
    monkeypatch.setattr(runner, "street_tiles", lambda network: [])
    job = Job(id="00000000-0000-0000-0000-000000000001", data={"runId": "r"}, attempt=0)
    return runner.process(FakeConn(), queue, job, threading.Event(), road=silent_road(seconds))  # type: ignore[arg-type]


def test_heartbeat_beats_while_a_step_reports_nothing(monkeypatch: Any) -> None:
    queue = FakeQueue()
    assert run(queue, 0.3, monkeypatch) == "done"
    assert queue.touches >= 5
    assert queue.settled == ["completed"]


def test_heartbeat_stops_with_the_run(monkeypatch: Any) -> None:
    queue = FakeQueue()
    run(queue, 0.1, monkeypatch)
    after = queue.touches
    time.sleep(0.1)
    assert queue.touches == after


def test_a_lost_job_stops_the_run(monkeypatch: Any) -> None:
    queue = FakeQueue(alive=False)
    assert run(queue, 0.2, monkeypatch) == "stopped"
    assert queue.touches == 1
    assert queue.settled == ["failed: " + runner.STOPPED]
