# Vehicle catalogue

Licence: **CC BY 4.0** (see `CONTRIBUTING.md`). Manufacturer, model and operator names are trademarks of their owners and are used for identification only. Values are facts taken from the sources in `_sources/sources.yaml`; no brochure or encyclopedia text or images are copied.

## Layout

| Path | Content |
|------|---------|
| `<mode>/<manufacturer>_<model>.json` | Catalogue vehicles. Core fields (length, width, seats, standing places, top speed, energy source) are sourced (ADR-0026). |
| `_drafts/<mode>/…` | Vehicles still missing a sourced core field; `draftReason` says which. Usable as project-level vehicles, not shipped as catalogue entries. |
| `_sources/sources.yaml` | Source register, same entry shape as `assumptions/sources.yaml`. |
| `_import/<date>/` | Imported vehicle records the files are generated from: the 2026-10-26 catalogue, unchanged, and `2026-10-27-datasheets/`, transcribed from manufacturer data sheets. |
| `_import/additions.yaml` | Values looked up after the import, each with its source. |
| `schema/vehicle.schema.json` | JSON Schema 2020-12 for one vehicle file. |

Mode folders: `bus`, `brt`, `trolleybus`, `intercity-bus`, `tram`, `light-rail`, `metro`, `commuter-rail`, `regional-rail`, `long-distance-rail`, `high-speed-rail`. The `mode` field uses the assumption library's ids (`intercity_bus`, `light_rail`, …).

## Values and provenance

Every value is a record `{value, unit, assumed, basis, sources, rationale}`, with `basis` one of `cited`, `documented` (derived, working in `rationale`) or `educated-guess` (assumed, with `low`/`central`/`high`). Fields a file leaves out fall back to the assumption library by mode at run time; nothing is invented in the file.

- `standingQuoted` and `totalCapacityQuoted` keep the source's figures. Planning capacity is recomputed from `standingArea` at the project's standing density (08-vehicles.md §3 rule 4). When the source states no density, `standingArea` is an educated guess at 4 pers/m² (range 3–6).
- `supplySystems` lists the electrical supply systems the vehicle can take power from, as ids defined in `assumptions/supply-systems.yaml` (`ocl-25kv-50hz`, `ocl-1000v-dc`, `trolley-600v-dc`, `third-rail-750v-dc`, …).
- `costRecords` are published order values, usually for a whole fleet, not per-vehicle prices.
- `livery` colours are always educated guesses.

## Regenerating and checking

```sh
python tools/vehicles/convert.py      # rebuilds <mode>/, _drafts/ and _sources/ from every _import/<date>/ folder
uv run --no-project --with jsonschema --with pyyaml python tools/vehicles/check.py
```

Edit `_import/additions.yaml` (not the generated files) to add a looked-up value to an imported vehicle. New vehicles that are not from the import can be written by hand; `check.py` validates them the same way.
