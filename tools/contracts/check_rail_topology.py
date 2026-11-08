"""Check railway topology exports against contracts/rail-topology.schema.json.

Usage: check_rail_topology.py FILE.json [FILE.json ...]

Beyond the schema it checks that the graph is consistent: every section's nodes exist, every
link joins ends of sections at that node, and switches, platform edges, crossings, level crossings and depot
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
        (
            f"switch {w['id']}",
            w["legs"]
            + w["conflict_sections"]
            + [x for f in w["fouling_points"] for x in (f["section"], f["at_section"])],
        )
        for w in t["switches"]
    ]
    node_ids = {n["id"] for n in t["nodes"]}
    errs += [
        f"switch {w['id']}: fouling point at unknown node {f['node']}"
        for w in t["switches"]
        for f in w["fouling_points"]
        if f["node"] not in node_ids
    ]
    refs += [(f"platform edge {p['id']}", [p["section"]]) for p in t["platform_edges"]]
    refs += [
        (f"crossing {c['id']}", [x for tr in c["tracks"] for x in tr["sections"]])
        for c in t["crossings"]
    ]
    refs += [(f"level crossing {x['id']}", x["sections"]) for x in t["level_crossings"]]
    refs += [(f"depot group {d['id']}", d["sections"]) for d in t["depot_groups"]]
    refs += [(f"signal {g['id']}", [g["section"]]) for g in t["signals"]]
    refs += [(f"street running {r['id']}", r["sections"]) for r in t["street_running"]]
    errs += [
        f"existing join of track {j['track']}: unknown node {n}"
        for j in t["existing_joins"]
        for n in j["nodes"]
        if n not in node_ids
    ]
    refs += [
        (
            f"slip in {c['id']}",
            [
                x
                for r in c["slip"]["routes"]
                for e in (r["from"], r["to"])
                for x in e["sections"]
            ],
        )
        for c in t["crossings"]
        if c["slip"]
    ]
    ids = [g["id"] for g in t["signals"]]
    if len(set(ids)) != len(ids):
        errs.append("duplicate signal ids")
    for g in t["signals"]:
        s = sections.get(g["section"])
        if s is not None and g["chainage_m"] > s["length_m"] + 0.01:
            errs.append(f"signal {g['id']}: chainage beyond the end of {g['section']}")
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
