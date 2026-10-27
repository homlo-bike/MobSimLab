-- osm2pgsql flex style for MobSimLab (Spike S3, tag mapping v0).
-- Usage: osm2pgsql -O flex -S tools/osm/mobsimlab-flex.lua -d <db> <file.osm.pbf|.osm>
-- Environment: MOBSIMLAB_OSM_SCHEMA (default "geo"). Geometries are stored in EPSG:4326 (ADR-0009 / 04 §4).

local schema = os.getenv('MOBSIMLAB_OSM_SCHEMA') or 'geo'
local here = debug.getinfo(1, 'S').source:match('^@(.*/)') or './'
local M = dofile(here .. 'tag_mapping_v0.lua')

local function tbl(name, geom, cols)
  local columns = { { column = 'tags', type = 'jsonb' } }
  for _, c in ipairs(cols or {}) do table.insert(columns, c) end
  table.insert(columns, { column = 'geom', type = geom, projection = 4326, not_null = true })
  return osm2pgsql.define_table({ name = name, schema = schema, ids = { type = 'any', id_column = 'osm_id', type_column = 'osm_type' }, columns = columns })
end

local T = {
  road = tbl('osm_way_road', 'linestring', {
    { column = 'highway', type = 'text' }, { column = 'name', type = 'text' },
    { column = 'oneway', type = 'text' }, { column = 'maxspeed', type = 'text' },
    { column = 'lanes', type = 'text' }, { column = 'bridge', type = 'bool' }, { column = 'tunnel', type = 'bool' },
    { column = 'layer', type = 'int2' }, { column = 'is_cycle', type = 'bool' }, { column = 'is_foot', type = 'bool' },
  }),
  rail = tbl('osm_way_rail', 'linestring', {
    { column = 'railway', type = 'text' }, { column = 'name', type = 'text' },
    { column = 'bridge', type = 'bool' }, { column = 'tunnel', type = 'bool' }, { column = 'layer', type = 'int2' },
  }),
  building = tbl('osm_building', 'multipolygon', {
    { column = 'building', type = 'text' }, { column = 'levels', type = 'text' }, { column = 'height', type = 'text' },
  }),
  landuse = tbl('osm_landuse', 'multipolygon', { { column = 'class', type = 'text' }, { column = 'value', type = 'text' } }),
  water = tbl('osm_water', 'geometry', { { column = 'class', type = 'text' }, { column = 'value', type = 'text' } }),
  pt = tbl('osm_pt', 'geometry', { { column = 'name', type = 'text' }, { column = 'kind', type = 'text' } }),
  poi = tbl('osm_poi', 'geometry', { { column = 'class', type = 'text' }, { column = 'name', type = 'text' } }),
  barrier = tbl('osm_barrier', 'geometry', { { column = 'barrier', type = 'text' } }),
  place = tbl('osm_place', 'geometry', { { column = 'place', type = 'text' }, { column = 'name', type = 'text' } }),
}

local function yes(v) return v == 'yes' or v == 'true' or v == '1' end
local function int(v) return v and tonumber(v:match('^%-?%d+$')) or nil end

local function match_any(tags, list)
  for _, m in ipairs(list) do
    local v = tags[m[1]]
    if v and (m[2] == true or v == m[2]) then return m end
  end
end

-- Purpose: best geometry for an object as point (nodes) or polygon/line (ways, relations).
local function area_or_point(o)
  if o.type == 'node' then return o:as_point() end
  if o.type == 'way' then
    if o.is_closed then return o:as_polygon() end
    return o:as_linestring()
  end
  return o:as_multipolygon()
end

local function common(o, geom)
  local t = o.tags
  local m = match_any(t, M.pt.match)
  if m then T.pt:insert({ tags = t, name = t.name, kind = m[1] .. '=' .. t[m[1]], geom = geom() }) end
  m = match_any(t, M.poi.match)
  if m then T.poi:insert({ tags = t, class = m[3], name = t.name, geom = geom() }) end
  if t.barrier then T.barrier:insert({ tags = t, barrier = t.barrier, geom = geom() }) end
  if t.place and M.place.values[t.place] then T.place:insert({ tags = t, place = t.place, name = t.name, geom = geom() }) end
end

function osm2pgsql.process_node(o)
  common(o, function() return o:as_point() end)
end

function osm2pgsql.process_way(o)
  local t = o.tags
  local hw = t.highway
  if hw and not M.road.exclude[hw] and not (o.is_closed and t.area == 'yes') then
    T.road:insert({
      tags = t, highway = hw, name = t.name, oneway = t.oneway, maxspeed = t.maxspeed, lanes = t.lanes,
      bridge = t.bridge ~= nil and t.bridge ~= 'no', tunnel = t.tunnel ~= nil and t.tunnel ~= 'no', layer = int(t.layer),
      is_cycle = hw == 'cycleway' or t.bicycle == 'designated' or t.cycleway ~= nil,
      is_foot = hw == 'footway' or hw == 'pedestrian' or hw == 'steps' or hw == 'path' or t.sidewalk ~= nil,
      geom = o:as_linestring(),
    })
  end
  if t.railway and M.rail.values[t.railway] then
    T.rail:insert({
      tags = t, railway = t.railway, name = t.name,
      bridge = t.bridge ~= nil and t.bridge ~= 'no', tunnel = t.tunnel ~= nil and t.tunnel ~= 'no', layer = int(t.layer),
      geom = o:as_linestring(),
    })
  end
  if o.is_closed then
    if t.building and t.building ~= 'no' then
      T.building:insert({ tags = t, building = t.building, levels = t['building:levels'], height = t.height, geom = o:as_polygon() })
    end
    if t.landuse then T.landuse:insert({ tags = t, class = 'landuse', value = t.landuse, geom = o:as_polygon() }) end
    if t.leisure == 'park' then T.landuse:insert({ tags = t, class = 'leisure', value = 'park', geom = o:as_polygon() }) end
  end
  if t.waterway then T.water:insert({ tags = t, class = 'waterway', value = t.waterway, geom = o:as_linestring() })
  elseif o.is_closed and (t.natural == 'water' or t.water) then
    T.water:insert({ tags = t, class = 'water', value = t.water or 'water', geom = o:as_polygon() })
  end
  common(o, function() return area_or_point(o) end)
end

function osm2pgsql.process_relation(o)
  local t = o.tags
  if t.type ~= 'multipolygon' then return end
  if t.building and t.building ~= 'no' then
    T.building:insert({ tags = t, building = t.building, levels = t['building:levels'], height = t.height, geom = o:as_multipolygon() })
  end
  if t.landuse then T.landuse:insert({ tags = t, class = 'landuse', value = t.landuse, geom = o:as_multipolygon() }) end
  if t.natural == 'water' or t.water then
    T.water:insert({ tags = t, class = 'water', value = t.water or 'water', geom = o:as_multipolygon() })
  end
  common(o, function() return o:as_multipolygon() end)
end
