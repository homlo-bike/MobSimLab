# ADR-0038: Estimated noise map of service lines with CNOSSOS-EU: a live corridor in the editors, a full map as an analysis layer, exposure into the appraisal

- Status: Proposed; step N1 implemented as the noise plugin (2026-11-03); first part of N2, the GIS noise map with OSM buildings, implemented (2026-11-09); lateral diffraction, facade reflections and terrain added to it (2026-11-09); population exposure from WorldPop added (2026-11-10)
- Date: 2026-11-02
- Deciders: product owner, architecture
- Related: FR-COST-03, FR-GIS-04, FR-GIS-05, FR-GIS-06, FR-ENV-01..05 (new), ADR-0004 (polyglot runtime), ADR-0005 (SUMO), ADR-0006 (rail kernel), ADR-0013 (scenario overlays), ADR-0014 (results storage), ADR-0018 (assumption engine), ADR-0023 (job queue), ADR-0024 (map rendering), ADR-0028 (declared background traffic), ADR-0029 (street lines), ADR-0031 (routing in the browser), ADR-0033 (railway editor), ADR-0034 (published timetable), [09 §3.3](../architecture/09-planning-models.md)

## Context

The product owner asked (2026-11-02) for an estimated noise map of the service lines, and where it belongs in the app. Today noise appears only in the appraisal, as vehicle-km × a marginal cost per mode and area type (09 §3.3). That gives a euro figure but no map, so a planner cannot see that a new tram curve passes 40 m from bedrooms, or that converting a bus line to a tram moves the 55 dB band.

What the app already knows, and what a noise estimate needs:

| Needed for noise | Where it already is |
|---|---|
| Line geometry, per segment | Street line tool (ADR-0029), railway editor (ADR-0033) |
| Vehicles per hour, per period | Headways and service periods; the published timetable (ADR-0034) |
| Speed along the line, braking and accelerating near stops | Railway editor speed profile ("up to 50 km/h · 0:49 min"), street routing speeds, later the simulation trajectories (ADR-0014) |
| Vehicle type: category, traction, length, axles | Vehicle catalogue (ADR-0026): `mode`, `energySource`, `length`, `consist` |
| Track: bed, curve radius, switches, bridge, level (street, +1, −1) | Railway editor: track bed, curve table, catalogue switches, levels |
| Buildings and terrain (screening) | OSM import (Phase 2, FR-GIS-01), DEM (FR-GIS-05) |
| People exposed | Population rasters (FR-GIS-04) |

The EU method for strategic noise maps is **CNOSSOS-EU**, Annex II of the Environmental Noise Directive 2002/49/EC as replaced by Directive (EU) 2015/996 and amended by Delegated Directive (EU) 2021/1226. It covers road and rail emission (railways including trams) and outdoor propagation, and reports L<sub>den</sub> and L<sub>night</sub> at 4 m above ground. It does not cover ships or ropeways. The WHO Environmental Noise Guidelines (2018) set the health thresholds planners are asked about. An open-source implementation exists: **NoiseModelling** (Université Gustave Eiffel and Cerema, GPL-3.0, Java on H2GIS/PostGIS).

## Decision

### 1. Where it belongs: one engine, three places

The noise estimate is an **analysis result of a scenario**, like walk coverage (ADR-0035) and the journey benchmark (ADR-0034), not a property of a line. It is shown in three places, from one Rust crate so the numbers always agree:

1. **In the editors, while drawing (quick estimate).** The street line tool and the railway editor get a **Noise** toggle in their side panel. When on, the map shows a translucent corridor along the drawn line out to the 55 dB L<sub>den</sub> and 50 dB L<sub>night</sub> distances (free field, no buildings), and the side panel adds one stats tile ("55 dB band · 38 m each side") and entries in the existing **Checks** list, for example *"Curve R 85 m: squeal correction +8 dB, 3 buildings within 50 m"* or *"Night service on 1:40 ‰ slope next to housing"*. It recomputes on each edit, in the browser, like the curve and speed checks in the approved railway editor screens. It answers "is this alignment going to be a noise problem?" at the moment the alignment is chosen.
2. **As an analysis tool and map layer (full noise map).** A **Noise map** tool next to **Journey planner** in the top bar (it moves under an *Analysis* menu when that exists). Its side panel follows the approved journey planner layout: indicator (L<sub>den</sub>, L<sub>night</sub>, L<sub>day</sub>), what is included (service lines only, or with modelled general traffic), scenario and compare-to scenario, then the result: a headline (*"2,340 people above 55 dB L<sub>den</sub> from the service lines"*), people per 5 dB band as a stacked bar with a table view, people above the WHO guideline, and the loudest segments with *zoom to*. The map itself is a layer in the layer list (FR-GIS-06) with the usual visibility and opacity, so it can be shown under any other tool. Comparing two scenarios shows a **difference map** (± dB), which is the meaningful view for "replace this bus line with a tram". It runs as a background job because buildings and terrain make it heavier than the corridor.
3. **In the appraisal (FR-COST-03).** When a noise map exists for both scenarios, the noise externality is computed from the change in people exposed per band × a cost per person per dB from the EU Handbook on the External Costs of Transport, instead of vehicle-km × marginal cost. Without a map the vehicle-km method stays as the fallback, and the report says which method was used.

