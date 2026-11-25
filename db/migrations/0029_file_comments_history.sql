-- 0029: comments and the history of changed values carried in a .mslab project file (ADR-0021, format 1.5). The
-- people who wrote them may not exist on the instance that opens the file, so an opened comment keeps its author's
-- and resolver's names as text, and the opened history goes to its own table: read-only, shown after the new
-- project's own changes and marked as coming from the file.

ALTER TABLE collab.comment
  ADD COLUMN from_file        boolean NOT NULL DEFAULT false,
  ADD COLUMN file_author      text CHECK (length(file_author) <= 200),
  ADD COLUMN file_resolved_by text CHECK (length(file_resolved_by) <= 200);

CREATE TABLE project.file_value_history (
  project_id uuid NOT NULL REFERENCES project.project (id) ON DELETE CASCADE,
  -- Order in the file, newest first (0 is the newest change).
  n          integer NOT NULL CHECK (n >= 0),
  at         timestamptz NOT NULL,
  by_name    text CHECK (length(by_name) <= 200),
  action     text NOT NULL CHECK (action IN ('changed', 'reason')),
  value_id   text NOT NULL CHECK (length(value_id) BETWEEN 1 AND 120),
  before     jsonb CHECK (pg_column_size(before) < 4096),
  after      jsonb CHECK (pg_column_size(after) < 4096),
  reason     text CHECK (length(reason) <= 500),
  PRIMARY KEY (project_id, n)
);

GRANT SELECT, INSERT, DELETE ON project.file_value_history TO mobsimlab_app;

-- A demand run opened from a file brings its saved files (the OD matrices) back with it.
GRANT INSERT ON simulation.run_file TO mobsimlab_app;
