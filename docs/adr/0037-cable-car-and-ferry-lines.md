# ADR-0037: Cable car and ferry service lines: two new mode families drawn station-first, frequency-based gondolas and timetabled ferries with berths

- Status: Proposed
- Date: 2026-11-02
- Deciders: product owner, architecture
- Related: FR-NET-01, FR-NET-11, FR-VEH-01, FR-SIM, FR-TT, ADR-0009 (unified graph), ADR-0018 (assumptions), ADR-0026 (vehicle catalogue), ADR-0029 (street lines), ADR-0030 and ADR-0032 (railway design and operations), ADR-0034 (journey planner), ADR-0036 (plugins, §8 new modes as plugins), [Research R1](../research/r1-cable-car-and-ferry.md)

## Context

The product owner asked (2026-11-02) to add **cable car** and **ferry** service lines next to street and rail lines, and which similar modes should follow. Both were listed out of scope for v1.0 in [01 Overview](../architecture/01-overview.md). [Research R1](../research/r1-cable-car-and-ferry.md) covers the industry, startups, regulation and infrastructure. What matters for the design:

1. **Continuous gondolas have no timetable.** Cabins pass every 8–30 s on a moving rope; capacity is set by cabin size, line speed and cabin interval. **Reversible aerial trams** and **funiculars** are timetabled shuttles.
2. **Cable car geometry is simple but strict:** straight sections between stations, direction changes only in stations, towers whose spans and heights depend on the technology, and clearance over the ground and buildings with rope sag. Overflight of buildings and wind are the main reasons projects stall or stop.
3. **Ferries run on water, which the unified graph does not have.** They are timetabled like rail; the scarce resource is the **berth**, dwell is limited by **gangway throughput**, running time depends on **speed zones**, and **bridges and locks** constrain the route.
4. **Weather** (wind for ropeways; waves, wind, fog and ice for ferries) is the normal cause of service loss for both.
5. ADR-0036 (plugins, Proposed) recommends building cable car and ferry as **first-party plugins bundled with the image**, on two new core **authoring kits** (straight spans between stations and supports; routes over water between terminals) and a core **mesoscopic segment engine** that plugins supply numbers and rules to. This ADR is the mode-specific content for those plugins and kits.
6. The existing journey planner (ADR-0034) already expands **frequency patterns** into trips, and the GTFS-shaped published timetable carries a free `mode` string.

## Decision

### 0. Packaging (aligned with ADR-0036)

- Cable car and aerial tramway ship together as the bundled plugin `org.mobsimlab.aerial-lift`; ferry as `org.mobsimlab.ferry`. Funicular stays a core rail mode, because it uses the railway tool and rail kernel unchanged.
- §2 below specifies the core **straight spans kit**, and §3 the core **water route kit**. The kits are generic (a people mover can reuse straight spans); everything ropeway- or vessel-specific (systems, parameters, checks, vehicle fields) is a plugin contribution.
- §5 describes behaviour on the core **mesoscopic segment engine**, not separate engines. The plugins supply running times, dwell and capacity rules through its interface.
- If this work starts before the plugin host exists, it is built against the Phase 0 registries of ADR-0036 so the modes move into plugins without data migration.

### 1. Modes

Add three mode ids to the assumption library, the vehicle catalogue and the published timetable:

| Mode id | Covers | Operation | GTFS `route_type` |
|---------|--------|-----------|-------------------|
| `cable_car` | Continuous ropeways: monocable (MGD), bicable (2S), tricable (3S), funitel, pulsed gondola | Frequency-based, no timetable | 6 (aerial lift) |
| `aerial_tramway` | Reversible ropeways (one or two cabins shuttling) | Timetabled shuttle | 6 |
| `ferry` | Water buses, crossing shuttles, commuter fast ferries; passenger-only at first | Timetabled | 4 (ferry) |

