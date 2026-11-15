-- 0007: simulation runs saved with the project, run by the background worker (ADR-0003, ADR-0023).
-- The API stores a run and queues a pg-boss job naming it; a sim-worker process takes the job, writes progress
-- while it runs and the result when it is done. Every member who can read the project sees its runs.
-- Phase 1 has one kind: the rail capacity run of the simulator tab (crates/rail-sim/src/capacity.rs).

CREATE SCHEMA simulation;
GRANT USAGE ON SCHEMA simulation TO mobsimlab_app, mobsimlab_worker;

CREATE TABLE simulation.run (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES project.project (id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('capacity')),
  status           text NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  -- Settings of the run (period, advanced settings, sweep on or off) and the names of the input files.
  input            jsonb NOT NULL CHECK (pg_column_size(input) < 65536),
  -- The network: 'example:metro' or the railway editor's topology export, and the lines file, as uploaded.
  network          text NOT NULL CHECK (length(network) <= 8388608),
  lines            text NOT NULL CHECK (length(lines) <= 8388608),
  -- What the worker has found so far (the planned period, sweep points) and what it is doing now.
  progress         jsonb CHECK (pg_column_size(progress) < 8388608),
  result           jsonb CHECK (pg_column_size(result) < 8388608),
  error            text CHECK (length(error) <= 2000),
  cancel_requested boolean NOT NULL DEFAULT false,
  -- The pg-boss job that runs it, so the API can tell when a worker stopped without finishing.
  job_id           uuid,
  created_by       uuid REFERENCES iam."user" (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  started_at       timestamptz,
  finished_at      timestamptz
);
CREATE INDEX run_project_created ON simulation.run (project_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON simulation.run TO mobsimlab_app;
-- The worker reads what to run and writes only how the run goes (03 §1: a restricted role).
GRANT SELECT (id, kind, status, input, network, lines, cancel_requested) ON simulation.run TO mobsimlab_worker;
GRANT UPDATE (status, progress, result, error, started_at, finished_at) ON simulation.run TO mobsimlab_worker;

-- pg-boss keeps its queue in this schema. The API installs and upgrades the tables when it first queues a job
-- (they belong to the app role) and lets the worker take and settle jobs (apps/api/src/simulation/queue.ts).
CREATE SCHEMA pgboss;
GRANT USAGE, CREATE ON SCHEMA pgboss TO mobsimlab_app;
GRANT USAGE ON SCHEMA pgboss TO mobsimlab_worker;
