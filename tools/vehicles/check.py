"""Vehicle catalogue check (08-vehicles.md §3 rule 5).

Fails if any catalogue file:
- does not validate against ``vehicles/schema/vehicle.schema.json``;
- sits in a folder that does not match its ``mode``, or is not named ``<manufacturer>_<model>.json``;
- repeats another file's ``id`` or ``legacyId``;
- cites a source id that is in no source register;
- lists a supply system that ``assumptions/supply-systems.yaml`` does not define (once it exists);
- has a derived capacity value that does not match its inputs;
- points at a schematic that does not exist or is not named after the catalogue file;
- is in the catalogue (not ``_drafts/``) with a core field missing or assumed (ADR-0026).

Also checks that every source register entry has the shared shape.

Usage:
    python tools/vehicles/check.py [--root .]
Exit code 0 if all pass, 1 otherwise (problems printed).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator

sys.path.insert(0, str(Path(__file__).parent))
from catalogue import MODE_FOLDERS, core_gaps  # noqa: E402

SUPPLY_SYSTEMS = "assumptions/supply-systems.yaml"
REGISTERS = ("vehicles/_sources/sources.yaml", "assumptions/sources.yaml")
SOURCE_KEYS = {"id", "title", "publisher", "url", "licence", "access", "retrieved", "checked_via"}
FILE_NAME = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*_[a-z0-9]+(-[a-z0-9]+)*\.json$")


def load_sources(root: Path) -> tuple[set[str], list[str]]:
    """Load all source registers under ``root``; return (ids, problems)."""
    ids: set[str] = set()
    problems: list[str] = []
    for rel in REGISTERS:
        path = root / rel
        if not path.exists():
            continue
        for entry in yaml.safe_load(path.read_text(encoding="utf-8")) or []:
            missing = SOURCE_KEYS - entry.keys()
            if missing:
                problems.append(f"{rel}: {entry.get('id')}: missing {sorted(missing)}")
            if entry.get("id") in ids and rel == REGISTERS[0]:
                problems.append(f"{rel}: duplicate id {entry['id']}")
            ids.add(entry.get("id"))
    return ids, problems


def load_supply_systems(root: Path) -> set[str] | None:
    """Return the supply-system ids defined in the assumption library, or None if it has none yet."""
    path = root / SUPPLY_SYSTEMS
    if not path.exists():
        return None
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or []
    if isinstance(data, dict):
        data = data.get("systems", data)
    if isinstance(data, dict):
        return set(data)
    return {e["id"] for e in data if isinstance(e, dict) and "id" in e}


def quantities(rec: Any, path: str = "") -> Iterator[tuple[str, dict[str, Any]]]:
    """Yield (path, record) for every object in ``rec`` that carries a ``sources`` list."""
    if isinstance(rec, dict):
        if isinstance(rec.get("sources"), list):
            yield path, rec
        for k, v in rec.items():
            if k != "sources":
                yield from quantities(v, f"{path}.{k}" if path else k)
    elif isinstance(rec, list):
        for i, v in enumerate(rec):
            yield from quantities(v, f"{path}[{i}]")


def check_derived(rec: dict[str, Any]) -> list[str]:
    """Check documented capacity derivations against their inputs."""
    problems = []
    seats, total, standing = rec.get("seats"), rec.get("totalCapacityQuoted"), rec.get("standingQuoted")
    if standing and standing["basis"] == "documented" and seats and total:
        if standing["value"] != total["value"] - seats["value"]:
            problems.append("standingQuoted is not totalCapacityQuoted − seats")
    area, density = rec.get("standingArea"), rec.get("standingDensityQuoted")
    if area and standing:
        used = density["value"] if density else 4.0
        if abs(area["value"] - standing["value"] / used) > 0.06:
            problems.append(f"standingArea {area['value']} ≠ {standing['value']} / {used}")
    return problems


def check(root: Path) -> list[str]:
    """Run every check on the catalogue under ``root``; return the problems found."""
    schema = json.loads((root / "vehicles/schema/vehicle.schema.json").read_text(encoding="utf-8"))
    validator = Draft202012Validator(schema)
    source_ids, problems = load_sources(root)
    supply_ids = load_supply_systems(root)
    folder_mode = {v: k for k, v in MODE_FOLDERS.items()}
    seen: dict[str, str] = {}
    for base, draft in ((root / "vehicles", False), (root / "vehicles/_drafts", True)):
        for path in sorted(base.glob("*/*.json")):
            if path.parent.name not in folder_mode:
                continue
            rel = path.relative_to(root).as_posix()
            rec = json.loads(path.read_text(encoding="utf-8"))
            out = [f"{e.json_path}: {e.message}" for e in validator.iter_errors(rec)]
            if rec.get("mode") != folder_mode[path.parent.name]:
                out.append(f"mode {rec.get('mode')!r} does not match folder {path.parent.name}/")
            if not FILE_NAME.match(path.name):
                out.append("file name is not <manufacturer>_<model>.json")
            for key in ("id", "legacyId"):
                if key in rec:
                    other = seen.setdefault(f"{key}:{rec[key]}", rel)
                    if other != rel:
                        out.append(f"{key} {rec[key]} also used by {other}")
            for qpath, q in quantities(rec):
                out += [f"{qpath}: unknown source {s}" for s in q["sources"] if s not in source_ids]
            if supply_ids is not None and "supplySystems" in rec:
                out += [
                    f"supplySystems: {s} is not in {SUPPLY_SYSTEMS}"
                    for s in rec["supplySystems"]["value"]
                    if s not in supply_ids
                ]
            out += check_derived(rec)
            if "schematic" in rec:
                svg = rec["schematic"]["file"]
                if not (root / svg).is_file():
                    out.append(f"schematic {svg} does not exist")
                elif Path(svg).stem != path.stem:
                    out.append(f"schematic {svg} is not named {path.stem}.svg")
            gaps = core_gaps(rec)
            if draft and "draftReason" not in rec:
                out.append("draft without draftReason")
            if not draft and gaps:
                out.append(f"core fields not sourced: {', '.join(gaps)} (move to vehicles/_drafts/)")
            problems += [f"{rel}: {p}" for p in out]
    return problems


def main(argv: list[str] | None = None) -> int:
    """Check the catalogue and print problems; return the exit code."""
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", type=Path, default=Path("."))
    args = ap.parse_args(argv)
    problems = check(args.root)
    for p in problems:
        print(p)
    n = sum(1 for p in (args.root / "vehicles").glob("*/*.json") if p.parent.name in MODE_FOLDERS.values())
    print(f"{len(problems)} problems in {n} catalogue files" if problems else f"OK: {n} catalogue files")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