Not in the simulation playback view: the indicators are long-term averages over a day, not instantaneous levels, and animating them would suggest a precision the model does not have.

### 2. Model: CNOSSOS-EU, with transit-specific inputs

**Sources.** Each line segment becomes a CNOSSOS line source per period (day 07–19, evening 19–23, night 23–07 by default) with the flow and mean speed of each vehicle class on it.

- **Road modes** (bus, BRT, trolleybus, intercity bus): CNOSSOS road emission, rolling and propulsion terms per octave band (63 Hz–8 kHz), with corrections for road surface, gradient, and acceleration near signalised junctions and roundabouts. Two-axle buses are category 2 (medium heavy), articulated and three-axle buses and coaches are category 3 (heavy). CNOSSOS has no electric category yet (category 5 is left open), so **trolleybuses and battery buses** keep the rolling term and reduce the propulsion term by `noise.electric_road_propulsion_delta_db` (educated guess, see §5). Stops add an acceleration and deceleration zone, as CNOSSOS does for junctions.
- **Rail modes** (tram to high-speed rail): CNOSSOS railway emission: rolling noise from wheel and rail roughness through the track, vehicle and superstructure transfer functions, impact noise at switches and joints, traction noise, aerodynamic noise above about 200 km/h, bridge noise. Each mode and track bed maps to an entry of the CNOSSOS default database (Annex II Appendix G), and the railway editor's own data supply the corrections: **curve squeal** from the curve table (+8 dB for R ≤ 300 m, +5 dB for 300 < R ≤ 500 m on at least 50 m of track; trams +5 dB for R ≤ 200 m, per the 2021 amendment), **switches** from placed catalogue switches, **bridges** from the bridge track type, embedded street track for trams from the "Street" level. Underground track (levels −1, −2) emits nothing at the surface except at tunnel portals, which become point sources.
- **Measured vehicle data wins over the default database.** The vehicle schema gets an optional `noise` block: a measured pass-by level L<sub>pAeq,Tp</sub> at 7.5 m and 1.2 m at a stated speed (ISO 3095 for rail, ISO 362 or a pass-by test for road), with provenance like every other field. When present, the vehicle term is scaled to match it; the TSI NOI pass-by limits are used as a plausibility check (an EMU quoted above its limit is flagged).
- **Ferries and cable cars** (new modes, see the sibling research thread) are outside CNOSSOS. They are modelled the way the published studies do: a **ferry** as a moving point source along the route at cruise speed plus a berth source during dwell (engines, auxiliaries, ramp); a **cable car** as point sources at each tower (cabins passing over the sheave trains, level rising with line speed) and at each station (drive, bullwheel, cabin handling), as in the Burnaby Mountain Gondola study. Their sound powers are educated-guess assumptions with wide ranges until manufacturer or measured values are added (§5); the panel labels these layers "indicative".
- **Other mode families** (rubber-tyred metro and people movers, monorail, funicular): measured pass-by per vehicle converted to a line source, falling back to the closest CNOSSOS railway entry with a wide range.

**Propagation.**

- *Quick estimate (editors)*: free field over flat ground: geometric divergence, atmospheric absorption (ISO 9613-1), and the CNOSSOS ground effect with one ground factor *G* from the land use under the line. No buildings, no reflections. It is deliberately the upper bound a planner should worry about, and it is labelled "no screening".
- *Full map*: CNOSSOS point-to-point propagation: ray paths from each source segment to each receiver, ground effect with *G* from OSM land use, diffraction over buildings and terrain (DEM), first-order reflections from building façades, and homogeneous and favourable conditions combined with the probability of favourable propagation per period. Receivers on a grid at 4 m above ground, plus façade receivers on residential buildings (the most exposed façade, as the Directive prescribes for exposure counts) when buildings are imported.

