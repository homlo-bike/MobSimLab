"""Check demand model inputs against contracts/demand-input.schema.json.

Usage: check_demand_input.py FILE.json [FILE.json ...]

Beyond the schema it checks that zone and stop ids are unique, that street links name existing nodes, and
that every pattern names existing stops with one running time fewer than its stops.
"""

import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = ROOT / "contracts" / "demand-input.schema.json"


def reference_errors(d: dict) -> list[str]:
    """Purpose: consistency errors of one input beyond the schema."""
    errs: list[str] = []
    zones = [z["id"] for z in d["zones"]]
    if len(set(zones)) != len(zones):
        errs.append("duplicate zone ids")
    n = len(d["streets"]["nodes"])
    for i, link in enumerate(d["streets"]["links"]):
        if link[0] >= n or link[1] >= n:
            errs.append(f"street link {i} names a node that does not exist")
    stops = [s["id"] for s in d["transit"]["stops"]]
    if len(set(stops)) != len(stops):
        errs.append("duplicate stop ids")
    known = set(stops)
    for line in d["transit"]["lines"]:
        for k, pat in enumerate(line["patterns"]):
            missing = [s for s in pat["stops"] if s not in known]
            if missing:
                errs.append(
                    f"line {line['id']} pattern {k} names unknown stops {missing}"
                )
            if len(pat["run_s"]) != len(pat["stops"]) - 1:
                errs.append(
                    f"line {line['id']} pattern {k} needs one running time fewer than stops"
                )
    return errs


def main(paths: list[str]) -> int:
    """Purpose: validate each file; non-zero exit on any error."""
    validator = Draft202012Validator(json.loads(SCHEMA.read_text()))
    bad = 0
    for p in paths:
        d = json.loads(Path(p).read_text())
        errs = [
            f"{'/'.join(map(str, e.path))}: {e.message}"
            for e in validator.iter_errors(d)
        ]
        if not errs:
            errs = reference_errors(d)
        for e in errs:
            print(f"{p}: {e}")
        bad += bool(errs)
    print(f"{len(paths) - bad}/{len(paths)} demand inputs valid")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
