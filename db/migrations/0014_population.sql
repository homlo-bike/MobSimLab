-- 0010: population layers per project (06-gis §3, FR-GIS-04): WorldPop and GHSL grids imported for the project
-- area, and the planners' own population data (GeoTIFF grids, GeoJSON zones, CSV points or zone values).
-- The project area is the box round everything drawn, widened by `area_buffer_km` (projects/project-area.ts).
-- Every layer keeps its source, licence, confidence, reference year, resolution and coverage. One layer per
-- project can be primary: the noise map, the walk analysis and the benefit tables then read it instead of
-- WorldPop's live grid. Features are stored as geometry (grid cells as polygons), not as PostGIS rasters,
-- because postgis_raster needs a superuser to install.

CREATE SCHEMA IF NOT EXISTS geo;
GRANT USAGE ON SCHEMA geo TO mobsimlab_app;

ALTER TABLE project.project
  ADD COLUMN area_buffer_km real NOT NULL DEFAULT 2 CHECK (area_buffer_km >= 0 AND area_buffer_km <= 50);

CREATE TABLE geo.population_layer (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES project.project (id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  source         text NOT NULL CHECK (source IN ('worldpop', 'ghsl', 'upload')),
  -- grid: cells of a raster; zones: polygons with people; points: people at points.
  kind           text NOT NULL CHECK (kind IN ('grid', 'zones', 'points')),
  status         text NOT NULL DEFAULT 'importing' CHECK (status IN ('importing', 'ready', 'failed')),
  error          text CHECK (length(error) <= 2000),
  -- How far an import is: { "receivedBytes", "totalBytes", "step" }.
  progress       jsonb CHECK (pg_column_size(progress) < 4096),
  licence        text NOT NULL DEFAULT '' CHECK (length(licence) <= 500),
  source_url     text NOT NULL DEFAULT '' CHECK (length(source_url) <= 2000),
  citation       text NOT NULL DEFAULT '' CHECK (length(citation) <= 2000),
  confidence     text NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  reference_year integer CHECK (reference_year BETWEEN 1800 AND 2200),
  -- Nominal cell size of a grid, metres; null for zones and points.
  resolution_m   real CHECK (resolution_m > 0),
  -- The area the layer covers: the import box, or the box round an upload's features.
  coverage       geometry(Polygon, 4326),
  people_total   double precision NOT NULL DEFAULT 0,
  feature_count  integer NOT NULL DEFAULT 0,
  is_primary     boolean NOT NULL DEFAULT false,
  -- What the import or upload was asked for (epoch, resolution, field names, coordinate system…).
  options        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(options) < 65536),
  created_by     uuid REFERENCES iam."user" (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX population_layer_project_idx ON geo.population_layer (project_id);
CREATE UNIQUE INDEX population_layer_one_primary ON geo.population_layer (project_id) WHERE is_primary;

CREATE TABLE geo.population_feature (
  layer_id uuid NOT NULL REFERENCES geo.population_layer (id) ON DELETE CASCADE,
  n        integer NOT NULL,
  -- Zone id of an uploaded zone (GeoJSON), which CSV values can be joined to.
  zone_id  text CHECK (length(zone_id) <= 200),
  people   double precision NOT NULL CHECK (people >= 0),
  geom     geometry(Geometry, 4326) NOT NULL,
  PRIMARY KEY (layer_id, n)
);
CREATE INDEX population_feature_geom_idx ON geo.population_feature USING gist (geom);
CREATE INDEX population_feature_zone_idx ON geo.population_feature (layer_id, zone_id) WHERE zone_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON geo.population_layer, geo.population_feature TO mobsimlab_app;
