"""Licence gate: fail CI if any dependency has a licence outside the policy.

Reads dependency lists from the three ecosystems and checks every licence expression
against ``policy.json``. An expression passes if at least one ``OR`` alternative has all
of its ``AND`` parts allowed. Unknown or missing licences fail unless the package is listed
in the policy with a verified licence.

Usage:
    python license_gate.py --npm npm.json --python py.json --cargo cargo.json

Inputs (all optional, any combination):
    --npm     output of ``pnpm licenses list --prod --json``
    --python  output of ``pip-licenses --format=json``
    --cargo   output of ``cargo metadata --format-version 1``
Exit code 0 if all pass, 1 otherwise (offending packages printed).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections.abc import Iterable
from pathlib import Path

POLICY = json.loads((Path(__file__).parent / "policy.json").read_text(encoding="utf-8"))


def normalise(token: str) -> str:
    """Map a licence name to its SPDX id using the policy aliases.

    ``X WITH <exception>`` maps to ``X`` when the exception is in the policy's allowed exceptions.
    """
    token = token.strip().strip("()").strip()
    if " WITH " in token:
        base, exc = (t.strip() for t in token.split(" WITH ", 1))
        return base if exc in POLICY["exceptions"] else token
    return POLICY["aliases"].get(token, token)


def expression_allowed(expr: str) -> bool:
    """Return True if the SPDX-like expression is satisfiable with allowed licences.

    Args:
        expr: Expression such as ``"MIT OR Apache-2.0"`` or ``"(MIT AND Zlib)"``. Also accepts
            ``"/"`` and ``";"`` separators used by some package metadata as OR.

    Returns:
        Whether at least one alternative consists only of allowed licences.
    """
    if not expr or not expr.strip():
        return False
    allowed = set(POLICY["allowed"])
    if POLICY["aliases"].get(expr.strip()) in allowed:
        return True
    flat = expr.replace("(", " ").replace(")", " ")
    for alt in re.split(r"\s+OR\s+|/|;", flat):
        parts = [normalise(p) for p in re.split(r"\s+AND\s+", alt) if p.strip()]
        if parts and all(p in allowed for p in parts):
            return True
    return False


def check(entries: Iterable[tuple[str, str, str]]) -> list[str]:
    """Check (ecosystem, package, licence) triples.

    Returns:
        Human-readable failures; empty if everything passes.
    """
    failures = []
    for eco, name, lic in entries:
        if name in POLICY["packages"]:
            continue
        if not expression_allowed(lic):
            failures.append(f"{eco}: {name}: '{lic or 'UNKNOWN'}' is not allowed by the licence policy")
    return failures


def npm_entries(data: dict[str, list[dict[str, object]]]) -> Iterable[tuple[str, str, str]]:
    """Yield entries from ``pnpm licenses list --json`` output (grouped by licence)."""
    for lic, pkgs in data.items():
        for p in pkgs:
            yield "npm", str(p.get("name")), lic


def python_entries(data: list[dict[str, str]]) -> Iterable[tuple[str, str, str]]:
    """Yield entries from ``pip-licenses --format=json`` output."""
    for p in data:
        lic = p.get("License-Expression") or p.get("License", "")
        if lic == "UNKNOWN":
            lic = ""
        yield "python", p["Name"], lic


def cargo_entries(data: dict[str, list[dict[str, str | None]]]) -> Iterable[tuple[str, str, str]]:
    """Yield entries from ``cargo metadata`` output."""
    for p in data["packages"]:
        yield "cargo", str(p["name"]), p.get("license") or ""


def main(argv: list[str] | None = None) -> int:
    """Run the gate. Returns the process exit code."""
    ap = argparse.ArgumentParser()
    ap.add_argument("--npm")
    ap.add_argument("--python")
    ap.add_argument("--cargo")
    a = ap.parse_args(argv)
    entries: list[tuple[str, str, str]] = []
    if a.npm:
        entries += npm_entries(json.loads(Path(a.npm).read_text(encoding="utf-8")))
    if a.python:
        entries += python_entries(json.loads(Path(a.python).read_text(encoding="utf-8")))
    if a.cargo:
        entries += cargo_entries(json.loads(Path(a.cargo).read_text(encoding="utf-8")))
    failures = check(entries)
    for f in failures:
        print(f, file=sys.stderr)
    print(f"licence gate: {len(entries)} packages checked, {len(failures)} not allowed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