**Indicators.** L<sub>day</sub>, L<sub>evening</sub>, L<sub>night</sub> and L<sub>den</sub> = 10 lg[(12·10<sup>L<sub>day</sub>/10</sup> + 4·10<sup>(L<sub>evening</sub>+5)/10</sup> + 8·10<sup>(L<sub>night</sub>+10)/10</sup>)/24]. Bands are 5 dB wide, from 45 dB (to cover the WHO guidelines) to ≥ 75 dB L<sub>den</sub> and ≥ 70 dB L<sub>night</sub>, the Directive's reporting bands extended downwards. Colours follow the ISO 1996-2 / DIN 45682 convention planners recognise, checked for contrast in light and dark map styles.

**Exposure.** People per band from the population raster (FR-GIS-04), distributed to residential buildings by floor area when buildings exist, else per raster cell at its grid level. People above the WHO 2018 guideline (road 53 dB L<sub>den</sub> / 45 dB L<sub>night</sub>; rail 54 / 44) and, as an option, highly annoyed and highly sleep-disturbed people from the dose-effect relations of Directive (EU) 2020/367.

### 3. What "service lines only" means

ADR-0028 makes general traffic declared demand. A map of service lines alone shows their **contribution**; it is not the noise people hear, which on most streets is dominated by cars and lorries. The panel says this in one line and offers two further views: **with modelled general traffic** (once the road simulation has background demand, its edge flows and speeds become CNOSSOS road sources), and the **difference to another scenario**, which is valid with or without background traffic because the background cancels. The default view for street modes is the difference map whenever a base scenario exists.

### 4. Inputs come from three levels of detail, and the result says which

| Level | Flows | Speeds | Available |
|---|---|---|---|
| Planned | Headways per service period from the street line tool; trips from the published timetable (ADR-0034) | Speed profile along the line (railway editor), routed road speeds with acceleration zones at stops (street lines) | As soon as a line is drawn |
| Timetabled | Trips per hour by vehicle type from the published timetable | Running-time profiles | Phase 7 |
| Simulated | Vehicles per hour per edge from the run | Mean speed and acceleration per edge and period from trajectories (ADR-0014), road and rail | Phases 5–6 |

The level is shown on the map legend and stored with the result, so a planner never mistakes a planned-speed estimate for a simulated one.

### 5. Assumptions (new Project Preferences group "Noise")

Added to `assumptions/parameters/noise.yaml` when the first step is implemented, under the rules of ADR-0018. Proposed defaults:

| Key | Central (low–high) | Basis | Source | Check |
|---|---|---|---|---|
| `noise.receiver_height_m` | 4 (1.5–4) | cited | END Annex I | secondary |
| `noise.period_day` / `_evening` / `_night` | 07–19 / 19–23 / 23–07 | cited | END Annex I (Member States may shift by 1–2 h) | secondary |
| `noise.evening_penalty_db` / `noise.night_penalty_db` | 5 / 10 | cited | END Annex I | secondary |
| `noise.favourable_probability_day` / `_evening` / `_night` | 0.5 / 0.75 / 1.0 (0.33–1.0) | documented | NMPB-2008 defaults as used for France in CNOSSOS software; Hungarian climatology finds about ⅓ by day, ⅔ evening and night | secondary |
| `noise.air_temperature_c`, `noise.relative_humidity_pct` | 15 °C, 70 % | documented | ISO 9613-1 absorption; common defaults in NoiseModelling | unverified |
| `noise.ground_factor_default` | 0.5 (0–1); per land use 0 paved and water, 1 grass and forest | documented | CNOSSOS-EU ground factor *G* definition | unverified |
| `noise.grid_spacing_m` | 10 (5–20) | educated-guess | typical urban strategic mapping; smaller is slower | unverified |
| `noise.max_source_distance_m` | 500 (250–1000) | educated-guess | beyond this a transit line rarely lifts a receiver above 45 dB L<sub>den</sub>; range tested in sensitivity | unverified |
| `noise.reflection_order` | 1 (0–2) | documented | usual CNOSSOS mapping practice | unverified |
| `noise.building_level_height_m` | 3 (2.8–3.5); unknown height 3 levels | educated-guess | used when OSM has `building:levels` but no `height` | unverified |
| `noise.rail_squeal_db` | +8 (R ≤ 300 m), +5 (300–500 m); tram +5 (R ≤ 200 m) | cited | Directive (EU) 2021/1226, Annex point (4)(b), railway squeal table | read |
| `noise.electric_road_propulsion_delta_db` | −8 (−12 to −3) on the propulsion term | educated-guess | NZTA RR 703: electric buses about 8 dB quieter at 10 km/h, no difference at 30 km/h; applying it to the propulsion term only reproduces that fade-out because rolling noise dominates with speed | secondary |
| `noise.who_guideline_lden_db` / `_lnight_db` | road 53 / 45; rail 54 / 44 | cited | WHO Environmental Noise Guidelines 2018 | read |
| `noise.cable_car_tower_lw_db`, `noise.cable_car_station_lw_db` | wide educated-guess ranges, to be set by the cable car research | educated-guess | Burnaby Mountain Gondola noise report; Perugia gondola measurements | unverified |
| `noise.ferry_cruise_lw_db`, `noise.ferry_berth_lw_db` | wide educated-guess ranges, to be set by the ferry research | educated-guess | port noise mapping practice (NoMEPorts good practice guide) | unverified |

