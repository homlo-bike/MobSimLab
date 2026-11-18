"""The worker asks whether the run queue exists before polling it."""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any

from mobsim_worker import main
from mobsim_worker.config import WorkerConfig
from mobsim_worker.queue import READY


class Rows:
    def __init__(self, row: Any) -> None:
        self.row = row

    def fetchone(self) -> Any:
        return self.row


class FakeConn:
    """Answers the readiness question 'no' twice, then 'yes'; records every statement."""

    def __init__(self, stop: threading.Event) -> None:
        self.stop = stop
        self.sql: list[str] = []
        self.ready_answers = [False, False, True]

    def __enter__(self) -> FakeConn:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def execute(self, sql: str, params: Any = None) -> Rows:
        self.sql.append(sql)
        if sql == READY:
            return Rows((self.ready_answers.pop(0),))
        self.stop.set()  # the first real poll ends the test
        return Rows(None)


def test_does_not_poll_the_queue_until_it_exists(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.setattr(main, "IDLE_WAIT_S", 0.001)
    stop = threading.Event()
    conn = FakeConn(stop)
    cfg = WorkerConfig(db_host="db", db_password="x", data_dir=tmp_path)
    main.work(cfg, stop, lambda _cfg: conn)  # type: ignore[arg-type,return-value]
    assert conn.sql[:3] == [READY, READY, READY]
    assert "pgboss.job" in conn.sql[3] and conn.sql[3] != READY
    assert len(conn.sql) == 4
