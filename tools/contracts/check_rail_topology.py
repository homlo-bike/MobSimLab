"""Check railway topology exports against contracts/rail-topology.schema.json.

Usage: check_rail_topology.py FILE.json [FILE.json ...]

Beyond the schema it checks that the graph is consistent: every section's nodes exist, every
link joins ends of sections at that node, and switches, platform edges, crossings and depot
groups refer to sections that exist.
"""

import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = ROOT / "contracts" / "rail-topology.schema.json"


def graph_errors(t: dict) -> list[str]:
    """Purpose: consistency errors of one topology beyond the schema."""
    errs: list[str] = []
    nodes = {n["id"] for n in t["nodes"]}
    sections = {s["id"]: s for s in t["sections"]}
    if len(sections) != len(t["sections"]):
        errs.append("duplicate section ids")
    for s in t["sections"]:
        for end in ("from", "to"):
            if s[end] not in nodes:
                errs.append(f"section {s['id']}: unknown {end} node {s[end]}")
    for link in t["links"]:
        for side in ("a", "b"):
            e = link[side]
            s = sections.get(e["section"])
            if s is None:
                errs.append(f"link at {link['node']}: unknown section {e['section']}")
            elif s[e["end"]] != link["node"]:
                errs.append(
                    f"link at {link['node']}: {e['section']} {e['end']} is at {s[e['end']]}"
                )
    refs = [
        (f"switch {w['id']}", w["legs"] + w["conflict_sections"]) for w in t["switches"]
    ]
    refs += [(f"platform edge {p['id']}", [p["section"]]) for p in t["platform_edges"]]
    refs += [
        (f"crossing {c['id']}", [x for tr in c["tracks"] for x in tr["sections"]])
        for c in t["crossings"]
    ]
    refs += [(f"depot group {d['id']}", d["sections"]) for d in t["depot_groups"]]
    for what, ids in refs:
        errs += [f"{what}: unknown section {i}" for i in ids if i not in sections]
    return errs


def main(paths: list[str]) -> int:
    """Purpose: check the files; print what is wrong. Output: the exit status."""
    validator = Draft202012Validator(json.loads(SCHEMA.read_text()))
    bad = 0
    for path in paths:
        t = json.loads(Path(path).read_text())
        errs = [
            f"{'/'.join(map(str, e.absolute_path))}: {e.message}"
            for e in validator.iter_errors(t)
        ]
        if not errs:
            errs = graph_errors(t)
        for e in errs[:20]:
            print(f"{path}: {e}")
        bad += bool(errs)
    print(
        f"{'FAIL' if bad else 'OK'}: {len(paths) - bad} of {len(paths)} topology files valid"
    )
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
