# 01 — Overview

## Executive summary

MobSimLab is a self-hosted, open-source web application for planning and simulating public transport networks. A planner draws or imports a network on a map, chooses vehicles from a sourced catalogue, and MobSimLab:

- builds one unified transport graph from OpenStreetMap and the user's designs;
- estimates demand with a four-step model driven by population, jobs and points of interest;
- generates timetables from simulated running times;
- simulates operations: buses, BRT and trolleybuses in SUMO; trams, light rail, metro and all heavy rail in a dedicated rail operations kernel; both coupled where they meet;
- estimates capital, operating and lifecycle cost and runs a full appraisal (FNPV, FIRR, ENPV, ERR, BCR, MCA) with externalities;
- records where every number came from, which values are assumptions, and how sensitive results are to them.

The design rests on five principles:

1. **Reuse mature tools.** SUMO for road traffic, PostGIS for spatial data, AequilibraE for demand modelling, MapLibre for maps, LOOM for schematic layout, the MobilityData validator for GTFS. Build custom code only where no suitable open tool exists, mainly the rail operations kernel.
2. **Persistence and traceability.** Every modelled asset has a global ID, metadata, sources and an audit trail. Nothing appears or vanishes without an explicit, recorded action.
3. **Security first.** OIDC only, no default credentials, first-owner setup mode, encrypted provider credentials, an outbound gateway against SSRF, OWASP ASVS Level 2 as the target.
4. **Simple self-hosting, honest scaling.** `docker compose up` with exactly two containers. Simulation runs in separate supervised processes inside the application container, so a heavy run cannot take the UI down.
5. **Honest numbers.** Every assumption is visible, ranged, sourced and overridable. Results show their uncertainty.

The plan has 11 implementation phases (see [12-implementation-plan.md](12-implementation-plan.md)), starting with three technical spikes to remove the largest risks: SUMO–rail co-simulation, rail kernel performance at 2,000+ trains, and OSM import at regional scale.

## Vision

Give every transit agency, advocacy group, student and researcher a free, transparent tool that produces planning-grade answers about public transport proposals: *How many people will use it? How many vehicles and depots does it need? Can the timetable actually be run? What does it cost and is it worth it?* All results are traceable back to sources and assumptions, so they can be challenged and defended in public.

## Users and their goals

| Persona | Goal | Typical use |
|---------|------|-------------|
| Transit agency planner | Test service changes and new lines | Import GTFS, edit lines, simulate, compare scenarios |
| Advocacy group | Make a credible case for a proposal | Draw a tram line, estimate ridership and cost, export diagram and report |
| Consultant | Produce appraisal-grade analysis | Full cost model, sensitivity, assumptions report |
| Researcher | Study operations and demand | Scripted scenario batches, export raw results |
| Educator / student | Learn transport planning | Tutorials, example projects, transparent formulas |
| Instance administrator | Run the platform safely | OIDC set-up, roles, providers, backups |

## Scope

### In scope (v1.0)

- Map-centric web UI with layers, basemaps and the File menu described in the brief
- OSM import (Overpass and PBF), population rasters (WorldPop, GHSL, uploads), DEM import
- Unified graph: road, rail, walking, cycling
- Network design: stops, stations (with naming, grouping, platforms), lines, routes, track alignment (line, arc, clothoid), validations
- Vehicle catalogue (JSON, sourced) and custom vehicles in project files
- Road simulation of bus, BRT, trolleybus, intercity bus with SUMO, including depots
- Rail operations simulation for tram, light rail, metro, commuter, regional, long-distance and high-speed rail
- Timetable engine with GTFS export
- Four-step demand model
- Cost model and appraisal with externalities and sensitivity analysis
- Assumptions engine and source registry
- Schematic diagram generation and editing
- Projects: private, shared, public; scenarios; import/export
- OIDC auth with roles, groups and audit
- Docker Compose deployment, license and compliance documents generated in CI

### Out of scope (v1.0), candidates for later

- Real-time collaborative editing of the same object (v1 uses optimistic locking and presence, see ADR-0027)
- Activity-based demand models (ActivitySim) — four-step only in v1
- Detailed signalling systems beyond fixed block and simple moving block (ETCS L2/L3 detail, CBTC vendor logic)
- Ferry, aerial cable car, demand-responsive transport, micromobility simulation (GBFS is used as data, not simulated)
- Writing back to OpenStreetMap (forbidden by the brief anyway)
- Multi-tenant SaaS operation with billing
- Mobile apps

### Explicit non-goals

- Engineering-grade alignment design (MobSimLab is planning-grade; see C-09)
- Driver training or train-driving simulation
- Replacing a certified interlocking or safety case

## Glossary

| Term | Meaning |
|------|---------|
| Asset | A persistent modelled object with a global ID (vehicle, stop, track…) |
| Scenario | A named set of changes on top of a project's base network |
| Run | One execution of a simulation for a scenario, day type and seed |
| Day type | A representative day (e.g. "school weekday, winter") used to expand results to a year |
| Pattern | An ordered sequence of stops served by trips of one route |
| Block section | A piece of track that only one train may occupy at a time |
| Route (rail) | A set path through an interlocking from one signal to the next, locked for one train |
| Assumption | A value not supplied by the user or a source, with low/central/high and sensitivity |
| Source | A registry entry describing where data, a method or a value came from, with its licence |
| Provider | A configured external service (Overpass, WorldPop, Nager.Date…) |
