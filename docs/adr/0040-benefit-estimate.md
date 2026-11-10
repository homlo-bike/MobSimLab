# ADR-0040: Economic and social benefit tables from travel times with and without each line, open location data and editable formulas

- Status: Proposed (first version built: Tables tab benefit tables and GIS tab regions)
- Date: 2026-11-10
- Deciders: product owner, architecture
- Related: 09-planning-models §3.2–3.3, 06-gis §3, ADR-0018 (assumption engine), ADR-0034 (journey planner), ADR-0039 (cost tables), [Research R2](../research/r2-economic-and-social-benefits.md)

## Context

The product owner asked (2026-11-09) for estimates of what the lines do for the economy (GDP growth, land
value, stimulated economy) and for people (access to jobs, education and healthcare), based on the location,
from publicly available data, as low, medium and high educated estimates. Every formula and every variable
must be editable per project; one example given was ridership from the share of residents near a station who
use it. Values the planner enters for a region drawn or imported from OpenStreetMap (primary land use, land
value, tax revenue, population density and others) must take priority over sourced data. Research R2 compares
the sources and methods; the product owner approved its approach.

## Decision

1. **Zones are the stations.** Stops of one station (same parent station, or the same name within 600 m, as in
   the journey planner) form a zone whose catchment is the largest `mode.catchment_m` of the modes calling there.
   Every 50 m cell within a catchment belongs to the nearest station.
2. **People, jobs and places per zone**, by the first source that has them:
   - population: a region's population density; else WorldPop (the constrained 100 m grid of the population API,
     ADR-0038, for the current year: the cells whose centre lies in each catchment circle, spread evenly over
     the circle's 50 m cells); else the floor area of homes in OpenStreetMap ÷ floor area per person;
   - jobs: a region's jobs (as a density); else non-residential floor area of OpenStreetMap buildings ÷ floor
     area per job by use (office, retail, industrial, public). Buildings tagged only `building=yes` follow the
     region's primary land use, or count as homes in a set share;
   - schools, universities and colleges, hospitals, clinics and doctors from OpenStreetMap;
   - GDP per person, employment and the share of children from a region, else the World Bank (NY.GDP.PCAP.CN,
     SL.EMP.TOTL.SP.ZS, SP.POP.0014.TO.ZS).
3. **Travel times with and without.** A new `Planner::reach` in the journey planner gives the earliest arrival at
   every stop from a point (RAPTOR rounds without a destination). Door-to-door times between zones are the walk
   within each zone plus the faster of walking and public transport between stations, averaged over departures at
   07:30, 08:00 and 08:30. They are computed for the whole network, for no network, and without each line and
   each mode. A line's or mode's benefit is the difference between the whole network and the network without it;
   the total compares with no network.
4. **What each zone reaches**: places within a time limit per kind (cumulative opportunities), jobs weighted by
   exp(−β t), and effective density Σ jobs / t^α.
5. **Ten editable formulas**, written in a small, safe expression language (numbers, named variables, + − × ÷ ^,
   brackets, ln, log10, exp, sqrt, abs, min, max; compiled to closures, never evaluated as code): weekday and
   annual ridership, GDP growth (UK TAG A2.4 agglomeration), resident earnings from job access, land value uplift,
   property tax, and GDP and jobs from construction and operating spending. A project's own formulas are saved
   as the drawing kind `benefits`; a formula that does not compile falls back to the default.
6. **Parameters** in `assumptions/parameters/benefits.yaml` (group *Benefits*) with low, central and high
   values and sources, exported by `tools/benefits/export_defaults.py` and editable in the tables like the cost
   unit values (saved as project preferences).
7. **Low, medium and high** are the 10th, 50th and 90th percentile of 200 seeded draws: each parameter from a
   triangular distribution over its range, and the cost tables' low–high range for spending.
8. **Two groups**: GDP growth is the benefit for the appraisal; earnings, land value, property tax and spending
   impacts are shown as wider context and not added, because they count the same benefit again.
9. **Regions** (drawing kind `regions`) are drawn on the map or imported from the OpenStreetMap boundaries and
   named places around a point (`GET /api/benefits/osm-areas`), and carry primary land use, land and building
   value per m², property tax revenue, population density, jobs, GDP per person and the share of residents with a
   job. The latest region containing a point wins.

## Alternatives considered

| Option | Why not |
|--------|---------|
| Accessibility from every 100 m population cell | Many more journey planner runs; the station zones already capture where transit changes access. Cells can come later behind the same functions. |
| WorldPop's statistics API per catchment | A second WorldPop client next to the population grid the noise map already downloads; slower and a 2020 count. |
| Subnational GDP (Kummu et al. 2025) | A 1 km grid download not yet imported; regions can give GDP per person meanwhile. |
| OECD input-output multipliers per country | Not yet read into the library; the multiplier is a parameter with a Type I–Type II range. |
| Add land value and earnings to the BCR | Double counting (EU CBA Guide, UK TAG). |

## Consequences

- Only public transport times change: people switching from cars and road decongestion are not counted, which
  makes GDP growth and earnings conservative until the demand model exists.
- Outside regions with entered values, jobs come from building floor area and land values from GDP per person;
  both are wide educated guesses, and the tables say where each number comes from.
- The WorldPop and OpenStreetMap requests run through the outbound gateway and are cached; the live-sources
  workflow checks the WorldPop grid, the place tiles and the area lookup. The first request for a country
  waits while its WorldPop grid downloads to the server; until then its stations use homes' floor area.
