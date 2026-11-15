"""Thin pg-boss client: take, beat and settle simulation run jobs (ADR-0023).

The API sends jobs with pg-boss (``apps/api/src/simulation/queue.ts``), which also owns the schema, its
upgrades and its supervisor (expiry, lost heartbeats, retention). The worker only runs the statements below.
They follow pg-boss 12.38's own ``fetchNextJob``, ``touchJobs``, ``completeJobs`` and ``failJobsById`` for a
queue with the ``standard`` policy and no retries, and every settle is fenced on the attempt (``retry_count``)
the worker took, as pg-boss does. The API's integration test runs this module against a real pg-boss install,
so an upgrade of pg-boss that changes these tables fails there first.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from psycopg.types.json import Jsonb

#: Queue name, as in apps/api/src/simulation/queue.ts (the schema there is ``pgboss``).
RUN_QUEUE = "simulation-run"

FETCH = """
WITH next AS (
  SELECT id FROM pgboss.job
  WHERE name = %(name)s AND state < 'active' AND NOT blocked AND start_after <= pgboss.job_now()
  ORDER BY priority DESC, created_on
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
UPDATE pgboss.job j SET
  state = 'active',
  started_on = pgboss.job_now(),
  heartbeat_on = pgboss.job_now(),
  retry_count = CASE WHEN j.started_on IS NOT NULL THEN j.retry_count + 1 ELSE j.retry_count END
FROM next
WHERE j.name = %(name)s AND j.id = next.id
RETURNING j.id::text, j.data, j.retry_count
"""

# Every settle names the attempt the worker took, as pg-boss's attempt fence does.
TOUCH = """
UPDATE pgboss.job SET heartbeat_on = pgboss.job_now()
WHERE name = %(name)s AND id = %(id)s::uuid AND state = 'active' AND retry_count = %(attempt)s
"""

COMPLETE = """
UPDATE pgboss.job SET state = 'completed', completed_on = pgboss.job_now(), output = %(output)s
WHERE name = %(name)s AND id = %(id)s::uuid AND state = 'active' AND retry_count = %(attempt)s
"""

FAIL = """
UPDATE pgboss.job
SET state = 'failed', completed_on = pgboss.job_now(), heartbeat_on = NULL, output = %(output)s
WHERE name = %(name)s AND id = %(id)s::uuid AND state = 'active' AND retry_count = %(attempt)s
"""


class Connection(Protocol):
    """The part of a psycopg connection (autocommit) the queue uses."""

    def execute(self, query: Any, params: Any = ...) -> Any:  # noqa: D102
        ...


@dataclass(frozen=True)
class Job:
    """A job the worker has taken.

    Attributes:
        id: pg-boss job ID.
        data: The job's data (``{"runId": ...}``).
        attempt: ``retry_count`` at the time it was taken; it names this attempt.
    """

    id: str
    data: dict[str, Any]
    attempt: int


class Queue:
    """Takes and settles jobs of one pg-boss queue."""

    def __init__(self, conn: Connection, name: str = RUN_QUEUE) -> None:
        """Create a client.

        Args:
            conn: An autocommit connection as the ``mobsimlab_worker`` role.
            name: Queue name.
        """
        self.conn = conn
        self.name = name

    def fetch(self) -> Job | None:
        """Take the next job, if any.

        Returns:
            The job, now active, or None when the queue is empty.
        """
        row = self.conn.execute(FETCH, {"name": self.name}).fetchone()
        if row is None:
            return None
        job_id, data, attempt = row
        return Job(id=str(job_id), data=dict(data or {}), attempt=int(attempt))

    def touch(self, job: Job) -> bool:
        """Beat the job's heartbeat, so pg-boss's supervisor knows the worker is alive.

        Returns:
            False if the job is no longer this worker's (it expired or was settled elsewhere).
        """
        return self._settle(TOUCH, job, None)

    def complete(self, job: Job, output: dict[str, Any] | None = None) -> bool:
        """Mark the job completed.

        Returns:
            False if the job is no longer this worker's.
        """
        return self._settle(COMPLETE, job, output)

    def fail(self, job: Job, message: str) -> bool:
        """Mark the job failed (the queue does not retry).

        Returns:
            False if the job is no longer this worker's.
        """
        return self._settle(FAIL, job, {"message": message})

    def _settle(self, sql: str, job: Job, output: dict[str, Any] | None) -> bool:
        params = {
            "name": self.name,
            "id": job.id,
            "attempt": job.attempt,
            "output": None if output is None else Jsonb(output),
        }
        cur = self.conn.execute(sql, params)
        return bool(cur.rowcount)
