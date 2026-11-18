-- 0023: the project's noise map (GIS tab, Map data), saved with the project so it shows again without running it
-- once more; the planner recalculates it when the design changes. One result per project, replaced by the next.
-- body: the result as gzip-compressed JSON written by the web app (features/noise/saved.ts), at most 64 MB.

CREATE TABLE project.noise_result (
  project_id  uuid        PRIMARY KEY REFERENCES project.project (id) ON DELETE CASCADE,
  body        bytea       NOT NULL CHECK (octet_length(body) BETWEEN 1 AND 67108864),
  computed_by uuid        REFERENCES iam."user" (id) ON DELETE SET NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON project.noise_result TO mobsimlab_app;