The ropeway **technology** (`mgd`, `2s`, `3s`, `funitel`, `pulsed`, `reversible`) is a property of the line's system, like a railway system in ADR-0030, and becomes a new assumption context key `ropeway_system`. Ferries get a context key `vessel_type` (`monohull`, `catamaran`, `hydrofoil`). Both are additive changes to the assumption engine.

### 2. Cable car tool: the straight spans kit (map editor)

Station-first, like the railway tool (ADR-0030), because the stations decide everything else. The steps below are the straight spans kit with the aerial-lift plugin's parameters and checks.

1. Pick the **system** (MGD, 3S …). Line speed, cabin size, max span, max tower height, max station angle and wind limits come from the assumption library and are editable.
2. **Click stations in order.** The line between two stations is straight. Each station is a **terminal** (drive or return), an **intermediate** station (boarding) or an **angle** station (direction change; boarding optional). An angle above the system's limit is an error.
3. **Towers are placed automatically** along each section from the DEM and building heights (OSM `height`, `building:levels`), keeping the loaded cabin at the minimum clearance with rope sag and within the span limit. The planner can drag, add or delete towers.
4. A **longitudinal profile** panel shows ground, buildings, towers and the rope line with clearance; clearance below the minimum is an error, below the recommended value a warning (same rule as FR-NET-04).
5. An **overflight corridor** (configurable width) lists buildings and the length flown over, as a planning warning, not an error.
6. Stations join `StationGroup`s with nearby stops and stations by the grouping rule (06 §9.3), so transfers to bus, tram and metro work as for any other station.
7. A **cabin garage** at one station (or a separate building on the line) is the depot; the tool computes the cabin count: `2 × line length ÷ cabin spacing + reserve`.

The kit's geometry (tower placement, sag and clearance) is a core Rust crate compiled to WebAssembly for the editor, following ADR-0031 and ADR-0033; the plugin supplies the per-system limits.

### 3. Ferry tool: the water route kit (map editor)

The steps below are the water route kit with the ferry plugin's parameters and checks.

1. **Piers.** Place piers on the shore, or adopt OSM `amenity=ferry_terminal` and existing `route=ferry` ways as hints. Each pier has berths, gangways per berth, a fixed or floating type, and optional shore charging. Piers join `StationGroup`s like stops.
2. **A line is an ordered list of pier calls**, like a rail line (ADR-0032 §2): pick piers in order; both directions are generated from one pattern, with per-direction exceptions. Ends are terminals with a layover.
3. **Routing on water.** A new **water graph** is built from OSM water polygons (`natural=water`, `waterway=riverbank`, coastline) as a navigation mesh with a shore clearance, plus bridges (air draught from `maxheight` or `seamark:bridge:clearance_height`) and locks (`waterway=lock_gate`). The legs between piers are routed on it, with **via points** to shape the path as in the street line tool (ADR-0029). The water graph is a new edge class in the unified graph (ADR-0009), so walk links connect piers to the street network.
4. **Speed zones** (harbour, wash-restricted, canal) are polygons with a speed limit; a vessel's running time uses the lower of zone limit and vessel service speed, plus a berthing manoeuvre at each call.
5. **Checks:** vessel air draught under bridges, draught where the planner gives a depth, berth count against the timetable, energy per round trip against battery and charge during dwell.

### 4. Vehicles

New catalogue folders `vehicles/cable-car/`, `vehicles/aerial-tramway/` and `vehicles/ferry/`, with the same provenance rules (ADR-0026). The schema gains optional groups, all additive:

- **Ropeway cabin:** `ropewaySystem`, `cabinSeats`, `cabinStanding`, `grip` (detachable or fixed), `lineSpeedMax`, `stationSpeed`, `wheelchairSpaces`, `bicycleSpaces`, `windLimitSlow`, `windLimitStop`.
- **Vessel:** `vesselType`, `lengthOverall`, `beam`, `draught`, `airDraught`, `serviceSpeedKn`, `maxSpeedKn`, `passengerCapacity` (as certified), `seats`, `bicycleSpaces`, `wheelchairSpaces`, `gangwaysPerSide`, `regulatoryClass` (for example EU class C/D or HSC), `waveLimitHs`, `minCrew`, plus the existing energy group (battery, charging power, consumption per nautical mile).

