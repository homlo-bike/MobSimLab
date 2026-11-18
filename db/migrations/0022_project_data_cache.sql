-- 0022: data a project's tools fetched live because the project's imports did not hold it (#140 steps 3 and 4):
-- OpenStreetMap tiles outside the OSM import, terrain heights outside the elevation import, and the location
-- facts looked up once (country, public holidays, climate). Stored per project and served to every tool next
-- time, so nothing is downloaded twice. kind: osm, height, facts; key: the request (tile, rounded point, query).

CREATE TABLE project.data_cache (
  project_id uuid        NOT NULL REFERENCES project.project (id) ON DELETE CASCADE,
  kind       text        NOT NULL CHECK (kind IN ('osm', 'height', 'facts')),
  key        text        NOT NULL CHECK (length(key) BETWEEN 1 AND 300),
  body       text        NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, kind, key)
);
