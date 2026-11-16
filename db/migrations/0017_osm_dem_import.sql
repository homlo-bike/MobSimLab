-- 0011: OpenStreetMap and elevation imported per project area (06-gis §2 and §4, ADR-0046).
-- The project area is the box around everything drawn in the project, buffered by `project.area_buffer_km`.
-- An import run is a row in `geo.import`. When a run finishes, the project's earlier data of the same kind is
-- replaced in one transaction, so readers always see one complete import.
-- OpenStreetMap: osm2pgsql writes into `geo_stage` (the flex style tools/osm/mobsimlab-flex.lua), and the API
-- copies the rows into the `geo.osm_*` tables below with the project and import IDs. Geometry is EPSG:4326.
-- Elevation: PostGIS raster needs a superuser to install (postgis_raster is not a trusted extension), so DEM
-- grids are stored as tiles of float32 values (deflated bytea) with their envelope as a PostGIS polygon.

CREATE SCHEMA IF NOT EXISTS geo;
GRANT USAGE ON SCHEMA geo TO mobsimlab_app;

-- osm2pgsql creates and drops its tables here, so the app role may create tables in this schema only.
CREATE SCHEMA geo_stage;
GRANT USAGE, CREATE ON SCHEMA geo_stage TO mobsimlab_app;

