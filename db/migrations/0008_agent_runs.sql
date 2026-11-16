-- 0008: simulation runs started by AI agents, and settings sweeps (ADR-0035 §7).
-- A sweep runs the rail capacity run once per variant of its settings (a grid or a Latin hypercube) in one
-- job, so an agent tunes numbers without one call per variant. A run an agent started names the agent
-- connection, so the API can hold each connection to its limit of runs at once.

ALTER TABLE simulation.run DROP CONSTRAINT run_kind_check;
ALTER TABLE simulation.run ADD CONSTRAINT run_kind_check CHECK (kind IN ('capacity', 'sweep'));

ALTER TABLE simulation.run
  ADD COLUMN agent_connection_id uuid REFERENCES agent.connection (id) ON DELETE SET NULL;
CREATE INDEX run_agent_open ON simulation.run (agent_connection_id)
  WHERE agent_connection_id IS NOT NULL AND status IN ('queued', 'running');
