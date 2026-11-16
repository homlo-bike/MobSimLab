-- MobSimLab OSM tag mapping, version 1 (06-gis §2.2; version 0 was Spike S3).
-- Pure data: which tags select a feature class and which tags are kept as columns.
-- Reviewed like any other data file. Version 1 adds the places the benefit tables count (kindergartens,
-- doctors, healthcare=*), the coastline (sea for the Schematic tab), bridges and tunnels, and planned roads
-- (proposed, construction) when an import asks for them.
return {
  version = 1,
  road = {
    key = 'highway',
    exclude = { proposed = true, construction = true, abandoned = true, platform = true, raceway = true },
    -- Left out unless the import includes planned roads (MOBSIMLAB_OSM_PLANNED=1).
    planned = { proposed = true, construction = true },
  },
  rail = {
    key = 'railway',
    values = { rail = true, light_rail = true, subway = true, tram = true, narrow_gauge = true,
               monorail = true, funicular = true },
    keep = { 'usage', 'service', 'gauge', 'electrified', 'voltage', 'frequency', 'maxspeed', 'tracks' },
  },
  pt = {
    -- (key, value or true for any value)
    match = { { 'public_transport', true }, { 'highway', 'bus_stop' }, { 'railway', 'station' },
              { 'railway', 'halt' }, { 'railway', 'tram_stop' }, { 'railway', 'platform' },
              { 'amenity', 'bus_station' } },
  },
  poi = {
    -- (key, value or true, class); the first match wins.
    match = {
      { 'amenity', 'parking', 'parking' }, { 'amenity', 'school', 'education' },
      { 'amenity', 'kindergarten', 'education' },
      { 'amenity', 'university', 'education' }, { 'amenity', 'college', 'education' },
      { 'amenity', 'hospital', 'health' }, { 'amenity', 'clinic', 'health' },
      { 'amenity', 'doctors', 'health' }, { 'healthcare', 'hospital', 'health' },
      { 'healthcare', 'clinic', 'health' }, { 'healthcare', 'centre', 'health' },
      { 'healthcare', 'doctor', 'health' },
      { 'shop', true, 'shop' }, { 'office', true, 'employment' },
      { 'tourism', true, 'landmark' }, { 'historic', true, 'landmark' }, { 'amenity', 'townhall', 'landmark' },
    },
  },
  landuse = { keys = { 'landuse' }, extra = { { 'leisure', 'park' } } },
  water = { keys = { 'waterway', 'water' }, extra = { { 'natural', 'water' }, { 'natural', 'coastline' } } },
  barrier = { key = 'barrier' },
  place = { key = 'place', values = { city = true, town = true, village = true, suburb = true,
                                      quarter = true, neighbourhood = true, hamlet = true } },
}