CREATE TABLE geo.import (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project.project (id) ON DELETE CASCADE,
  -- osm: OpenStreetMap; dem: Copernicus GLO-30; dem_upload: the planner's own elevation GeoTIFF.
  kind          text NOT NULL CHECK (kind IN ('osm', 'dem', 'dem_upload')),
  -- How the data was fetched: Overpass, a Geofabrik extract, an uploaded file, the GLO-30 bucket.
  method        text NOT NULL CHECK (method IN ('overpass', 'geofabrik', 'upload', 'copernicus', 'geotiff')),
  status        text NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  -- The area imported: [west, south, east, north] in degrees, and the buffer it includes.
  bbox          double precision[] NOT NULL CHECK (cardinality(bbox) = 4),
  buffer_km     numeric(5, 2) NOT NULL CHECK (buffer_km >= 0 AND buffer_km <= 50),
  -- What the planner chose in the import dialog (Geofabrik region, planned roads, upload name...).
  options       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(options) < 65536),
  -- {step, done, total} while running.
  progress      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(progress) < 4096),
  -- Rows per table, tiles, file sizes.
  stats         jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(stats) < 65536),
  -- The Source record (06-gis §1): name, url, licence, retrievedAt, dataTimestamp, accuracy.
  source        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(source) < 65536),
  error         text CHECK (length(error) <= 2000),
  requested_by  uuid REFERENCES iam."user" (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz
);
CREATE INDEX import_project_idx ON geo.import (project_id, kind, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON geo.import TO mobsimlab_app;

-- One table per feature class (06-gis §2.2). Columns follow the flex style; `tags` keeps every OSM tag.
CREATE TABLE geo.osm_way_road (
  id         bigserial PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES project.project (id) ON DELETE CASCADE,
  import_id  uuid NOT NULL REFERENCES geo.import (id) ON DELETE CASCADE,
  osm_type   char(1) NOT NULL,
  osm_id     bigint NOT NULL,
  tags       jsonb,
  highway    text,
  name       text,
  oneway     text,
  maxspeed   text,
  lanes      text,
  bridge     boolean,
  tunnel     boolean,
  layer      smallint,
  is_cycle   boolean,
  is_foot    boolean,
  geom       geometry(LineString, 4326) NOT NULL
);

CREATE TABLE geo.osm_way_rail (
  id         bigserial PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES project.project (id) ON DELETE CASCADE,
  import_id  uuid NOT NULL REFERENCES geo.import (id) ON DELETE CASCADE,
  osm_type   char(1) NOT NULL,
  osm_id     bigint NOT NULL,
  tags       jsonb,
  railway    text,
  name       text,
  bridge     boolean,
  tunnel     boolean,
  layer      smallint,
  geom       geometry(LineString, 4326) NOT NULL
);

CREATE TABLE geo.osm_building (
  id         bigserial PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES project.project (id) ON DELETE CASCADE,
  import_id  uuid NOT NULL REFERENCES geo.import (id) ON DELETE CASCADE,
  osm_type   char(1) NOT NULL,
  osm_id     bigint NOT NULL,
  tags       jsonb,
  building   text,
  levels     text,
  height     text,
  geom       geometry(MultiPolygon, 4326) NOT NULL
);

CREATE TABLE geo.osm_landuse (
  id         bigserial PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES project.project (id) ON DELETE CASCADE,
  import_id  uuid NOT NULL REFERENCES geo.import (id) ON DELETE CASCADE,
  osm_type   char(1) NOT NULL,
  osm_id     bigint NOT NULL,
  tags       jsonb,
  class      text,
  value      text,
  geom       geometry(MultiPolygon, 4326) NOT NULL
);

CREATE TABLE geo.osm_water (
  id         bigserial PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES project.project (id) ON DELETE CASCADE,
  import_id  uuid NOT NULL REFERENCES geo.import (id) ON DELETE CASCADE,
  osm_type   char(1) NOT NULL,
  osm_id     bigint NOT NULL,
  tags       jsonb,
  class      text,
  value      text,
  geom       geometry(Geometry, 4326) NOT NULL
);

CREATE TABLE geo.osm_pt (
  id         bigserial PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES project.project (id) ON DELETE CASCADE,
  import_id  uuid NOT NULL REFERENCES geo.import (id) ON DELETE CASCADE,
  osm_type   char(1) NOT NULL,
  osm_id     bigint NOT NULL,
  tags       jsonb,
  name       text,
  kind       text,
  geom       geometry(Geometry, 4326) NOT NULL
);

CREATE TABLE geo.osm_poi (
  id         bigserial PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES project.project (id) ON DELETE CASCADE,
  import_id  uuid NOT NULL REFERENCES geo.import (id) ON DELETE CASCADE,
  osm_type   char(1) NOT NULL,
  osm_id     bigint NOT NULL,
  tags       jsonb,
  class      text,
  name       text,
  geom       geometry(Geometry, 4326) NOT NULL
);

CREATE TABLE geo.osm_barrier (
  id         bigserial PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES project.project (id) ON DELETE CASCADE,
  import_id  uuid NOT NULL REFERENCES geo.import (id) ON DELETE CASCADE,
  osm_type   char(1) NOT NULL,
  osm_id     bigint NOT NULL,
  tags       jsonb,
  barrier    text,
  geom       geometry(Geometry, 4326) NOT NULL
);

CREATE TABLE geo.osm_place (
  id         bigserial PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES project.project (id) ON DELETE CASCADE,
  import_id  uuid NOT NULL REFERENCES geo.import (id) ON DELETE CASCADE,
  osm_type   char(1) NOT NULL,
  osm_id     bigint NOT NULL,
  tags       jsonb,
  place      text,
  name       text,
  geom       geometry(Geometry, 4326) NOT NULL
);

-- Bridges and tunnels (06-gis §2.2 geo.osm_structure): every road or railway with bridge or tunnel set, with
-- its layer, so clearance checks find them without scanning both line tables.
CREATE TABLE geo.osm_structure (
  id         bigserial PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES project.project (id) ON DELETE CASCADE,
  import_id  uuid NOT NULL REFERENCES geo.import (id) ON DELETE CASCADE,
  osm_type   char(1) NOT NULL,
  osm_id     bigint NOT NULL,
  tags       jsonb,
  kind       text NOT NULL CHECK (kind IN ('bridge', 'tunnel')),
  carries    text NOT NULL CHECK (carries IN ('road', 'rail')),
  layer      smallint,
  geom       geometry(LineString, 4326) NOT NULL
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['osm_way_road', 'osm_way_rail', 'osm_building', 'osm_landuse', 'osm_water', 'osm_pt',
                           'osm_poi', 'osm_barrier', 'osm_place', 'osm_structure'] LOOP
    EXECUTE format('CREATE INDEX %I ON geo.%I USING gist (geom)', t || '_geom_idx', t);
    EXECUTE format('CREATE INDEX %I ON geo.%I (project_id)', t || '_project_idx', t);
    EXECUTE format('CREATE INDEX %I ON geo.%I (import_id)', t || '_import_idx', t);
    EXECUTE format('GRANT SELECT, INSERT, DELETE ON geo.%I TO mobsimlab_app', t);
    EXECUTE format('GRANT USAGE ON SEQUENCE geo.%I TO mobsimlab_app', t || '_id_seq');
  END LOOP;
END $$;

-- Elevation grids, cut into tiles. Values are float32, little-endian, row by row from the north-west corner,
-- deflated; NaN is no data. A tile repeats the last row and column of its neighbours, so bilinear
-- interpolation never needs a second tile. `priority`: the planner's own grid (1) wins over GLO-30 (0).
CREATE TABLE geo.dem_tile (
  id         bigserial PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES project.project (id) ON DELETE CASCADE,
  import_id  uuid NOT NULL REFERENCES geo.import (id) ON DELETE CASCADE,
  priority   smallint NOT NULL DEFAULT 0,
  width      integer NOT NULL CHECK (width BETWEEN 1 AND 4096),
  height     integer NOT NULL CHECK (height BETWEEN 1 AND 4096),
  -- Centre of the north-west pixel, and the pixel size, in degrees.
  origin_lon double precision NOT NULL,
  origin_lat double precision NOT NULL,
  step_lon   double precision NOT NULL CHECK (step_lon > 0),
  step_lat   double precision NOT NULL CHECK (step_lat > 0),
  data       bytea NOT NULL CHECK (octet_length(data) <= 67108864),
  envelope   geometry(Polygon, 4326) NOT NULL
);
CREATE INDEX dem_tile_envelope_idx ON geo.dem_tile USING gist (envelope);
CREATE INDEX dem_tile_project_idx ON geo.dem_tile (project_id, priority);
CREATE INDEX dem_tile_import_idx ON geo.dem_tile (import_id);
GRANT SELECT, INSERT, DELETE ON geo.dem_tile TO mobsimlab_app;
GRANT USAGE ON SEQUENCE geo.dem_tile_id_seq TO mobsimlab_app;