### 5. Operations, timetables and simulation

| Topic | Cable car | Aerial tramway | Ferry |
|-------|-----------|----------------|-------|
| Service plan | Operating hours and **line speed** per period (lower speed off-peak saves energy); capacity = cabins per hour × cabin size × planning load | Shuttle timetable from cycle time | Timetable through the existing pipeline (07 §11): suggested frequency from demand, clock-face, layover, vehicle blocks |
| Published timetable | Frequency pattern with headway = cabin interval; the journey planner expands it at no less than 60 s (waiting time is at most the interval, so this is conservative) | Exact trips | Exact trips |
| Reserved resource | None (cabins cannot conflict) | The single track; two cabins pass at mid-span | **Berths** at piers, assigned like platforms (ADR-0032), and lock chambers |
| Engine (core segment engine, plugin rules) | Departures at the cabin interval, section times from rope and station speed, boarding per station | Shuttle trips, cycle time | Section times from speed zones, berthing manoeuvre, dwell from gangway throughput, berth reservation, seeded delays |
| Weather (§5a) | Wind scenario per hour: slow-down above `ropeway.wind_slow_kmh`, stop above `ropeway.wind_stop_kmh`, with replacement buses | Same | Wave height, wind, fog: cancellations or reduced speed per vessel limit |
| Depot | Cabin garage | Cabins stay on the line | Home port berths |

Both modes run on the core mesoscopic segment engine of ADR-0036 §8, driven by the co-simulation coordinator (07 §1). They exchange passengers with the other engines through station groups only; there is no shared right of way with road or rail traffic in v1.

**One addition the segment engine needs.** The interface in ADR-0036 (`depart`, `advance`, `capacity`, `dwell`) has no shared resources. Ferries need **berths** and **lock chambers**, and an aerial tramway needs its single track, as reservable resources: a vessel that finds all berths taken waits outside the pier (a hold event), as a train waits at a signal. We propose a core `reserve(resource, from, to) -> granted | wait_until` call in the segment engine, with resources declared by the infrastructure contribution. Without it, berth conflicts are only checked in the timetable, not simulated.

### 5a. Tide, wind and wave data

Decided by the product owner on 2026-11-02:

- **Tides and water levels are a time series per pier.** Tidal predictions come from a tide provider, and river levels come from a gauge provider. A planner can also upload a series. The series sets the gangway or ramp gradient at each call, so it is checked for step-free access against the accessibility limit. It also sets the air draught under bridges and the depth on the route. A call whose gangway gradient goes over the limit, or a leg that falls below the minimum depth or air draught, is a validation warning for that time window. In a simulation it becomes a cancellation or a diversion.
- **Wind and waves come from a weather service.** For planning, an hourly history over several years (a reanalysis) gives the share of service hours above the cable car's slow-down and stop thresholds and above each vessel's wave limit. These shares feed availability, the appraisal and weather day types (ADR-0020). In a simulation, a chosen day's hourly series drives the weather scenario in §5.
- **Both are providers behind the outbound gateway** (ADR-0017), configured by an Admin like Overpass or WorldPop. Downloads are cached per project and recorded as sources with their licence. Candidates to evaluate are Open-Meteo (historical weather and marine API), Copernicus ERA5 and Copernicus Marine for waves, and national services: NOAA CO-OPS, the UK Admiralty tidal API, BSH, and PEGELONLINE for German rivers *(licences and coverage to verify)*. Without a provider, the planner enters a constant water level and fixed weather shares, and the result is marked as an assumption.

### 6. Assumption library

New parameters, all starting as `educated-guess` or `documented` with `check: unverified` until a maintainer reads the source (sources in R1):

