-- 0016: comments on the objects of a project (10 §1.2, 04 §2.2): stations, tracks, switches, signals, street lines,
-- rail service lines and depots. A comment points at its object by (object_type, object_id), so threads work for
-- every kind of object without a column per kind. A thread is a first comment and its replies (one level deep);
-- the first comment carries whether the thread is resolved. Owners, Editors and Commenters write; everyone who can
-- read the project reads. Types and ids are checked by the API (apps/api/src/comments).

CREATE SCHEMA collab;
GRANT USAGE ON SCHEMA collab TO mobsimlab_app;

CREATE TABLE collab.comment (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project.project (id) ON DELETE CASCADE,
  object_type text NOT NULL CHECK (object_type ~ '^[a-z][a-z-]{1,39}$'),
  object_id   text NOT NULL CHECK (length(object_id) BETWEEN 1 AND 100),
  -- The thread's first comment; null for the first comment itself. Deleting it deletes the replies.
  parent_id   uuid REFERENCES collab.comment (id) ON DELETE CASCADE,
  body        text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  author_id   uuid REFERENCES iam."user" (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  edited_at   timestamptz,
  -- Set on a thread's first comment when someone marks the thread resolved.
  resolved_at timestamptz,
  resolved_by uuid REFERENCES iam."user" (id),
  CHECK (parent_id IS NULL OR resolved_at IS NULL)
);
CREATE INDEX comment_project_idx ON collab.comment (project_id, created_at);
CREATE INDEX comment_parent_idx ON collab.comment (parent_id) WHERE parent_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON collab.comment TO mobsimlab_app;
