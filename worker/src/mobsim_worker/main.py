"""Worker entry point: takes simulation run jobs from the pg-boss queue and runs them.

Each worker process runs one job at a time. With ``MOBSIMLAB_SIM_WORKERS`` above 1, the entry point starts
that many worker processes and supervises them (a process that dies is started again); the queue's
``SKIP LOCKED`` fetch gives every job to exactly one of them. Processes rather than threads, so that runs
use separate CPU cores.
"""

from __future__ import annotations

import multiprocessing
import signal
import sys
import threading
import time
from collections.abc import Callable
from multiprocessing.process import BaseProcess

import psycopg
import structlog

from mobsim_worker import __version__
from mobsim_worker.config import ConfigError, WorkerConfig, load_config
from mobsim_worker.logsink import DatabaseSink, redact_event
from mobsim_worker.queue import Queue
from mobsim_worker.runner import StopSignal, process

#: Seconds to wait when the queue is empty.
IDLE_WAIT_S = 2.0

#: Longest wait between attempts to reach the database.
MAX_BACKOFF_S = 30.0

#: Seconds to wait before starting again a worker process that died, doubled while it keeps dying.
RESTART_WAIT_S = 1.0

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
    stop: StopSignal,
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


def log_connection(cfg: WorkerConfig) -> psycopg.Connection[tuple[object, ...]]:
    """Open the connection the log sink stores WARN+ entries on (separate from the job connection)."""
    return psycopg.connect(
        host=cfg.db_host,
        port=cfg.db_port,
        dbname=cfg.db_name,
        user="mobsimlab_worker",
        password=cfg.db_password,
        application_name="mobsimlab-worker-logs",
        autocommit=True,
        connect_timeout=3,
    )


def configure_logging(cfg: WorkerConfig | None = None) -> None:
    """Log redacted JSON lines with their level to stdout, and WARN+ to the database (ADR-0022).

    Args:
        cfg: Worker configuration; without it (before it is loaded) nothing goes to the database.
    """
    processors: list[structlog.typing.Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        redact_event,
    ]
    if cfg is not None:
        processors.append(DatabaseSink(lambda: log_connection(cfg)))
    processors.append(structlog.processors.JSONRenderer())
    structlog.configure(processors=processors)


def child(cfg: WorkerConfig, stop: StopSignal, index: int) -> None:
    """Run one worker process until ``stop`` is set (the supervisor sets it on SIGTERM)."""
    configure_logging(cfg)
    # The supervisor decides when to stop; a signal sent to the whole process group must not stop a run early.
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    structlog.contextvars.bind_contextvars(worker=index)
    log.info("worker process started", worker=index)
    work(cfg, stop)


def supervise(
    cfg: WorkerConfig,
    stop: StopSignal,
    target: Callable[[WorkerConfig, StopSignal, int], None] = child,
    poll_s: float = 0.5,
) -> None:
    """Keep ``cfg.sim_workers`` worker processes running until ``stop`` is set, then stop them and wait.

    Args:
        cfg: Worker configuration.
        stop: Set by the signal handlers (a ``threading.Event``: a ``multiprocessing`` event cannot be set
            from a signal handler while the same thread waits on it).
        target: What each process runs (tests pass a stand-in).
        poll_s: Seconds between checks of the processes.
    """
    ctx = multiprocessing.get_context("spawn")
    children = ctx.Event()
    procs: dict[int, BaseProcess] = {}
    waits = dict.fromkeys(range(cfg.sim_workers), RESTART_WAIT_S)
    due = dict.fromkeys(range(cfg.sim_workers), 0.0)
    while True:
        if not stop.is_set():
            now = time.monotonic()
            for i in range(cfg.sim_workers):
                p = procs.get(i)
                if p is not None and p.is_alive():
                    continue
                if p is not None:
                    # It died without being asked to stop: start it again, waiting longer each time.
                    log.warning("worker process stopped", worker=i, exitcode=p.exitcode, restart_s=waits[i])
                    due[i] = now + waits[i]
                    waits[i] = min(waits[i] * 2, MAX_BACKOFF_S)
                    del procs[i]
                    continue
                if now >= due[i]:
                    procs[i] = ctx.Process(target=target, args=(cfg, children, i), name=f"mobsim-worker-{i}")
                    procs[i].start()
        if stop.wait(poll_s):
            break
    children.set()
    for p in procs.values():
        p.join()


def main() -> int:
    """Start the worker and run jobs until SIGTERM.

    Returns:
        Process exit code: 0 on clean shutdown, 78 (EX_CONFIG) on invalid configuration.
    """
    configure_logging()
    try:
        cfg = load_config()
    except ConfigError as e:
        print(e, file=sys.stderr)
        return 78
    configure_logging(cfg)
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    log.info("worker started", version=__version__, db_host=cfg.db_host, processes=cfg.sim_workers)
    if cfg.sim_workers == 1:
        work(cfg, stop)
    else:
        supervise(cfg, stop)
    log.info("worker stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
