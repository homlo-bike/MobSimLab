-- 0012: plugins that run their own code (ADR-0036 Phase 2). An installed plugin may bring WebAssembly components
-- (calculations, importers, exporters) and pages for its own tabs. The API checks and compiles each component in
-- the sandboxed tool-runner when the plugin is installed and keeps what the hosts run here, next to the tab
-- pages; the browser and the tool-runner run the code with the instance's memory and time limits.

-- Limits for plugin code, set by Admins: memory per call (MB) and time per call (seconds).
ALTER TABLE iam.instance
  ADD COLUMN plugin_memory_mb integer NOT NULL DEFAULT 256 CHECK (plugin_memory_mb BETWEEN 16 AND 2048),
  ADD COLUMN plugin_time_s integer NOT NULL DEFAULT 30 CHECK (plugin_time_s BETWEEN 1 AND 600);

-- Files of an installed version that the app serves: `code/<component>/<file>` (jco glue and core modules of
-- each component) and `ui/<path>` (tab pages and their scripts, styles, images and fonts).
CREATE TABLE plugin.file (
  plugin_id  text NOT NULL,
  version    text NOT NULL,
  path       text NOT NULL CHECK (path ~ '^(code|ui)/[A-Za-z0-9_./-]{1,240}$' AND path !~ '\.\.'),
  media_type text NOT NULL CHECK (length(media_type) <= 100),
  data       bytea NOT NULL CHECK (octet_length(data) <= 16777216),
  sha256     text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (plugin_id, version, path),
  FOREIGN KEY (plugin_id, version) REFERENCES plugin.package (plugin_id, version) ON DELETE CASCADE
);

GRANT SELECT, INSERT, DELETE ON plugin.file TO mobsimlab_app;
