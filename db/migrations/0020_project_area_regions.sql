-- 0020: the project area from OpenStreetMap regions (#140). A planner picks one or more OSM boundaries or named
-- places; the project area is their union, and imports (OSM, elevation, population) cover their box. Projects
-- without regions keep the box round everything drawn, widened by area_buffer_km (projects/project-area.ts).
-- Each entry: {id, name, kind, adminLevel, ring: [[lon, lat], ...], areaKm2}; rings are thinned to 1,500 points.

ALTER TABLE project.project
  ADD COLUMN area_regions jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(area_regions) = 'array' AND jsonb_array_length(area_regions) <= 10);
