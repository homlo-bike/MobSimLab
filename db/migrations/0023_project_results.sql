-- 0023: results the project's tools worked out, saved with the project so they show again without working them
-- out once more: the noise map (GIS tab, Map data), the walk coverage and stop spacing, the benefit tables'
-- journey planner step, and the other calculations listed in apps/api/src/projects/results.ts. One result per
-- project and kind, replaced by the next. `inputs` is the fingerprint of what the result was worked out from:
-- when the project's inputs give another fingerprint, the app shows the result as out of date. body: the result
-- as gzip-compressed JSON written by the web app (apps/web/src/projects/results.ts), at most 64 MB.

CREATE TABLE project.result (
  project_id  uuid        NOT NULL REFERENCES project.project (id) ON DELETE CASCADE,
  kind        text        NOT NULL CHECK (kind ~ '^[a-z][a-z0-9-]{1,39}$'),
  inputs      text        NOT NULL CHECK (inputs ~ '^[A-Za-z0-9._:-]{0,200}$'),
  body        bytea       NOT NULL CHECK (octet_length(body) BETWEEN 1 AND 67108864),
  computed_by uuid        REFERENCES iam."user" (id) ON DELETE SET NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, kind)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON project.result TO mobsimlab_app;
