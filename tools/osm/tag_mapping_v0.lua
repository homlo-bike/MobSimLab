-- MobSimLab OSM tag mapping, version 0 (Spike S3).
-- Pure data: which tags select a feature class and which tags are kept as columns.
-- Reviewed like any other data file; see docs/architecture/06-gis.md §2.2.
return {
  version = 0,
  road = {
    key = 'highway',
    exclude = { proposed = true, construction = true, abandoned = true, platform = true, raceway = true },
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
    match = {
      { 'amenity', 'parking', 'parking' }, { 'amenity', 'school', 'education' },
      { 'amenity', 'university', 'education' }, { 'amenity', 'college', 'education' },
      { 'amenity', 'hospital', 'health' }, { 'amenity', 'clinic', 'health' },
      { 'shop', true, 'shop' }, { 'office', true, 'employment' },
      { 'tourism', true, 'landmark' }, { 'historic', true, 'landmark' }, { 'amenity', 'townhall', 'landmark' },
    },
  },
  landuse = { keys = { 'landuse' }, extra = { { 'leisure', 'park' } } },
  water = { keys = { 'waterway', 'water' }, extra = { { 'natural', 'water' } } },
  barrier = { key = 'barrier' },
  place = { key = 'place', values = { city = true, town = true, village = true, suburb = true,
                                      quarter = true, neighbourhood = true, hamlet = true } },
}
