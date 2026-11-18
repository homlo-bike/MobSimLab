-- 0026: which comments each person has read, for the notices of new comments and replies in a project's bell
-- (Damascus test: an Owner had no way to know a Commenter had written). A comment counts as new for a member of
-- its project when someone else wrote it after they joined and they have not opened it yet; the API only looks
-- back 30 days, so rows older than that can be removed without changing what anyone sees.

CREATE TABLE collab.comment_read (
  user_id    uuid NOT NULL REFERENCES iam."user" (id) ON DELETE CASCADE,
  comment_id uuid NOT NULL REFERENCES collab.comment (id) ON DELETE CASCADE,
  read_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, comment_id)
);
CREATE INDEX comment_read_comment_idx ON collab.comment_read (comment_id);
CREATE INDEX comment_created_idx ON collab.comment (created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON collab.comment_read TO mobsimlab_app;
