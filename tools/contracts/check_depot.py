"""Check saved road depots against contracts/depot.schema.json.

Usage: check_depot.py FILE.json [FILE.json ...]

Beyond the schema it checks that ids are unique, that every lane's zone exists and that the aisles lanes
name exist.
"""

import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = ROOT / "contracts" / "depot.schema.json"


def layout_errors(d: dict) -> list[str]:
    """Purpose: consistency errors of one depot beyond the schema."""
    errs: list[str] = []
    zones = {z["id"] for z in d["zones"]}
    if len(zones) != len(d["zones"]):
        errs.append("duplicate zone ids")
    layout = d.get("layout") or {"lanes": [], "aisles": []}
    aisles = {a["id"] for a in layout["aisles"]}
    if len(aisles) != len(layout["aisles"]):
        errs.append("duplicate aisle ids")
    slots = [s["id"] for lane in layout["lanes"] for s in lane["slots"]]
    if len(set(slots)) != len(slots):
        errs.append("duplicate slot ids")
    for lane in layout["lanes"]:
        if lane["zone"] not in zones:
            errs.append(f"lane {lane['id']}: unknown zone {lane['zone']}")
        for end in ("aisle_in", "aisle_out"):
            a = lane.get(end)
            if a is not None and a not in aisles:
                errs.append(f"lane {lane['id']}: unknown {end} {a}")
    return errs


def main(paths: list[str]) -> int:
    """Purpose: validate each file; print the errors. Output: exit status."""
    validator = Draft202012Validator(json.loads(SCHEMA.read_text(encoding="utf-8")))
    bad = 0
    for p in paths:
        d = json.loads(Path(p).read_text(encoding="utf-8"))
        errs = [
            f"{'/'.join(map(str, e.path))}: {e.message}"
            for e in validator.iter_errors(d)
        ]
        if not errs:
            errs = layout_errors(d)
        for e in errs:
            print(f"{p}: {e}", file=sys.stderr)
        bad += bool(errs)
        if not errs:
            lanes = (d.get("layout") or {}).get("lanes", [])
            print(
                f"{p}: ok ({len(lanes)} lanes, {sum(len(x['slots']) for x in lanes)} slots)"
            )
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
