import json
from typing import Any

import pytest
import structlog

from mobsim_worker.config import WorkerConfig
from mobsim_worker.logsink import REDACTED, DatabaseSink, is_secret_key, redact, redact_event
from mobsim_worker.main import configure_logging

RUN = "6f1c4c1e-1b7a-4c55-9a43-0c4f7d1a2b3c"


class FakeConn:
    def __init__(self, fail: bool = False) -> None:
        self.calls: list[dict[str, Any]] = []
        self.closed = False
        self.fail = fail

    def execute(self, query: str, params: dict[str, Any]) -> None:
        if self.fail:
            raise OSError("database gone")
        assert "logs.append_worker" in query
        self.calls.append(params)

    def close(self) -> None:
        self.closed = True


def test_secret_names_and_inline_credentials_are_redacted() -> None:
    assert is_secret_key("db_password") and is_secret_key("Authorization") and is_secret_key("api-key")
    assert not is_secret_key("run") and not is_secret_key("speed_kmh")
    out = redact({"headers": {"cookie": "a=b", "accept": "json"}, "note": "used Bearer abc.def", "n": 3})
    assert out == {
        "headers": {"cookie": REDACTED, "accept": "json"},
        "note": f"used Bearer {REDACTED}",
        "n": 3,
    }
    event = redact_event(None, "warning", {"event": "x", "password": "p"})
    assert event == {"event": "x", "password": REDACTED}


def test_stores_warn_and_above_only_with_the_run() -> None:
    conn = FakeConn()
    sink = DatabaseSink(lambda: conn)  # type: ignore[arg-type,return-value]
    for method in ("debug", "info", "warning", "error", "critical"):
        sink(None, method, {"event": f"{method} event", "level": method, "run": RUN, "job": "j1"})
    assert [c["level"] for c in conn.calls] == ["WARN", "ERROR", "CRITICAL"]
    first = conn.calls[0]
    assert first["message"] == "warning event" and first["run"] == RUN and first["module"] == "worker"
    assert json.loads(first["context"]) == {"job": "j1"}


def test_a_failed_store_is_dropped_and_retried_later() -> None:
    now = [0.0]
    conns = [FakeConn(fail=True), FakeConn()]
    opened: list[FakeConn] = []

    def connect() -> FakeConn:
        c = conns[len(opened)]
        opened.append(c)
        return c

    sink = DatabaseSink(connect, clock=lambda: now[0])  # type: ignore[arg-type]
    event = {"event": "slow", "level": "warning", "run": "not-a-uuid"}
    assert sink(None, "warning", dict(event)) == event  # passed on even when the store fails
    assert conns[0].closed
    sink(None, "warning", dict(event))  # within the retry wait: not tried
    assert len(opened) == 1
    now[0] = 31.0
    sink(None, "warning", dict(event))
    assert conns[1].calls[0]["run"] is None


def test_stdout_lines_carry_the_level_and_are_redacted(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging()
    structlog.get_logger("t").warning("could not connect", password="hunter2")
    line = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert line["level"] == "warning" and line["password"] == REDACTED


def test_configured_worker_sends_warnings_to_the_database(monkeypatch: pytest.MonkeyPatch) -> None:
    conn = FakeConn()
    monkeypatch.setattr("mobsim_worker.main.log_connection", lambda cfg: conn)
    configure_logging(WorkerConfig(db_host="db", db_password="x", data_dir="/tmp"))  # type: ignore[arg-type]  # noqa: S108
    structlog.get_logger("t").error("run failed", run=RUN, error="boom")
    structlog.get_logger("t").info("run done", run=RUN)
    assert [c["level"] for c in conn.calls] == ["ERROR"]
    configure_logging()
