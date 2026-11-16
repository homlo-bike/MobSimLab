#!/usr/bin/env python3
"""Export the design rules per rail mode for Project preferences (ADR-0018, ADR-0030).

Usage:
  python3 tools/design-rules/export_defaults.py           # write apps/web/src/workspace/design-rules.generated.json
  python3 tools/design-rules/export_defaults.py --check   # fail if it is stale

Reads assumptions/parameters (validated by tools/assumptions/check.py) and writes, for each design rule the
railway design tool checks, the field of its design values (crates/rail-design ModeParams), label and unit,
and per rail mode the library key and [low, central, high], resolved the way check.py resolves the rail
export. A project's own value is kept in its preferences as `<key>.<mode>`.

The platform accessibility rules (ACCESS_RULES) are checked in the web app, not by the rail engine, so they are
written with `"engine": false`; the rail engine ignores them.

It also writes the switches and crossings the railway editor places from the catalogue (turnouts and
slips, from crates/rail-design/data/defaults.json, rendered by check.py) and the library's default turnout
per rail mode, so a project can choose which it uses.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "apps" / "web" / "src" / "workspace" / "design-rules.generated.json"

# Design value field -> library key, or (key for tram and light rail, key for the other rail modes, label).
RULES: dict[str, str | tuple[str, str, str]] = {
    "gauge_mm": "mode.new_track_gauge_mm",
    "design_speed_kmh": "mode.max_speed_kmh",
    "track_centre_m": "track.centre_distance_m",
    "min_radius_m": "mode.min_curve_radius_m",
    "recommended_radius_m": "mode.recommended_curve_radius_m",
    "max_gradient_permille": "mode.max_gradient_permille",
    "vertical_radius_m": "curve.vertical_radius_m",
    "max_cant_mm": (
        "curve.cant_tram_mm",
        "curve.cant_rail_mm",
        "Cant (superelevation), maximum",
    ),
    "max_cant_deficiency_mm": (
        "curve.cant_deficiency_tram_mm",
        "curve.cant_deficiency_rail_mm",
        "Cant deficiency, maximum",
    ),
    "platform_length_m": "mode.platform_length_m",
    "platform_height_mm": "mode.platform_height_mm",
    "side_platform_width_m": "platform.side_width_m",
    "island_platform_width_m": "platform.island_width_m",
    "platform_edge_offset_m": "platform.edge_offset_m",
    "stopping_tolerance_m": "platform.stopping_tolerance_m",
    "acceleration_ms2": "mode.acceleration_ms2",
    "service_braking_ms2": "mode.service_braking_ms2",
}
# Platform accessibility check (TSI PRM step and gap, apps/web/src/features/railways/platformAccess.ts).
ACCESS_RULES: dict[str, str] = {
    "level_gap_horizontal_mm": "access.level_gap_horizontal_mm",
    "level_gap_vertical_mm": "access.level_gap_vertical_mm",
    "step_gap_horizontal_mm": "access.step_gap_horizontal_mm",
    "step_above_platform_mm": "access.step_above_platform_mm",
    "step_below_platform_mm": "access.step_below_platform_mm",
    "vehicle_floor_height_mm": "vehicle.floor_height_mm",
}
TRAM_LIKE = {"tram", "light_rail"}
RAIL_EXPORT = ROOT / "crates" / "rail-design" / "data" / "defaults.json"
# Catalogue elements the railway editor places, and the fields Project preferences shows.
SWITCH_ELEMENTS = ("turnout", "single_slip", "double_slip")
SWITCH_FIELDS = (
    "id",
    "label",
    "element",
    "typical_modes",
    "crossing_ratio_n",
    "radius_m",
    "diverging_speed_kmh",
)


def assumption_check():
    """tools/assumptions/check.py as a module (its parameter loader, mode list and resolve rule)."""
    spec = importlib.util.spec_from_file_location(
        "assumption_check", ROOT / "tools" / "assumptions" / "check.py"
    )
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def render() -> str:
    ac = assumption_check()
    by_key = {p["key"]: p for p in ac.load_parameters()}
    rules = []
    specs = [(f, k, True) for f, k in RULES.items()] + [
        (f, k, False) for f, k in ACCESS_RULES.items()
    ]
    for field, spec, engine in specs:
        label = None
        modes = {}
        for m in ac.RAIL_MODES:
            if isinstance(spec, tuple):
                key = spec[0] if m in TRAM_LIKE else spec[1]
                label = spec[2]
            else:
                key = spec
            p = by_key[key]
            v = ac.resolve(p, m)
            modes[m] = {
                "key": key,
                "values": [
                    v.get("low", v["central"]),
                    v["central"],
                    v.get("high", v["central"]),
                ],
            }
            unit = p["unit"]
        rules.append(
            {
                "field": field,
                "label": label or by_key[spec]["label"],
                "unit": unit,
                "engine": engine,
                "modes": modes,
            }
        )
    rail = json.loads(RAIL_EXPORT.read_text(encoding="utf-8"))
    switches = [
        {f: sw.get(f) for f in SWITCH_FIELDS}
        for sw in rail["switches"]
        if sw["element"] in SWITCH_ELEMENTS
    ]
    default_turnout = {m: rail["modes"][m]["default_turnout"] for m in ac.RAIL_MODES}
    # Every numeric design value of the rail engine and its library key per mode, so a value the project
    # sets in Project preferences (for every mode or for one) reaches the engine.
    engine_keys = {}
    for m in ac.RAIL_MODES:
        row = {}
        for field, key in ac.RAIL_FIELDS.items():
            if key and isinstance(rail["modes"][m].get(field), (int, float)):
                row[field] = key
        for field, spec in RULES.items():
            if isinstance(spec, tuple):
                row[field] = spec[0] if m in TRAM_LIKE else spec[1]
        engine_keys[m] = dict(sorted(row.items()))
    data = {
        "_comment": "Generated by tools/design-rules/export_defaults.py from assumptions/parameters. Do not edit by hand.",
        "rules": rules,
        "switches": switches,
        "default_turnout": default_turnout,
        "engine_keys": engine_keys,
    }
    return json.dumps(data, indent=1, ensure_ascii=False) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    text = render()
    if a.check:
        if not OUT.exists() or OUT.read_text(encoding="utf-8") != text:
            print(
                f"{OUT.relative_to(ROOT)} is stale; run tools/design-rules/export_defaults.py",
                file=sys.stderr,
            )
            return 1
        print("OK: design rule defaults up to date")
        return 0
    OUT.write_text(text, encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
