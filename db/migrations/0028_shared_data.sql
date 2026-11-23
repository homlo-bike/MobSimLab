-- 0028: map data held once for the instance (large-area projects, step 4). OpenStreetMap tiles and terrain heights
-- fetched live, and the GLO-30 byte ranges read from the Copernicus bucket, are stored once in geo.shared_data,
-- keyed by kind, key (the tile, rounded point or byte range) and data date (when it was fetched). A project points
-- at the copies its tools used (project.data_use), so its data stays the same until it is fetched again, and a
-- second project in the same area uses the copies already held instead of downloading them again.
-- kind: osm (a street, rail, walk, building or place tile), height (a rounded point), glo30 (a byte range of a
-- GLO-30 cell file; an empty body: the cell does not exist).

CREATE TABLE geo.shared_data (
  id        bigserial PRIMARY KEY,
  kind      text        NOT NULL CHECK (kind IN ('osm', 'height', 'glo30')),
  key       text        NOT NULL CHECK (length(key) BETWEEN 1 AND 300),
  data_date timestamptz NOT NULL DEFAULT now(),
  body      bytea       NOT NULL CHECK (octet_length(body) <= 67108864),
  UNIQUE (kind, key, data_date)
);
CREATE INDEX shared_data_newest_idx ON geo.shared_data (kind, key, data_date DESC);

CREATE TABLE project.data_use (
  project_id uuid   NOT NULL REFERENCES project.project (id) ON DELETE CASCADE,
  kind       text   NOT NULL CHECK (kind IN ('osm', 'height')),
  key        text   NOT NULL,
  shared_id  bigint NOT NULL REFERENCES geo.shared_data (id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, kind, key)
);
CREATE INDEX data_use_shared_idx ON project.data_use (shared_id);

GRANT SELECT, INSERT, DELETE ON geo.shared_data TO mobsimlab_app;
GRANT USAGE ON SEQUENCE geo.shared_data_id_seq TO mobsimlab_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON project.data_use TO mobsimlab_app;

-- The tiles and heights each project kept (0022) move to the shared store; equal copies are held once.
INSERT INTO geo.shared_data (kind, key, data_date, body)
SELECT DISTINCT ON (kind, key, fetched_at) kind, key, fetched_at, convert_to(body, 'UTF8')
FROM project.data_cache
WHERE kind IN ('osm', 'height')
ORDER BY kind, key, fetched_at
ON CONFLICT DO NOTHING;

INSERT INTO project.data_use (project_id, kind, key, shared_id)
SELECT c.project_id, c.kind, c.key, s.id
FROM project.data_cache c
JOIN geo.shared_data s ON s.kind = c.kind AND s.key = c.key AND s.data_date = c.fetched_at
WHERE c.kind IN ('osm', 'height');

DELETE FROM project.data_cache WHERE kind IN ('osm', 'height');
