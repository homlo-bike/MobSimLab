# 08 — Vehicle architecture

## 1. Catalogue layout

```text
vehicles/
  schema/vehicle.schema.json          JSON Schema 2020-12 (source of truth)
  bus/            mercedes-benz_citaro-k.json, man_lions-city-12.json, solaris_urbino-12-electric.json …
  brt/            volvo_7900-electric-articulated.json, hess_lightram-25.json, van-hool_exqui-city-24.json …
  trolleybus/     solaris_trollino-18.json, skoda_29tr.json, hess_lightram-trolley-24.json …
  intercity-bus/  setra_s-516-le.json, scania_interlink.json …
  tram/           alstom_citadis-x05.json, siemens_avenio.json, caf_urbos-100.json, stadler_tramlink.json, skoda_forcity-classic.json …
  light-rail/     siemens_s700.json, alstom_citadis-dualis.json, stadler_citylink.json …
  metro/          siemens_inspiro.json, alstom_metropolis.json, hitachi_driverless-metro.json, hyundai-rotem_….json, crrc_….json …
  commuter-rail/  stadler_kiss.json, siemens_mireo.json, alstom_coradia-stream.json, caf_civity.json …
  regional-rail/  stadler_flirt.json, alstom_coradia-lint.json, siemens_desiro-hc.json …
  long-distance-rail/ siemens_viaggio-comfort.json, stadler_smile.json, caf_oaris.json …
  high-speed-rail/    siemens_velaro-d.json, alstom_avelia-horizon.json, hitachi_frecciarossa-1000.json, crrc_cr400af.json …
  _drafts/<mode>/ vehicles still missing a sourced core field (draftReason says which)
  _sources/       sources.yaml  (register entries referenced by vehicle files; same shape as assumptions/sources.yaml)
  _import/        the imported 2026-10-26 catalogue and additions.yaml; tools/vehicles/convert.py regenerates files from it
```

Model names above are **examples of intended coverage**, not a commitment; each file is only added when its key fields are sourced (ADR-0026). File name: `<manufacturer-slug>_<model-slug>.json` (lowercase, ASCII, hyphens); the model slug may carry the variant or operator batch (`siemens_avenio-munich-4-car.json`), because orders of one model differ. Folder names are hyphenated; the `mode` field uses the assumption library ids (`intercity_bus`, `light_rail`, `commuter_rail`, `high_speed_rail` …). `tools/vehicles/check.py` runs in CI (rule 5 below).

Every mode has its own folder, even where the brief merges them (intercity bus is separate from bus because of different dwell, door and luggage assumptions).

Custom vehicles: uploaded or created in the UI, validated against the same schema, stored **inside the project** (`fleet.vehicle_type` with `origin='project'`, and in the `.mslab` export under `vehicles/`). An instance admin may add an **instance library** (a folder on the data volume) shared by all projects.

## 2. Data model

All fields from the brief, grouped. Every leaf numeric field is a `Quantity` = `AssumedValue` with a unit (see 04 §2.3). Lists of positions are measured **from the front coupling face / front bumper, along the vehicle centre line, in metres**.

| Group | Fields |
|-------|--------|
| Identity | `id` (UUIDv7, stable), `schemaVersion`, `name`, `manufacturer`, `model`, `variant`, `type` (e.g. `articulated-bus`, `low-floor-tram`, `emu`, `dmu`, `bemu`, `hst`), `mode`, `yearIntroduced`, `sources[]` |
| Dimensions | `length`, `width`, `height`, `weightEmpty`, `weightLoaded`, `floorHeight` (low/high parts), `platformHeightCompatible[]` |
| Sections | `sections[]`: `{ index, length, pivotFront, pivotRear, bodyWidth, floorHeight }`; `numberOfSegments` (derived) |
| Connections | `connections[]`: `{ between:[i,j], type: articulation-joint | jacobs-bogie | gangway | coupler-semi-permanent | coupler-automatic, maxAngle }` |
| Running gear | `axles[]`: `{ position, powered, load, bogieId? }`; `bogies[]`: `{ id, position, wheelbase, type: motor|trailer|jacobs, sharedBy:[sectionIdx] }`; `wheelDiameter`; `steering` (for buses: steered axles, rear steer) |
| Doors | `doors[]`: `{ side: left|right|both, position, clearWidth, channels, height, step }` |
| Capacity | `seats`, `foldingSeats`, `standingQuoted` and `totalCapacityQuoted` (as published), `standingDensityQuoted`, `standingArea`, `standingDensityPlanning` (pers/m²), `standingCapacity` (derived at density), `wheelchairSpaces`, `bicycleSpaces`, `totalCapacity` (derived) |
| Accessibility | `lowFloorShare`, `ramps`, `lifts`, `kneeling`, `audioVisualInfo`, `priorityseats`, PRM TSI compliance flags |
| Energy | `energySource`: diesel | diesel-hybrid | cng | hvo | battery | hydrogen | overhead | overhead-ac | overhead-dc | overhead-multisystem | third-rail | dual; `supplySystems[]` (ids from `assumptions/supply-systems.yaml`, e.g. `ocl-25kv-50hz`, `trolley-600v-dc`, `third-rail-750v-dc`), `conductorRailContact[]`, `pantographHeadMm`, `onboardEnergy`; `fuelCapacity`, `batteryCapacityUsable`, `range`, `refuelTime`, `rechargeTime` (by charger power), `consumption` (per km, per load, per season), `regenerativeBraking` |
| Performance | `topSpeed`, `designSpeed`, `commercialSpeedTypical` (context-dependent, informational), `maxAcceleration`, `serviceDeceleration`, `emergencyDeceleration`, `jerkLimit`, `tractiveEffortCurve[]` `{v, F}`, `power`, `davis {A,B,C}`, `rotatingMassFactor` |
| Geometry limits | `minRadiusHorizontal`, `recommendedRadius`, `minVerticalRadius` (crest/sag), `maxGradient`, `maxCantDeficiency` (rail), `turningCircle`, `sweptPathRef` (bus) |
| Infrastructure | `trackGauge[]` (mm), `loadingGauge`, `axleLoadMax`, `platformCompatibility[]` (height + gap tolerance), `requiresOverheadWire`, `requiresChargers`, `signallingSystems[]` (e.g. ETCS L2, CBTC) |
| Cost | `costRecords[]` (published order values as reported), `capitalCost` (with currency, price-base year, quantity context), `operatingCostPerKm`, `operatingCostPerHour`, `energyCost` (derived), `lifespanYears`, `midLifeOverhaul` (`year`, `cost`) |
| Maintenance | `maintenanceIntervalKm`, `maintenanceIntervalDays`, `availability` (fraction), `mtbf`, `mttr`, `depotRequirements` |
| Metadata | standard envelope (04 §2.2) plus `legacyId`, `builder`, `operators[]`, `livery` (approximate colours, always an educated guess), `notes`, `trademarkNotice` |

