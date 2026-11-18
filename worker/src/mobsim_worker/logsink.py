"""Redaction and the database log sink of the worker (ADR-0022, 03 §6).

The worker logs JSON lines to stdout. Every entry is redacted first with the shared deny-list
(``contracts/log-redaction.json``). WARN, ERROR and CRITICAL entries are also stored in ``logs.entry`` with
origin ``worker``, through ``logs.append_worker`` (``db/migrations/0010_logs.sql``), on a connection of their
own. A store that fails is dropped: logging never stops a run.
"""

from __future__ import annotations

import json
import re
import time
import uuid
from collections.abc import Callable, MutableMapping
from typing import Any

import psycopg

#: Shared deny-list: the same words as ``contracts/log-redaction.json``
#: (apps/api/test/logging.test.ts checks that they match).
REDACT_KEYS = (
    "password",
    "passwd",
    "passphrase",
    "secret",
    "token",
    "authorization",
    "cookie",
    "apikey",
    "credential",
    "privatekey",
    "session",
    "codeverifier",
    "nonce",
)

#: What a redacted value is replaced by.
REDACTED = "[REDACTED]"

#: structlog method names of the levels the database takes, and their stored names.
STORED_LEVELS = {
    "warning": "WARN",
    "warn": "WARN",
    "error": "ERROR",
    "exception": "ERROR",
    "critical": "CRITICAL",
    "fatal": "CRITICAL",
}

#: Seconds to wait after a failed store before trying the database again.
RETRY_S = 30.0

#: Longest stored context, in characters of JSON.
MAX_CONTEXT = 12_000

_MAX_DEPTH = 8
_INLINE_CREDENTIAL = re.compile(r"\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+", re.IGNORECASE)
#: Keys in a web address's query, as in ``?token=…``, ``&apikey=…`` or ``&key=…``.
_QUERY_CREDENTIAL = re.compile(
    r"([?&;][A-Za-z0-9_.-]*(?:key|token|secret|password|passwd|sig|signature|credential)[A-Za-z0-9_.-]*=)"
    r"[^&#\s\"'<>]+",
    re.IGNORECASE,
)

APPEND = "SELECT logs.append_worker(%(level)s, %(module)s, %(message)s, %(run)s, %(context)s::jsonb)"

#: Fields that are not part of the stored context.
_OWN_FIELDS = {"event", "level", "timestamp", "run"}


def is_secret_key(key: str) -> bool:
    """Tell whether a field name holds a secret.

    Args:
        key: Field name.

    Returns:
        True when the name, lower-cased and without ``-`` and ``_``, contains a deny-list word.
    """
    k = key.lower().replace("-", "").replace("_", "")
    return any(w in k for w in REDACT_KEYS)


def redact(value: Any, depth: int = 0) -> Any:
    """Return a copy of a value that is safe to log.

    Args:
        value: Any value.
        depth: Nesting level (internal).

    Returns:
        The value with secret fields replaced by ``REDACTED`` and inline credentials masked.
    """
    if isinstance(value, str):
        return _QUERY_CREDENTIAL.sub(rf"\1{REDACTED}", _INLINE_CREDENTIAL.sub(rf"\1 {REDACTED}", value))
    if depth >= _MAX_DEPTH:
        return "[TRUNCATED]"
    if isinstance(value, dict):
        return {k: REDACTED if is_secret_key(str(k)) else redact(v, depth + 1) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [redact(v, depth + 1) for v in value[:100]]
    return value


def redact_event(_logger: object, _method: str, event: MutableMapping[str, Any]) -> MutableMapping[str, Any]:
    """Redact every field of an entry, for every sink (a structlog processor)."""
    return {k: REDACTED if is_secret_key(str(k)) else redact(v) for k, v in event.items()}


class DatabaseSink:
    """structlog processor that stores WARN+ entries in ``logs.entry``.

    Args:
        connector: Opens an autocommit connection as the ``mobsimlab_worker`` role.
        clock: Monotonic clock (tests pass a stand-in).
    """

    def __init__(
        self,
        connector: Callable[[], psycopg.Connection[tuple[object, ...]]],
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        """Keep the connector; the connection is opened on the first entry to store."""
        self._connector = connector
        self._clock = clock
        self._conn: psycopg.Connection[tuple[object, ...]] | None = None
        self._retry_at = 0.0

    def __call__(
        self, _logger: object, method: str, event: MutableMapping[str, Any]
    ) -> MutableMapping[str, Any]:
        """Store the entry when its level is WARN or above; pass it on unchanged."""
        level = STORED_LEVELS.get(str(event.get("level") or method).lower())
        if level is not None and self._clock() >= self._retry_at:
            try:
                self._store(level, event)
            except Exception:  # noqa: BLE001 (logging must never stop the worker)
                self._close()
                self._retry_at = self._clock() + RETRY_S
        return event

    def _store(self, level: str, event: MutableMapping[str, Any]) -> None:
        if self._conn is None or self._conn.closed:
            self._conn = self._connector()
        run = event.get("run")
        try:
            run_id = str(uuid.UUID(str(run))) if run else None
        except ValueError:
            run_id = None
        rest = {k: v for k, v in event.items() if k not in _OWN_FIELDS}
        context = json.dumps(rest, default=str) if rest else None
        if context and len(context) > MAX_CONTEXT:
            context = json.dumps({"truncated": True, "size": len(context)})
        self._conn.execute(
            APPEND,
            {
                "level": level,
                "module": "worker",
                "message": str(event.get("event", ""))[:4000],
                "run": run_id,
                "context": context,
            },
        )

    def _close(self) -> None:
        conn, self._conn = self._conn, None
        if conn is not None:
            try:
                conn.close()
            except Exception:  # noqa: BLE001, S110 (already broken)
                pass