The CNOSSOS road coefficients and the railway default database are not Project Preferences values; they are a versioned data file in the crate, cited to the Directive with its amendment, and listed in the method statement. Every result also runs at the low and high ends of the ranges that matter most (favourable probability, electric delta, squeal), and the panel shows the band as "about 38 m (30–46 m)" rather than a single figure, as ADR-0018 asks for.

### 6. Where it runs

- A new Rust crate, `crates/noise`: emission (road, rail, point sources), propagation (quick and full), indicators and exposure. Pure functions over plain inputs, deterministic, SI units.
- `crates/noise-wasm` for the editors' corridor and checks, like street routing (ADR-0031) and the railway geometry (ADR-0033). Free-field propagation for one line is a few thousand receivers and runs in milliseconds.
- The full map is a pg-boss job (ADR-0023) in the simulation worker, calling the crate natively. Output per ADR-0014: the receiver grid as a Cloud-Optimised GeoTIFF per indicator in the project volume, contour polygons in PostGIS for the vector layer, and exposure aggregates in PostgreSQL. The map shows the contours through MapLibre (ADR-0024); the raster is used for the difference map and export.
- The AI agent tools (ADR-0035) get a read-only `noise_exposure` tool once the full map exists, so an agent can compare alignments on exposure as well as walk coverage.
- When the plugin interface exists (sibling thread), the crate's input and output types become the contract for **noise method plugins**, so national methods can be added beside CNOSSOS: Germany (RLS-19, Schall 03), the UK (CRTN, CRN), the US (FTA *Transit Noise and Vibration Impact Assessment Manual*, 2018, for transit; FHWA TNM for roads). CNOSSOS stays the built-in default.

### 7. Validation

- **Propagation**: the test cases of ISO/TR 17534-4:2020 (quality-assured implementation of the CNOSSOS-EU propagation part) as unit tests, within the tolerance the report gives.
- **Emission and end-to-end**: **NoiseModelling as a validation oracle**, the way OSRD is for running times (ADR-0006): a set of reference scenes (a straight tram line, a tight tram curve near a building row, a bus line through a street canyon, a regional line on a viaduct) run in both, in CI outside the shipped image, agreeing within 1 dB at each receiver.
- **Plausibility**: the quick corridor against published measurements for one tram and one bus line, and the vehicle pass-by levels against the TSI NOI limits.

### 8. Steps

| Step | Delivers | Depends on |
|---|---|---|
| N1 | `crates/noise` emission for road and rail; free-field propagation; Wasm build; **Noise** toggle, corridor and checks in the street line tool and railway editor, from planned headways and speeds; `noise.yaml` assumptions and sources | ADR-0029, ADR-0033 (done) |
| N2 | Full CNOSSOS propagation with buildings and terrain; worker job; **Noise map** tool, map layer, bands, exposure from population; ISO/TR 17534-4 and NoiseModelling tests | Phase 2 OSM buildings, DEM, population rasters |
| N3 | Inputs from timetables and simulation runs; with-background-traffic view; scenario difference map; appraisal hook (FR-COST-03); report export (contours as GeoJSON and GeoPackage, table as CSV); agent tool | Phases 5–7, 9 |
| N4 | Ferry and cable car sources and their assumptions; vehicle `noise` block in the catalogue for measured pass-by levels | New modes (sibling thread), vehicle schema |

## Implementation notes (2026-11-03)

