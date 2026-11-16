-- 0009: the road simulation (Phase 5, 07-simulation §3): street lines, depots and background traffic in SUMO.
-- A road run stores the street tiles it was built from in `network` (JSON: {"tiles": [OSM XML, ...]}) and the
-- scenario the simulator panel built from the project (street lines, depots, street setup) in `lines`. The street
-- tiles of a city can be larger than a rail topology, so the size limit of `network` grows to 64 MB.
-- The replay of a road run (positions of the street line vehicles) is gzipped JSON in its own table, so the run
-- list and the run's result stay small.

ALTER TABLE simulation.run DROP CONSTRAINT run_kind_check;
ALTER TABLE simulation.run ADD CONSTRAINT run_kind_check CHECK (kind IN ('capacity', 'sweep', 'road'));

ALTER TABLE simulation.run DROP CONSTRAINT run_network_check;
ALTER TABLE simulation.run ADD CONSTRAINT run_network_check CHECK (length(network) <= 67108864);

CREATE TABLE simulation.run_replay (
  run_id     uuid PRIMARY KEY REFERENCES simulation.run (id) ON DELETE CASCADE,
  -- Gzipped JSON (worker/src/mobsim_worker/jobs/road/sim.py `pack_replay`).
  data       bytea NOT NULL CHECK (octet_length(data) <= 67108864),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, DELETE ON simulation.run_replay TO mobsimlab_app;
-- The worker writes a run's replay once, when the run ends.
GRANT INSERT ON simulation.run_replay TO mobsimlab_worker;
