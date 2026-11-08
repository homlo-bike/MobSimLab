-- 0005: what planners draw in a project, saved with the project (10 §1.2 optimistic locking).
-- One document per project and kind: the street line, the railway design, the GIS street setups. Each save
-- replaces the document and adds 1 to `version`; a save based on an older version is refused (HTTP 409), so two
-- people never silently overwrite each other. Kinds are checked by the API (apps/api/src/projects/drawings.ts).

CREATE TABLE project.drawing (
  project_id     uuid NOT NULL REFERENCES project.project (id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9-]{1,39}$'),
  -- Shape of `doc` for this kind, so later releases can upgrade old documents.
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
  doc            jsonb NOT NULL CHECK (pg_column_size(doc) < 16777216),
  version        integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_by     uuid REFERENCES iam."user" (id),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, kind)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON project.drawing TO mobsimlab_app;
