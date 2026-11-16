-- 0010: demand model runs (ADR-0019) and the files a run saves next to its result.
-- A demand run takes the Demand section's bundle (contracts/demand-input.schema.json: zones, the streets of the
-- model area and the published lines) in `network`, and the project's demand values in `input`. It saves the
-- origin–destination matrices per mode and period as an OMX file, which is too large for the result itself.

ALTER TABLE simulation.run DROP CONSTRAINT run_kind_check;
ALTER TABLE simulation.run ADD CONSTRAINT run_kind_check CHECK (kind IN ('capacity', 'sweep', 'road', 'demand'));

CREATE TABLE simulation.run_file (
  run_id     uuid NOT NULL REFERENCES simulation.run (id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (name ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  media_type text NOT NULL CHECK (length(media_type) <= 100),
  content    bytea NOT NULL CHECK (length(content) <= 268435456),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, name)
);

GRANT SELECT, DELETE ON simulation.run_file TO mobsimlab_app;
-- The worker only adds the files of the run it is running (runner.py checks the run is still running).
GRANT INSERT ON simulation.run_file TO mobsimlab_worker;