- `ropeway.line_speed_ms`, `ropeway.station_speed_ms`, `ropeway.cabin_interval_s_min`, `ropeway.max_span_m`, `ropeway.max_station_angle_deg`, `ropeway.min_clearance_m`, `ropeway.wind_slow_kmh`, `ropeway.wind_stop_kmh`, `ropeway.overflight_corridor_m`, by `ropeway_system`.
- `ferry.berthing_s`, `ferry.boarding_pax_per_min_per_gangway`, `ferry.harbour_speed_kn`, `ferry.shore_clearance_m`, `ferry.wave_limit_hs_m`, by `vessel_type`; first sources TCQSM 3rd ed. Chapter 9 and TCRP Report 238.
- Existing per-mode parameters (`mode.catchment_m`, `mode.stop_spacing_m`, `mode.colour`, `mode.standing_density_ppm2`, `timetable.layover_min`, cost and energy) get entries for the three new modes. SDG 11.2.1 already counts ferry as high-capacity (ADR-0035).

### 7. Other modes

Follow the ranking in [R1 §3](../research/r1-cable-car-and-ferry.md#3-other-public-mobility-modes-worth-adding):

- **Funicular** ships with this work as a rail mode (`funicular`, GTFS 7) in the railway tool: steep-gradient single track with a passing loop and two counterweighted cars, timetabled as a shuttle.
- **Next:** automated people mover (a rail mode with a guideway system; cable-driven APMs use the straight spans kit), rack railway (rail mode with rack sections), public lifts and outdoor escalators (walk links with capacity and wait), trackless tram (street mode, catalogue only).
- **Separate ADR later:** demand-responsive transport and on-demand pods or water taxis, which need a dispatch model.
- **Excluded** (product owner, 2026-11-02): monorail, air taxis (eVTOL) and hyperloop, because they are not economically sustainable as public transport.

### 8. Phasing

Ordered to fit ADR-0036's phases (registries in its Phase 0, modes and engines in its Phase 3):

1. Funicular in the railway tool (core, needs no plugin work).
2. Assumption parameters and vehicle schema fields for the three modes, registered through the Phase 0 registries; first sourced vehicle files.
3. Straight spans kit with automatic towers, profile view and checks; frequency patterns in the published timetable.
4. Water graph from OSM, pier editor and water route kit.
5. Segment engine with resource reservation; weather scenarios; packaging as the two bundled plugins.

## Alternatives considered

| Option | Why not |
|--------|---------|
| One `cable` mode for gondolas and aerial trams | Their operation differs completely (frequency belt vs timetabled shuttle); two mode ids keep timetables, assumptions and GTFS export simple |
| Draw cable cars with the street line tool (points routed on a graph) | There is no graph to route on; the geometry is straight lines between stations with towers, which is closer to the railway tool |
| Model ferries as straight lines between piers | Underestimates running time and ignores bridges, locks and land; a water graph is needed anyway for walk access and maps |
| Dedicated ropeway and vessel engines in Rust (first draft of this ADR) | Dropped to align with ADR-0036: the generic segment engine covers both modes once it can reserve berths, and other plugin modes reuse it |
| Simulate ferries and ropeways in SUMO | SUMO has no rope or vessel physics that helps here, and neither mode interacts with road traffic in v1; small dedicated engines are simpler and deterministic |
| Include car ferries (ro-pax) now (ADR-0036 lists ro-pax vessels in the ferry plugin) | Product owner, 2026-11-02: later, not now. Needs handover of road vehicles between SUMO and the ferry (like ADR-0007 portals) |

## Consequences

- Planners can design and compare urban ropeways and ferry lines with the same station grouping, journey planner, timetable and appraisal as bus and rail.
- New work, shared with ADR-0036 Phase 3: the straight spans and water route kits, a water graph in the OSM import and unified graph, the segment engine with resource reservation, schema and assumption additions, and catalogue folders inside the two bundled plugins. The 01 Overview out-of-scope list and FR-NET-11 ("all 11 modes") change once this ADR is accepted.
- The model leaves room for on-demand cable pods and water taxis, but does not build the dispatch model they need.
- Product owner answers (2026-11-02): tides and water levels come from **tide data** (§5a); **car ferries later**; wind and waves from a **weather service** (§5a).