- **N1 is delivered as the bundled noise plugin** `org.mobsimlab.noise` (product owner, 2026-11-03: "This should be a plugin as well"), on the plugin model of ADR-0036. The plugin contributes the Noise parameters (`plugins/noise/assumptions/parameters.yaml`, so §5's keys live with the plugin instead of `assumptions/parameters/noise.yaml`), its sources, the calculation `noise_estimate` (runtime `bundled-wasm`, module `noise`) and the map layer `noise_band`. The engine stays the core crate `crates/noise` with `crates/noise-wasm`, as ADR-0036 requires for calculations until the sandboxed host exists. The editors show the Noise section only when the registry lists the calculation for that tool.
- **Rail emission was interim** (a pass-by level per mode scaled with speed) until the CNOSSOS-EU railway source replaced it; see the notes of 2026-11-09 below.
- **Quick-estimate ground effect** uses the ISO 9613-2 general method with one *G*, which assumes favourable propagation throughout: an upper bound, consistent with §2's "no screening" label. CNOSSOS homogeneous/favourable conditions come with the full map (N2).
- **Placeholders accepted** by the product owner (2026-11-03) for electric buses (−8 dB, −12 to −3, on the propulsion term), cable car towers and stations (90 and 95 dB(A)) and ferries (105 and 100 dB(A)); they are marked PLACEHOLDER in the parameter file.
- **Where the full map lives** (product owner, 2026-11-08): the live band stays in the street line tool and the railway editor; the full noise map with OSM buildings, exposure and the scenario difference goes in the **GIS tab** as the Noise map layer and its panel, instead of a separate tool next to Journey planner (§1.2).
- **Flows until service lines exist:** street lines use the headway for the day and editable evening and night vehicles per hour; the railway editor uses editable sample trains per hour per track by mode.

## Implementation notes, N2 first part (2026-11-09)

- **Noise map in the GIS tab:** a *Noise map* section computes L_den and L_night at 4 m from every saved street line and the railway design together, on demand, out to 300 m from the lines. The noise picture and the buildings are drawn on the map; the plugin's `noise_estimate` calculation now lists `gis` among its places (the manifest schema gained the value).
- **Buildings:** footprints come from OpenStreetMap through the API (`/api/street-network/building-tiles/14/x/y`, Overpass, cached like the street tiles; ways and multipolygon outers tagged `building`, not `building=no`, not underground). Height is `height` when tagged, else `building:levels` × `noise.building_storey_height_m` (3 m), else `noise.building_default_height_m` (8 m), both educated guesses in the plugin's parameters. At most 12 zoom-14 tiles per map; beyond that the map is computed without buildings and says so.
- **Screening:** for each grid receiver and source element the engine finds the buildings the straight path crosses and takes the upper convex hull over their roof edges (the CNOSSOS-EU / ISO 9613-2 vertical path). D_z per band follows ISO 9613-2 clause 7.4 (C2 = 20, C3 for several edges, K_met, limits 20 and 25 dB) and replaces the ground term as A_bar = D_z − A_gr, not below 0. Not yet: lateral paths round building ends, facade reflections, terrain, and the full CNOSSOS-EU homogeneous and favourable split; the panel says so. Beyond 80 m two neighbouring 10 m elements share one path, which changes free-field levels by under 0.1 dB.
- **Exposure:** receivers inside footprints are not computed; each building takes the highest level of the grid cells beside its footprint (its most exposed side) and is counted in the reporting bands of Directive 2002/49/EC Annex VI (L_den 55–75, L_night 50–70). Buildings stand in for dwellings and people until population data is added. The band distances in the editors stay free field.
- **Speed:** a 3 km tram line with about 6,300 buildings and an 80,000-cell grid takes about 1.4 s natively (2.6 s since the railway source has two heights, see below) (`cargo run --release -p noise --example map_timing`); in the browser it runs on demand, not on every edit.
- **Flows in the map:** street lines take buses per hour from the headway and the street line tool's default evening and night flows; railway tracks take the sample trains per hour of the design's mode, as in the editor. `noise.*` values in the project's preferences document are passed as overrides.

## Implementation notes, CNOSSOS-EU railway source (2026-11-09)

- **Tables from the official texts.** `crates/noise/data/cnossos-rail.json` holds Appendix G of Directive (EU) 2015/996 (OJ L 168, 1.7.2015) as amended by Delegated Directive (EU) 2021/1226 point (20) (OJ L 269, 28.7.2021): the replaced rail roughness, contact filter, track transfer (with direct fastening on bridges), impact and bridge tables, the 2015 wheel roughness, wheel transfer and aerodynamic tables, and Table G-5 with the 2 200 kW diesel locomotive's 6 300 Hz row corrected. `tools/noise/extract_cnossos_rail.py` builds the file from the two documents (the 2015 XHTML from the Publications Office and the 2021 PDF) and `--check` confirms it; no value is typed by hand. The 2015 wheel roughness table starts at 1 000 mm, so the 1 000 mm value is used for the 1 250–2 000 mm bands the 2021 tables add.
- **Emission per train**, in 1/3 octave bands 50 Hz–10 kHz (Annex II §2.3.2): wheel and rail roughness converted to frequency with f = v/λ (v in m/s), averaged energetically between neighbouring wavelength bands, at no less than 50 km/h (trams and light rail 30 km/h); total roughness with the contact filter (2.3.7); track and wheel radiation through their transfer functions plus 10 lg(N_a) (2.3.8, 2.3.9); impact roughness of one switch per 100 m (2.3.11, 2.3.12) from 50 m before to 50 m after each placed switch, not below the minimum speed; squeal from the 2021 table on the rolling noise; traction from Table G-5 per powered vehicle or locomotive at sources A and B; aerodynamic noise above 200 km/h with α = 50 per 20 m of train (2.3.13, 2.3.14); bridges as an extra omnidirectional source L_R,TOT + L_H,bridge + 10 lg(N_a) (2.3.18 as replaced in 2021). The bands are summed to octaves and A-weighted; the flow gives L_W′ = L_W + 10 lg(Q/1000 v) (2.3.2). Superstructure radiation is for freight wagons only and is not used.
- **Two source heights and directivity.** Source A at 0.5 m and source B at 4.0 m above the rail head (Figure 2.3.a). The horizontal dipole 0.01 + 0.99 sin²φ (2.3.15) applies to every railway source except bridge noise, which 2021/1226 makes omnidirectional; the vertical directivity of source A (2.3.16 as replaced: only above the horizontal) and of the aerodynamic source B (2.3.17) is evaluated per octave at the band centre. Because source A radiates less steeply upwards, the level next to the track can rise over the first metres, so the band edge now starts at the first probe above the threshold.
- **Mode defaults** are assumptions in the plugin's parameters (`noise.rail_*`): vehicle length, axles per vehicle, powered share and locomotives give the counts; enum parameters pick the table entries (wheel roughness by brake type, rail roughness E or M, contact filter, wheel and track transfer, traction, bridge type), with the low and high variants on quieter and louder entries. CNOSSOS-EU has no tram-specific vehicle data, so trams use small wheels and the EMU traction entry; a 30 m tram at 40 km/h comes out at about 73 dB L_pAeq,Tp at 7.5 m and a regional EMU at 80 km/h at about 79 dB, in the range of ISO 3095 measurements and the TSI NOI limits. Embedded tram track keeps `noise.tram_embedded_track_db` on the track radiation, since Appendix G has no transfer function for it. Project preferences override the numeric values; the enum choices are not yet offered as per-project overrides.
- **Not yet:** the 2021 rule of +8 dB for switch turnouts with R ≤ 300 m (the diverging radius is not in the noise input), idling trains as point sources, and freight vehicles.

## Implementation notes, N2 later steps: round the ends, reflections, terrain (2026-11-09)

Approved by the product owner (2026-11-09, "All the above": diffraction round building ends, reflections, terrain, population exposure). Population exposure is in the next section.

- **Lateral paths** (`screening::Obstacles::lateral`): when buildings stand above the line of sight, the two paths round their left and right ends are found in plan as the convex chain over their corners, extended round any other building the chain runs into (at most 3 times, and at most `LATERAL_MAX_BUILDINGS` = 4 buildings; beyond that the side counts as closed). Each adds energetically to the path over the roofs with ISO 9613-2 7.4: D_z with C3 for several corners, K_met = 1, the 20/25 dB limits, and the ground term kept. To keep the map fast, every screened path first gets a cheap upper bound of what its lateral paths could add (through the farthest corner, at 63 Hz); per receiver the largest bounds are tightened to the chain round the blocking buildings and then checked, until what is left could add at most 1 % of the receiver's energy (0.04 dB). Positions with several source heights (railway sources A and B) share one plan path.
- **Reflections** (first order, `noise.reflection_order` ≥ 1; a value of 2 is computed as 1): for each grid receiver the facade walls within `noise.reflection_max_distance_m` (50 m) that face it give an image receiver; a source element whose path to the image crosses the wall, below the roof, reflects with `noise.facade_reflection_coefficient` (0.8, ISO 9613-2 Table 4) when both legs are clear. Ground, absorption and directivity use the unfolded length. A building's level (its most exposed side) leaves out the reflection from its own facade, as the Directive's facade level is the incident sound.
- **Terrain**: the GIS tab loads ground heights over the map area from the shared terrain API (Copernicus GLO-30), at 30 m, coarser for long lines (at most 40,000 heights; beyond 90 m spacing the map stays on flat ground and says so). GLO-30 is a surface model, so the engine drops the samples inside OSM buildings, removes anything narrower than `noise.terrain_filter_window_m` (60 m) by a morphological opening (Zhang et al. 2003) and fills the gaps. Sources, receivers (4 m above their ground) and buildings then stand on this ground, and the ground along each path joins the roofs in the vertical path, so hills and embankments screen. The ground effect keeps the source and receiver heights above their own ground (the mean plane through the ends), and the vertical directivity of the railway sources stays relative to the horizontal. A terrain grid flatter than 0.5 m is ignored.
- **Not yet:** paths that combine reflection and diffraction (a reflected path counts only when both legs are clear), second-order reflections, and the CNOSSOS-EU homogeneous and favourable split.
- **Speed:** `cargo run --release -p noise --example map_timing` (3 km tram, 6,278 buildings in a block grid, 43,000 cells at 10 m) takes 2.3 s natively with everything on, against 1.8 s with roof screening only. Open layouts of detached houses cost more, because there the paths round the ends matter and are checked: a 1.2 km bus line among 87 houses on a 5 m grid takes 2.3 s natively (0.9 s before) and about 6 s in the browser.

## Implementation notes, N2 later steps: population exposure (2026-11-10)

The product owner chose the source (2026-11-09, "Both, WorldPop first"): WorldPop spread over the buildings where it can be loaded, the building size where it cannot, and the map says which was used.

- **WorldPop** (constrained estimates 2015–2030, 3 arc seconds, R2025A v1, CC BY 4.0; the current year, else the nearest): the GIS tab asks the API for the people per cell over the buildings it loaded (`POST /api/population/grid`). The API finds the countries of the area from OpenStreetMap, downloads each country's GeoTIFF once to the server (WorldPop's file server does not answer byte ranges; Germany is 117 MB, the United States 1.5 GB) and sums the cells of the area. While a file is still downloading the API answers `loading` after 20 s and the map uses the building size, saying so.
- **Spreading** (`noise::population`): the people of each cell are shared among the buildings whose centre lies in the cell and that may hold homes, by floor area (footprint × storeys: OSM `building:levels`, else the height ÷ `noise.building_storey_height_m`, at least one). A building may hold homes unless its OSM `building` value names another use (shop, office, garage, church…; `yes` and housing values count) and when its footprint is at least `noise.population_min_footprint_m2` (30 m²). People in a cell without such a building are reported as not counted.
- **Building size**, where WorldPop cannot be loaded: floor area ÷ `noise.floor_area_per_person_m2` (55 m², an educated guess).
- **Counting**: each building's residents fall in the reporting band of the level beside its most exposed side (Annex VI), next to the building counts; the panel shows residents rounded to the hundred above 100, the total in reach and the source used.
- **Not yet:** dwellings (the Directive's other count), quiet facades, and the exposure-response relations of Directive (EU) 2020/367 (highly annoyed, highly sleep disturbed).

## Alternatives considered

| Option | Why not |
|--------|---------|
| Embed NoiseModelling as the engine | A JVM inside the `mobsimlab` container is a fourth runtime against ADR-0004 and ADR-0003, and it cannot run in the browser for the live corridor. GPL-3.0 is compatible with our AGPL, so using it as the CI oracle is fine. |
| Use SUMO's noise output | Per-lane emission only (Harmonoise-based), no propagation, road only, and a different model from the EU's legal method. Its edge flows and speeds are used as inputs instead (§4). |
| Keep the vehicle-km × marginal cost only | No map and no location: it cannot tell a curve next to housing from one in a field, which is what the product owner asked to see. It stays as the fallback in the appraisal. |
| Nord2000 or Harmonoise propagation | More accurate in some weather and terrain, but not the method Member States report with, heavier, and less well known to planners; can come as a method plugin. |
| Simple distance attenuation everywhere | Fine for the editor corridor (that is what N1 does, labelled "no screening"), but without buildings it overstates levels behind the first row by 10–20 dB, so it cannot be the published map. |
| Commercial engines (CadnaA, SoundPLAN, IMMI) | Proprietary; cannot ship in an AGPL self-hosted product. |
| Noise as a property shown on each line only | Noise from several lines adds up at a receiver, and the useful questions (people exposed, change between scenarios) are about places, not lines. The per-line figure lives in the editor corridor; the map is a scenario result. |

## Consequences

- The planner sees the noise consequence of an alignment while drawing it, and a defensible map and exposure table per scenario, both from the same cited method.
- The appraisal's noise externality becomes location-based when a map exists, which is how the EU Handbook values noise anyway.
- New work: a Rust crate with its Wasm build, a CNOSSOS coefficient file with provenance, a `noise.yaml` assumption group, an optional `noise` block in the vehicle schema, a worker job, a side-panel tool and a map layer.
- The full map waits on buildings, terrain and population (Phase 2). Until then only the editor corridor exists, and it says it has no screening.
- Street-mode maps without background traffic show a contribution, not what residents hear; the panel and exports say so, and the difference map is the default for street modes.
- Electric buses, ferries and cable cars rely on educated guesses with wide ranges until better data is added; their results carry the range and the "indicative" label.
- ISO/TR 17534-4 is a paid document; a copy has to be bought for the test suite, or the cases taken from NoiseModelling's open test suite where it reproduces them.

## Sources

- Directive 2002/49/EC (Environmental Noise Directive), Annex I (indicators, periods, 4 m) and Annex VI (reporting bands). https://eur-lex.europa.eu/eli/dir/2002/49/oj
- Commission Directive (EU) 2015/996, common noise assessment methods (CNOSSOS-EU). https://eur-lex.europa.eu/eli/dir/2015/996/oj
- Commission Delegated Directive (EU) 2021/1226 amending Annex II (CNOSSOS-EU), including the railway and tram squeal table, the railway directivity and bridge corrections and the replaced Appendix G tables. https://eur-lex.europa.eu/eli/dir_del/2021/1226/oj
- Commission Directive (EU) 2020/367, Annex III dose-effect relations. https://eur-lex.europa.eu/eli/dir/2020/367/oj
- WHO Regional Office for Europe, *Environmental Noise Guidelines for the European Region*, 2018. https://www.who.int/europe/publications/i/item/9789289053563
- ISO/TR 17534-4:2020, quality-assured implementation of CNOSSOS-EU propagation in software. https://www.iso.org/standard/72115.html
- ISO 9613-1:1993, atmospheric absorption of sound.
- Zhang, K. et al. (2003), A progressive morphological filter for removing nonground measurements from airborne LIDAR data, IEEE TGRS 41(4), 872–882. https://doi.org/10.1109/TGRS.2003.810682
- Copernicus DEM GLO-30. https://doi.org/10.5270/ESA-c5d3d65
- Bondarenko, M. et al. (2025), Constrained estimates of 2015–2030 total number of people per grid square, 3 arc seconds, R2025A v1. WorldPop, University of Southampton. https://doi.org/10.5258/SOTON/WP00839
- NoiseModelling, Université Gustave Eiffel and Cerema, GPL-3.0. https://noisemodelling.readthedocs.io/
- Commission Regulation (EU) No 1304/2014 (TSI NOI), pass-by limits, as amended by (EU) 2019/774. https://eur-lex.europa.eu/eli/reg/2014/1304/oj
- Waka Kotahi NZ Transport Agency, Research Report 703, *Electric bus noise and road user safety*. https://www.nzta.govt.nz/resources/research/reports/703
- TransLink, Burnaby Mountain Gondola noise modelling technical report (2023). https://www.translink.ca/-/media/translink/documents/plans-and-projects/rapid-transit/burnaby-mountain-gondola/business-case-engagement-2023/bmg_noise_modelling_tech_report.pdf
- University of Perugia (2011), noise measurements near new-generation gondola stations and towers, in the university repository research.unipg.it (exact record to be confirmed when the values are taken).
- European Commission, *Handbook on the External Costs of Transport*, 2019 (version 2020). https://op.europa.eu/en/publication-detail/-/publication/9781f65f-8448-11ea-bf12-01aa75ed71a1
- US FTA, *Transit Noise and Vibration Impact Assessment Manual*, FTA Report No. 0123, 2018. https://www.transit.dot.gov/research-innovation/transit-noise-and-vibration-impact-assessment-manual-fta-report-no-0123
