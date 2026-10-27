# Assumption library

This folder is the assumption library from [ADR-0018](../docs/adr/0018-assumption-engine.md) and
[09 §1](../docs/architecture/09-planning-models.md#1-assumptions-architecture-adr-0018). It holds the default value,
range and source of every model parameter. Project Preferences → Parameters is generated from it, so every value
here can be changed per project. There is no built-in AI: a value is cited, derived from documented values, or an
educated guess with the reasoning written down.

- [`DEFAULTS.md`](DEFAULTS.md): all values as readable tables, with a per-mode summary. Generated; do not edit.
- [`sources.yaml`](sources.yaml): the source register (shared with the vehicle catalogue).
- [`supply-systems.yaml`](supply-systems.yaml): the energy supply systems (overhead line, trolleybus wires, third
  and fourth rail) that vehicles declare support for.
- [`switches.yaml`](switches.yaml): the switches and crossings catalogue (turnouts, crossovers, scissors
  crossovers, diamonds, slips) that the railway design tool places between tracks.
- [`parameters/*.yaml`](parameters/): the parameters, one file per Project Preferences group.
- [`../tools/assumptions/check.py`](../tools/assumptions/check.py): validates the library and renders `DEFAULTS.md`.

Licence: the compilation is CC BY 4.0 (ADR-0002). Only numeric values are taken from the cited documents, with a
reference; no text or tables are copied, so paywalled standards can be cited without redistributing them.

## Parameter entry

```yaml
- key: mode.dwell_s                 # stable id used by code and project files
  label: Dwell time at a stop       # shown in Project Preferences
  group: Modes                      # Project Preferences group
  unit: s
  kind: number                      # number (default) | enum | string
  options: [...]                    # enum only
  used_by: [timetable generation, running time]
  values:
    - context: {mode: "*"}          # global fallback, required (CI fails without it)
      low: 15
      central: 30
      high: 60
      basis: documented             # cited | documented | educated-guess
      sources: [tcqsm3]             # ids from sources.yaml; at least one
      check: unverified             # read | secondary | unverified
      rationale: "…"                # clause, derivation or reasoning
    - context: {mode: [bus, trolleybus]}   # more specific entries win
      …
```

Context keys: `mode` (one id or a list) and `traction` (`battery`, `diesel`, `hydrogen`, `cng`, `electric`).
Mode ids: `bus`, `brt`, `trolleybus`, `intercity_bus`, `tram`, `light_rail`, `metro`, `commuter_rail`,
`regional_rail`, `long_distance_rail`, `high_speed_rail`.

**basis** is where the value comes from (09 §1.2). **check** is how far a maintainer has verified it:

| check | Meaning |
|-------|---------|
| `read` | The clause or table was read and matches. |
| `secondary` | Confirmed through a source that quotes it (named in `sources`). |
| `unverified` | A clause reference is given but has not been read against the current text. Confirm before relying on it, then change to `read`. |

The first version (2026-10-27) was compiled without access to the paywalled standards (EN, UIC, DB Ril, FGSV,
AASHTO) and with the German and US legal portals unreachable from the build environment, so most entries are
`unverified`. Reading the clauses and flipping `check` to `read` (or correcting the value) is the main follow-up.

## Source entry

```yaml
- id: tsi-inf                       # short kebab-case, no prefix
  title: "…"
  publisher: European Union
  url: https://eur-lex.europa.eu/eli/reg/2014/1299/oj
  licence: "…"                      # licence or terms of the cited document
  access: free                      # free | paywalled | on-request
  retrieved: 2026-10-27             # date the URL was last opened or checked
  checked_via: search-snippet       # direct | search-snippet | none
  kind: primary                     # optional: primary | secondary
  note: "…"                         # optional
```

## Energy supply systems

`supply-systems.yaml` defines one entry per supply system, with ids of the form `<collection>-<voltage>`:
`ocl-600v-dc`, `ocl-750v-dc`, `ocl-1000v-dc`, `ocl-1500v-dc`, `ocl-3000v-dc`, `ocl-15kv-16-7hz`, `ocl-25kv-50hz`,
`trolley-600v-dc`, `trolley-750v-dc`, `third-rail-750v-dc`, `third-rail-1500v-dc`, `fourth-rail-630v-dc`.
Each attribute (voltages, frequency, contact wire height, pantograph head widths, trolley wire spacing,
conductor-rail contact position, standstill current, power factor) uses the same value-entry shape as a parameter,
so it carries basis, sources, check and rationale and is editable in Project Preferences.

The voltage limits follow EN 50163 / IEC 60850: Umin1–Umax1 is the permanent range, Umin2 and Umax2 the
short-time limits. `mode.new_track_electrification` takes its options from these ids (the checker enforces it).

Vehicle compatibility (08 §5, Electrification row), checked per section:

| Vehicle field | Rule | Severity |
|---------------|------|----------|
| `supplySystems` (list of ids) | contains the section's supply system id, or the vehicle has enough onboard energy for the section | error |
| voltage range (from the vehicle file, or the system's Umin1–Umax1 if absent) | covers the system's Umin1–Umax1 | error |
| `pantographHeadMm` | is one of the system's `pantograph_head_mm` options | error if set, warning if missing |
| `conductorRailContact` (list) | includes the system's contact position for that line | error if set, warning if missing |
| pantograph working range | covers the line's contact wire height | warning |

## Switches and crossings

`switches.yaml` is the catalogue from [ADR-0030](../docs/adr/0030-railway-design-tool.md) point 5: the railway design
tool joins tracks only by placing one of these elements, and refuses geometry no element can build, so every
connection has a real length, angle, radius and speed and no sharp corners. Each attribute uses the value-entry shape
above (basis, sources, check, rationale, and low/high where uncertain), so the planner can change it in Project
Preferences.

### Geometry model

All lengths are along the track centre line at true size.

```text
             a                     b
  S ──────────────────── IP ─────────────────── E  (through track, straight)
    ╲__  diverging curve, radius R  ╲__
                                        ╲__ ─ ─ ─ ─ E' (diverging track; IP→E' = b, at angle α)
```

- **S**, start of the switch (blade tip); **IP**, the intersection point of the through and diverging centre lines;
  **E** and **E'**, the ends of the two legs. `length_a_m` is S→IP, `length_b_m` is IP→E and IP→E' (equal on both
  legs), `total_length_m` = a + b.
- `crossing_ratio_n` is the crossing angle as 1:n, so tan α = 1/n. The diverging leg leaves E' at angle α, which is
  what the drawing tool needs to attach the next alignment tangentially. North American frog numbers N
  (`arema-no*`) are converted with α = 2·atan(1/(2N)).
- `diverging_radius_m` is the smallest radius of the diverging track. `geometry` says how it runs:
  - `curved-crossing`: one circular curve from S to E', so a = b = R·tan(α/2) (checked by the CI script);
  - `straight-crossing`: the curve ends before the crossing and the crossing leg is straight, so a and b differ;
  - `transition`: clothoid or compound curve (high-speed turnouts); a and b are given, the curve shape is fitted.
- `crossing`: `rigid` crossing or `movable` point (DB "fb").
- **Crossovers** (`crossover`, `scissors_crossover`) are built from two turnouts (`built_from`) at a track centre
  distance d: the two IPs lie d·n apart along the track, so total length = 2·a + d·n. Speeds are those of the
  turnout. A scissors crossover adds a middle diamond at twice the turnout angle (`diamond_ratio_n`) and needs
  d·sqrt(n² + 1) ≥ 2·b so the legs meet clear of it; the CI script checks both rules. For another track centre
  distance the tool builds the crossover from the turnout with the same formula.
- **Diamonds** and **slips** (`single_slip`, `double_slip`) are symmetrical about their centre: a and b are the
  half-lengths along either track; `crossing_angle_deg` replaces `crossing_ratio_n` for right-angle tram crossings.
- `diverging_speed_kmh` and `through_speed_kmh` are the speed limits of the element. For a radius not in the
  catalogue the tool uses v = sqrt(I·R / 11.8) with I = `switch.cant_deficiency_mm` (no cant in the diverging
  track), which reproduces the DB standard speeds.
- `switch.default_turnout` is the element offered first per mode.

### Coverage and confidence

The first version (2026-10-27) covers DB/EN standard turnouts (1:9 to 1:42), ADIF and SNCF high-speed turnouts,
Chinese No. 9 (metro), 12, 18 and 42, AREMA No. 8 to 20, grooved-rail tram turnouts (R 25, 50, 100 m), crossovers and
scissors crossovers for each family, a 1:9 diamond, 1:9 single and double slips and a right-angle tram crossing.
It was compiled from search results only: the build environment could not open the source pages, so no entry is
`read`. Where a length was not found it is derived from the standard geometry (`documented`) or estimated with a
wide range (`educated-guess`), and the rationale says which. Reading the DB drawings (Ril 800.0120), the AREMA
Manual chapter 5 and a tram operator's turnout catalogue would raise most entries to `read`.

Not yet in the catalogue: symmetrical (Y) and three-way turnouts, curved (in-curve) turnouts, tram turnouts with
other operators' geometry, Network Rail (UK) designs and flange-bearing tram crossings at other angles.

## Adding or changing a value

1. Add or edit the entry in `parameters/`, and the source in `sources.yaml`.
2. Run `python3 tools/assumptions/check.py --render` and commit `DEFAULTS.md` with the change.
3. In the PR, say which clause you read. A value that changes a published default marks dependent results stale
   (09 §1.5), so note it in the release notes.

## Where each requested setting lives

The first list of settings was modelled on the settings of Ferrovia (CGS Labs); the values here are
taken from standards and literature, not from that tool.

| Setting | Key |
|---------|-----|
| Spare vehicles, share of the vehicles in peak service | `mode.spare_share` |
| Track centre distance | `track.centre_distance_m` |
| Distance for suggesting tracks at a station | `station.track_suggest_distance_m` |
| Wheel–rail adhesion for starting | `sim.start_adhesion` |
| Time gap to the vehicle ahead, buses and trams on sight | `sim.time_gap_s` |
| Minimum gap to the vehicle ahead when stopped | `sim.min_gap_stopped_m` |
| Track centre distance at the clearance marker | `track.clearance_marker_centre_distance_m` |
| Signal overlap 31–40 / 41–60 / above 60 km/h | `signalling.overlap_31_40_m`, `signalling.overlap_41_60_m`, `signalling.overlap_above_60_m` |
| Minimum distance between following metro and commuter trains | `sim.rail_min_following_distance_m` |
| Platform length, tram / light rail / metro / commuter rail | `mode.platform_length_m` (per mode) |
| Side platform width, island platform width | `platform.side_width_m`, `platform.island_width_m` |
| Clearance before and after a crossing | `crossing.clearance_m` |
| Speed of empty runs to the depot | `operations.depot_run_speed_kmh` |
| Cant and cant deficiency, tram and light rail | `curve.cant_tram_mm`, `curve.cant_deficiency_tram_mm` |
| Cant and cant deficiency, metro and railway | `curve.cant_rail_mm`, `curve.cant_deficiency_rail_mm` |
| Track gauge for drawing the rails | `mode.new_track_gauge_mm` |
| Bridge and tunnel outline width | `structure.outline_width_m` |
| Recovery time share | `timetable.recovery_share` |
| Street depot layout (six settings) | `depot.vehicles_per_lane`, `depot.lateral_spacing_m`, `depot.walkway_width_m`, `depot.walkway_every_n_lanes`, `depot.aisle_width_m`, `depot.longitudinal_gap_m` |
| Lane width, lanes of a carriageway | `street.lane_width_m`, `street.lanes` |
| Layover at each terminal | `timetable.layover_min` |
| Energy reserve in battery or tank | `operations.energy_reserve_share` |
| Rail temperature above air; rail design temperature | `climate.rail_temp_above_air_c`, `climate.rail_design_temp_c` |
| Battery buses: cool range and cold band (six settings) | `ebus.cool_band_low_c`, `ebus.cool_band_high_c`, `ebus.cool_extra_share`, `ebus.cold_band_low_c`, `ebus.cold_band_high_c`, `ebus.cold_extra_share` |
| A call counts as late from | `recording.late_threshold_s` |
| Level access gaps | `access.level_gap_horizontal_mm`, `access.level_gap_vertical_mm` |
| Step limits | `access.step_gap_horizontal_mm`, `access.step_above_platform_mm`, `access.step_below_platform_mm` |
| Stop reuse distance | `stop.reuse_distance_m` |
| Depth per underground level; height per elevated level | `structure.underground_level_depth_m`, `structure.elevated_level_height_m` |
| Steepest gradient at a platform | `platform.max_gradient_pct` |
| Walking speed | `demand.walk_speed_kmh` |
| Refuelling time at the depot | `operations.refuel_time_min` |
| Heating and air-conditioning power | `energy.hvac_power_kw` |
| Air temperature at which the contact line sags | `climate.ocl_sag_air_temp_c` |
| Driving side; running side of new double track | `street.driving_side`, `track.running_side` |
| Per-mode columns: curve radius min/recommended, max speed, dwell, spares, standing places, colour, catchment, structure/right of way, platform, following distance, acceleration/braking, new track gauge/electrification | `mode.*` (see the mode table in `DEFAULTS.md`) |
| Crossing priority | `mode.crossing_priority_rank` |
| Switches and crossings (geometry, speeds) | `switches.yaml`, `switch.cant_deficiency_mm`, `switch.default_turnout` |
