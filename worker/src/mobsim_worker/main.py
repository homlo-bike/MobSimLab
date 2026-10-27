"""Worker entry point. Job processing (pg-boss queue) is added in Phase 5."""

from __future__ import annotations

import signal
import sys
import threading

import structlog

from mobsim_worker import __version__
from mobsim_worker.config import ConfigError, load_config


def main() -> int:
    """Start the worker and wait for jobs until SIGTERM.

    Returns:
        Process exit code: 0 on clean shutdown, 78 (EX_CONFIG) on invalid configuration.
    """
    structlog.configure(
        processors=[structlog.processors.TimeStamper(fmt="iso"), structlog.processors.JSONRenderer()]
    )
    log = structlog.get_logger("mobsim_worker")
    try:
        cfg = load_config()
    except ConfigError as e:
        print(e, file=sys.stderr)
        return 78
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    log.info("worker started", version=__version__, db_host=cfg.db_host)
    stop.wait()
    log.info("worker stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
