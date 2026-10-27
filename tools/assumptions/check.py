#!/usr/bin/env python3
"""Validate the assumption library (ADR-0018) and render it as Markdown.

Usage:
  python3 tools/assumptions/check.py            # validate only
  python3 tools/assumptions/check.py --render   # validate and write assumptions/DEFAULTS.md
  python3 tools/assumptions/check.py --check-rendered  # fail if DEFAULTS.md is stale
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
LIB = ROOT / "assumptions"
OUT = LIB / "DEFAULTS.md"

MODES = [
    "bus",
    "brt",
    "trolleybus",
    "intercity_bus",
    "tram",
    "light_rail",
    "metro",
    "commuter_rail",
    "regional_rail",
    "long_distance_rail",
    "high_speed_rail",
]
TRACTIONS = ["battery", "diesel", "hydrogen", "cng", "electric"]
GROUP_ORDER = [
    "Modes",
    "Operations",
    "Demand",
    "Simulation",
    "Infrastructure standards",
    "Accessibility",
    "Depots and streets",
    "Energy and climate",
]
BASES = {"cited", "documented", "educated-guess"}
CHECKS = {"read", "secondary", "unverified"}
ACCESS = {"free", "paywalled", "on-request"}
CHECKED_VIA = {"direct", "search-snippet", "none"}
SOURCE_FIELDS = {
    "id",
    "title",
    "publisher",
    "url",
    "licence",
    "access",
    "retrieved",
    "checked_via",
    "kind",
    "note",
}
PARAM_FIELDS = {"key", "label", "group", "unit", "kind", "options", "used_by", "values"}
VALUE_FIELDS = {
    "context",
    "low",
    "central",
    "high",
    "basis",
    "sources",
    "check",
    "rationale",
}


def load_sources() -> dict[str, dict]:
    data = yaml.safe_load((LIB / "sources.yaml").read_text(encoding="utf-8"))
    return {s["id"]: s for s in data}


def load_parameters() -> list[dict]:
    params = []
    for path in sorted((LIB / "parameters").glob("*.yaml")):
        for p in yaml.safe_load(path.read_text(encoding="utf-8")) or []:
            p["_file"] = path.name
            params.append(p)
    return params


def as_list(v):
    return v if isinstance(v, list) else [v]


def validate(sources: dict[str, dict], params: list[dict]) -> list[str]:
    errors: list[str] = []
    for sid, s in sources.items():
        if extra := set(s) - SOURCE_FIELDS:
            errors.append(f"source {sid}: unknown fields {sorted(extra)}")
        for f in ("title", "url", "licence", "access", "retrieved", "checked_via"):
            if not s.get(f):
                errors.append(f"source {sid}: missing {f}")
        if s.get("access") not in ACCESS:
            errors.append(f"source {sid}: access must be one of {sorted(ACCESS)}")
        if s.get("checked_via") not in CHECKED_VIA:
            errors.append(
                f"source {sid}: checked_via must be one of {sorted(CHECKED_VIA)}"
            )
        if s.get("kind") not in (None, "primary", "secondary"):
            errors.append(f"source {sid}: kind must be primary or secondary")

    used_sources: set[str] = set()
    seen_keys: set[str] = set()
    for p in params:
        key = p.get("key", f"<no key in {p['_file']}>")
        if key in seen_keys:
            errors.append(f"{key}: defined twice")
        seen_keys.add(key)
        if extra := set(p) - PARAM_FIELDS - {"_file"}:
            errors.append(f"{key}: unknown fields {sorted(extra)}")
        for f in ("label", "group", "unit", "used_by", "values"):
            if not p.get(f):
                errors.append(f"{key}: missing {f}")
        if any(not isinstance(u, str) for u in p.get("used_by", [])):
            errors.append(
                f"{key}: used_by entries must be strings (quote entries containing ': ')"
            )
        kind = p.get("kind", "number")
        if kind == "enum" and not p.get("options"):
            errors.append(f"{key}: enum without options")

        has_global = False
        seen_ctx: set[str] = set()
        for v in p.get("values", []):
            ctx = v.get("context") or {}
            ctx_id = repr(sorted((k, tuple(as_list(x))) for k, x in ctx.items()))
            where = f"{key} {ctx}"
            if ctx_id in seen_ctx:
                errors.append(f"{where}: duplicate context")
            seen_ctx.add(ctx_id)
            if ctx == {"mode": "*"}:
                has_global = True
            for m in as_list(ctx.get("mode", "*")):
                if m != "*" and m not in MODES:
                    errors.append(f"{where}: unknown mode {m}")
            for t in as_list(ctx.get("traction", [])):
                if t not in TRACTIONS:
                    errors.append(f"{where}: unknown traction {t}")
            if extra := set(v) - VALUE_FIELDS:
                errors.append(f"{where}: unknown fields {sorted(extra)}")
            if v.get("basis") not in BASES:
                errors.append(f"{where}: basis must be one of {sorted(BASES)}")
            if v.get("check") not in CHECKS:
                errors.append(f"{where}: check must be one of {sorted(CHECKS)}")
            if not v.get("rationale"):
                errors.append(f"{where}: missing rationale")
            if not v.get("sources"):
                errors.append(f"{where}: no sources")
            for sid in v.get("sources", []):
                used_sources.add(sid)
                if sid not in sources:
                    errors.append(f"{where}: unknown source {sid}")
            if "central" not in v:
                errors.append(f"{where}: missing central")
            if kind == "number":
                nums = [
                    v.get(k) for k in ("low", "central", "high") if v.get(k) is not None
                ]
                if any(not isinstance(n, (int, float)) for n in nums):
                    errors.append(f"{where}: low/central/high must be numbers")
                elif (
                    v.get("low") is not None
                    and v.get("high") is not None
                    and not (v["low"] <= v["central"] <= v["high"])
                ):
                    errors.append(f"{where}: needs low <= central <= high")
            if kind == "enum":
                for k in ("low", "central", "high"):
                    if v.get(k) is not None and v[k] not in p.get("options", []):
                        errors.append(f"{where}: {k}={v[k]!r} not in options")
        if not has_global:
            errors.append(f"{key}: no global fallback entry (context mode '*')")

    for sid in sorted(set(sources) - used_sources):
        errors.append(f"source {sid}: defined but never used")
    return errors


def fmt(v) -> str:
    return "–" if v is None else str(v)


def fmt_ctx(ctx: dict) -> str:
    parts = []
    for k, x in ctx.items():
        vals = ", ".join(str(i) for i in as_list(x))
        parts.append(
            "all"
            if (k == "mode" and vals == "*")
            else (vals if k == "mode" else f"{k}: {vals}")
        )
    return "; ".join(parts)


def resolve(p: dict, mode: str) -> dict:
    """Most specific entry for a mode with no other context keys, else the global fallback."""
    for v in p["values"]:
        ctx = v["context"]
        if set(ctx) == {"mode"} and mode in as_list(ctx["mode"]):
            return v
    return next(v for v in p["values"] if v["context"] == {"mode": "*"})


def render(sources: dict[str, dict], params: list[dict]) -> str:
    lines = [
        "# Default parameter values",
        "",
        "<!-- Generated by tools/assumptions/check.py --render from assumptions/. Do not edit by hand. -->",
        "",
        "Every value below is a default in Project Preferences → Parameters (ADR-0018) and can be changed per project.",
        "**Basis** says where the value comes from: `cited` (a named clause or table), `documented` (derived from",
        "documented values, derivation in the rationale) or `educated-guess` (no source found; reasoning written down,",
        "deliberately wide range). **Check** says how far a maintainer has verified it: `read` (clause read),",
        "`secondary` (confirmed through a source quoting it) or `unverified` (clause reference given but not yet read",
        "against the current text; please confirm before relying on it).",
        "",
        "Schema and contribution rules: [README.md](README.md).",
        "",
    ]
    by_group: dict[str, list[dict]] = {}
    for p in sorted(
        params,
        key=lambda p: (
            GROUP_ORDER.index(p["group"])
            if p["group"] in GROUP_ORDER
            else len(GROUP_ORDER)
        ),
    ):
        by_group.setdefault(p["group"], []).append(p)

    lines += ["## Contents", ""]
    for g in by_group:
        lines.append(f"- [{g}](#{g.lower().replace(' ', '-')})")
    lines += ["- [Sources](#sources)", ""]

    lines += [
        "## Mode table (central values)",
        "",
        "Central value per mode, resolved the way the engine resolves it (mode entry, else global fallback).",
        "",
        "| Parameter | " + " | ".join(MODES) + " |",
        "|---|" + "---|" * len(MODES),
    ]
    for p in by_group.get("Modes", []):
        cells = [fmt(resolve(p, m).get("central")) for m in MODES]
        lines.append(f"| {p['label']} ({p['unit']}) | " + " | ".join(cells) + " |")
    lines.append("")

    for g, ps in by_group.items():
        lines += [f"## {g}", ""]
        for p in ps:
            lines += [
                f"### {p['label']}",
                "",
                f"`{p['key']}` · unit: {p['unit']} · used by: {', '.join(p['used_by'])}",
                "",
            ]
            lines += [
                "| Context | Low | Central | High | Basis | Check | Sources | Rationale |",
                "|---|---|---|---|---|---|---|---|",
            ]
            for v in p["values"]:
                srcs = ", ".join(f"[{s}](#src-{s})" for s in v["sources"])
                rat = str(v["rationale"]).replace("|", "\\|")
                lines.append(
                    f"| {fmt_ctx(v['context'])} | {fmt(v.get('low'))} | {fmt(v.get('central'))} | {fmt(v.get('high'))} "
                    f"| {v['basis']} | {v['check']} | {srcs} | {rat} |"
                )
            lines.append("")

    lines += [
        "## Sources",
        "",
        "| Id | Source | Access | Licence of the source | Retrieved | Checked via |",
        "|---|---|---|---|---|---|",
    ]
    for sid, s in sources.items():
        title = str(s["title"]).replace("|", "\\|")
        lines.append(
            f'| <a id="src-{sid}"></a>`{sid}` | [{title}]({s["url"]}) | {s["access"]} | {s["licence"]} | {s["retrieved"]} | {s["checked_via"]} |'
        )
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--render", action="store_true")
    ap.add_argument("--check-rendered", action="store_true")
    args = ap.parse_args()

    sources = load_sources()
    params = load_parameters()
    errors = validate(sources, params)
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    text = render(sources, params)
    if args.render:
        OUT.write_text(text, encoding="utf-8")
    if args.check_rendered and OUT.read_text(encoding="utf-8") != text:
        print(f"{OUT.relative_to(ROOT)} is stale; run with --render", file=sys.stderr)
        return 1
    n_values = sum(len(p["values"]) for p in params)
    print(f"OK: {len(params)} parameters, {n_values} values, {len(sources)} sources")
    return 0


if __name__ == "__main__":
    sys.exit(main())
