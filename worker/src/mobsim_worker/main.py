"""Worker entry point: takes simulation run jobs from the pg-boss queue and runs them, one at a time."""

from __future__ import annotations

import signal
import sys
import threading
from collections.abc import Callable

import psycopg
import structlog

from mobsim_worker import __version__
from mobsim_worker.config import ConfigError, WorkerConfig, load_config
from mobsim_worker.queue import Queue
from mobsim_worker.runner import process

#: Seconds to wait when the queue is empty.
IDLE_WAIT_S = 2.0

#: Longest wait between attempts to reach the database.
MAX_BACKOFF_S = 30.0

log = structlog.get_logger("mobsim_worker")


def connect(cfg: WorkerConfig) -> psycopg.Connection[tuple[object, ...]]:
    """Open an autocommit connection as the restricted ``mobsimlab_worker`` role."""
    return psycopg.connect(
        host=cfg.db_host,
        port=cfg.db_port,
        dbname=cfg.db_name,
        user="mobsimlab_worker",
        password=cfg.db_password,
        application_name="mobsimlab-worker",
        autocommit=True,
        connect_timeout=10,
    )


def work(
    cfg: WorkerConfig,
    stop: threading.Event,
    connector: Callable[[WorkerConfig], psycopg.Connection[tuple[object, ...]]] = connect,
) -> None:
    """Take and run jobs until ``stop`` is set, reconnecting when the database goes away.

    Args:
        cfg: Worker configuration.
        stop: Set to stop; a running run stops between steps.
        connector: Opens a database connection.
    """
    backoff = 1.0
    waiting = False
    while not stop.is_set():
        try:
            with connector(cfg) as conn:
                queue = Queue(conn)
                backoff = 1.0
                while not stop.is_set():
                    try:
                        job = queue.fetch()
                    except (psycopg.errors.UndefinedTable, psycopg.errors.InsufficientPrivilege):
                        # pg-boss is installed by the API when it queues the first run.
                        if not waiting:
                            log.info("waiting for the API to set up the run queue")
                            waiting = True
                        stop.wait(IDLE_WAIT_S * 5)
                        continue
                    waiting = False
                    if job is None:
                        stop.wait(IDLE_WAIT_S)
                        continue
                    process(conn, queue, job, stop)
        except psycopg.OperationalError as e:
            log.warning(
                "database not reachable", error=str(e).splitlines()[0] if str(e) else "", retry_s=backoff
            )
            stop.wait(backoff)
            backoff = min(backoff * 2, MAX_BACKOFF_S)


def main() -> int:
    """Start the worker and run jobs until SIGTERM.

    Returns:
        Process exit code: 0 on clean shutdown, 78 (EX_CONFIG) on invalid configuration.
    """
    structlog.configure(
        processors=[structlog.processors.TimeStamper(fmt="iso"), structlog.processors.JSONRenderer()]
    )
    try:
        cfg = load_config()
    except ConfigError as e:
        print(e, file=sys.stderr)
        return 78
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    log.info("worker started", version=__version__, db_host=cfg.db_host)
    work(cfg, stop)
    log.info("worker stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