### Example (abridged)

```json
{
  "$schema": "../schema/vehicle.schema.json",
  "schemaVersion": "1.0.0",
  "id": "01920c5e-7a00-7000-8000-000000000001",
  "name": "Example 5-section low-floor tram",
  "manufacturer": "ExampleCo",
  "model": "LF-5",
  "type": "low-floor-tram",
  "mode": "tram",
  "length":  { "value": 32.0, "unit": "m", "assumed": false, "sourceId": "src-brochure-lf5" },
  "width":   { "value": 2.40, "unit": "m", "assumed": false, "sourceId": "src-brochure-lf5" },
  "sections": [
    { "index": 0, "length": 8.6, "pivotFront": 1.9, "pivotRear": 7.6 },
    { "index": 1, "length": 3.2 },
    { "index": 2, "length": 8.2, "pivotFront": 0.0, "pivotRear": 8.2 }
  ],
  "connections": [
    { "between": [0, 1], "type": "articulation-joint", "maxAngle": 0.35 },
    { "between": [1, 2], "type": "articulation-joint", "maxAngle": 0.35 }
  ],
  "doors": [
    { "side": "both", "position": 3.1, "clearWidth": 1.3, "channels": 2 }
  ],
  "capitalCost": {
    "value": 3500000, "unit": "EUR", "priceBaseYear": 2024,
    "assumed": true, "low": 2800000, "central": 3500000, "high": 4500000,
    "rationale": "Range from published tenders 2020-2024 for 30-33 m trams",
    "sourceId": "src-tender-benchmarks-2024"
  },
  "trademarkNotice": "Manufacturer and model names are trademarks of their owners and are used for identification only."
}
```

(The example uses fictitious names on purpose.)

## 3. Provenance rules (ADR-0026)

1. A catalogue file may be merged only if `length`, `width`, `capacity` (seats + standing at stated density), `topSpeed`, `energySource` and `mode` are sourced (not assumed).
2. Every other field is either sourced or an assumption with low/central/high and rationale.
3. Sources are registry entries with licence/terms. Manufacturer brochures are cited as references (facts are not copyrightable; brochure text and images are not copied).
4. Standing capacity is always recomputed from standing area × planning density (project preference, default 4 pers/m²), because manufacturers quote different densities. The manufacturer's quoted figure is kept for reference.
5. CI validates every file against the schema, checks derived fields, checks every `sourceId` exists, and fails on unsourced required fields.

## 4. Vehicles in the domain

```text
VehicleType (catalogue or project)  1 ──< Vehicle (persistent fleet unit)
Vehicle: id, vehicleTypeId, fleetNumber, depotId, homeSlotId|homeTrackId, commissioned, status (active|reserve|maintenance|retired), mileage, energyState
Consist (rail): ordered list of Vehicles coupled for a trip; coupling/uncoupling are timetable events at depots/terminals
```

Vehicles are created by a user (or a "procure N vehicles" action) and are placed in a depot. Retirement is explicit.

## 5. Vehicle–infrastructure compatibility checks

| Check | Rule | Default standard |
|-------|------|------------------|
| Gauge | vehicle gauge ∈ track gauge | Project gauge default 1435 mm |
| Radius | alignment radius ≥ vehicle min radius (error), ≥ recommended (warning) | From vehicle file |
| Gradient | max gradient ≤ vehicle max gradient (error) | From vehicle file |
| Platform height | |platform height − vehicle floor height| ≤ tolerance | EU TSI PRM: 550 or 760 mm for mainline; tram/metro per project standard |
| Horizontal gap | computed from platform offset, vehicle width and curve throw at door positions ≤ limit | TSI PRM step-gap guidance; editable |
| Vertical gap | per door, after kinematic position on curve and cant | editable |
| Platform length | longest consist + stopping tolerance ≤ usable platform length | editable tolerance |
| Electrification | vehicle voltage systems ∩ section electrification ≠ ∅, or onboard energy sufficient | |
| Depot capacity | fleet + reserve fits slots/tracks | Reserve 15 % |

Standards are editable data tables in project preferences, preloaded with TSI PRM-based values and cited.

## 6. Rendering

The frontend gets per-frame `{vehicleId, sectionPoses[{x,y,heading}], doorsOpen, load}` and draws section polygons (deck.gl `PolygonLayer`/`SolidPolygonLayer` with instancing, or `ScenegraphLayer` for 3-D at high zoom). At low zoom vehicles collapse to oriented markers. Geometry is never invented in the browser; it comes from the kinematics crate.
