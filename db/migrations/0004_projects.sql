-- 0004: projects, project memberships and per-user preferences (05 §3.2 project roles, 04 §2 Project context).
-- A project is owned by exactly one member with role 'owner'. Archived projects are hidden from home but kept;
-- deleted projects stay in the bin (deleted_at set) for 30 days before a purge job removes them.

CREATE SCHEMA project;
GRANT USAGE ON SCHEMA project TO mobsimlab_app;

-- Per-user settings that follow the person to other devices: language ('system' or a BCP 47 tag), units, theme.
ALTER TABLE iam."user" ADD COLUMN preferences jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(preferences) = 'object' AND pg_column_size(preferences) < 4096);

CREATE TABLE project.project (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  area_name   text CHECK (length(area_name) <= 200),
  -- Modes the project plans to use; only decides which design rules and vehicles are loaded.
  modes       text[] NOT NULL DEFAULT '{}' CHECK (cardinality(modes) <= 20),
  -- Anyone signed in to this instance may open the project read-only through its link.
  link_access boolean NOT NULL DEFAULT false,
  copied_from uuid REFERENCES project.project (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  deleted_at  timestamptz
);

CREATE TABLE project.member (
  project_id uuid NOT NULL REFERENCES project.project (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES iam."user" (id),
  role       text NOT NULL CHECK (role IN ('owner', 'editor', 'commenter', 'viewer')),
  added_by   uuid REFERENCES iam."user" (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
CREATE UNIQUE INDEX member_one_owner ON project.member (project_id) WHERE role = 'owner';
CREATE INDEX member_user_idx ON project.member (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON project.project, project.member TO mobsimlab_app;
