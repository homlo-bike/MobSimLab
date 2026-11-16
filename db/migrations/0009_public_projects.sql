-- 0009: public projects (FR-PLAT-02, 10 §1.1). A project is private (only its members open it) or public (anyone
-- signed in to this instance can find it on the projects home and open it read-only). Visitors who are not signed
-- in never see projects. Public replaces the view-only link of 0004: projects that had the link on become private,
-- because making a project public is an Owner's choice with a licence notice and an audit record.

ALTER TABLE project.project
  ADD COLUMN visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public'));
ALTER TABLE project.project DROP COLUMN link_access;

CREATE INDEX project_public_idx ON project.project (updated_at DESC)
  WHERE visibility = 'public' AND deleted_at IS NULL AND archived_at IS NULL;
