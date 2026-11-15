-- 0006: installed plugins, trusted publisher keys and plugins per project (ADR-0036 §9, Phase 1).
-- Admins install plugin packages instance-wide; a project's Owner turns plugins on for the project and pins the
-- version. Bundled plugins ship with the image and are not stored here; a project row only records a change
-- from their default (on). The API checks every package (apps/api/src/plugins) before a row is written.

CREATE SCHEMA plugin;
GRANT USAGE ON SCHEMA plugin TO mobsimlab_app;

-- Only an Owner may allow unsigned plugins, and only while the instance runs in development mode.
ALTER TABLE iam.instance ADD COLUMN allow_unsigned_plugins boolean NOT NULL DEFAULT false;

-- Publisher keys an Admin trusts. A package signed by one of them can be installed.
CREATE TABLE plugin.trusted_key (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  public_key  text NOT NULL CHECK (length(public_key) <= 4000),
  -- SHA-256 of the DER public key, hex.
  fingerprint text NOT NULL UNIQUE CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  added_by    uuid REFERENCES iam."user" (id),
  added_at    timestamptz NOT NULL DEFAULT now()
);

-- One row per installed version. `entry` is what the web app's registry needs; `manifest` is kept as uploaded.
CREATE TABLE plugin.package (
  plugin_id    text NOT NULL CHECK (plugin_id ~ '^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*){2,}$'),
  version      text NOT NULL CHECK (length(version) BETWEEN 5 AND 64),
  manifest     jsonb NOT NULL,
  entry        jsonb NOT NULL CHECK (pg_column_size(entry) < 8388608),
  -- SHA-256 of the whole package file, which results and project files record (ADR-0036 §9).
  sha256       text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes   integer NOT NULL CHECK (size_bytes > 0),
  signature    text NOT NULL CHECK (signature IN ('trusted', 'unsigned')),
  signed_by    uuid REFERENCES plugin.trusted_key (id) ON DELETE SET NULL,
  signer_name  text,
  installed_by uuid REFERENCES iam."user" (id),
  installed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plugin_id, version)
);

-- Plugins per project. For an installed plugin, `version` is the pinned version; for a bundled plugin it is null.
CREATE TABLE project.plugin (
  project_id uuid NOT NULL REFERENCES project.project (id) ON DELETE CASCADE,
  plugin_id  text NOT NULL CHECK (length(plugin_id) <= 200),
  enabled    boolean NOT NULL,
  version    text CHECK (length(version) <= 64),
  updated_by uuid REFERENCES iam."user" (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, plugin_id)
);
CREATE INDEX project_plugin_plugin_idx ON project.plugin (plugin_id) WHERE enabled;

GRANT SELECT, INSERT, DELETE ON plugin.trusted_key TO mobsimlab_app;
GRANT SELECT, INSERT, DELETE ON plugin.package TO mobsimlab_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON project.plugin TO mobsimlab_app;
