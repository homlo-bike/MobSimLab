-- 0026: the project area as polygons the planner draws (large-area projects, step 1). Each entry:
-- {id, name, detail: "full" | "main", ring: [[lon, lat], ...]}; map data is downloaded only inside them, at each
-- polygon's detail (projects/area-polygons.ts). Projects with OpenStreetMap regions (0021) get each region as a
-- full-detail polygon; projects without regions have no area until the planner draws one.

ALTER TABLE project.project
  ADD COLUMN area_polygons jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(area_polygons) = 'array' AND jsonb_array_length(area_polygons) <= 50);

UPDATE project.project p
SET area_polygons = (
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', 'a' || r.n,
      'name', r.region ->> 'name',
      'detail', 'full',
      'ring', r.region -> 'ring'
    ) ORDER BY r.n)
  FROM jsonb_array_elements(p.area_regions) WITH ORDINALITY AS r(region, n)
)
WHERE jsonb_array_length(p.area_regions) > 0;

-- The drawn polygons are the only project area: the regions (0021) and the buffer round the drawing are gone.
ALTER TABLE project.project DROP COLUMN area_regions, DROP COLUMN area_buffer_km;
