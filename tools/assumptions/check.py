#!/usr/bin/env python3
"""Validate the assumption library (ADR-0018) and render it as Markdown.

Usage:
  python3 tools/assumptions/check.py            # validate only
  python3 tools/assumptions/check.py --render   # validate and write assumptions/DEFAULTS.md
  python3 tools/assumptions/check.py --check-rendered  # fail if DEFAULTS.md is stale
"""

from __future__ import annotations

import argparse
import math
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
COLLECTIONS = {"ocl", "trolley", "third-rail", "fourth-rail"}
SUPPLY_FIELDS = {"id", "label", "collection", "current", "typical_modes", "attributes"}
VOLTAGE_ORDER = ["u_min2_v", "u_min1_v", "nominal_v", "u_max1_v", "u_max2_v"]
SWITCH_FIELDS = {
    "id",
    "label",
    "element",
    "standard",
    "geometry",
    "crossing",
    "typical_modes",
    "built_from",
    "attributes",
}
TURNOUT_ATTRS = {
    "crossing_ratio_n",
    "diverging_radius_m",
    "length_a_m",
    "length_b_m",
    "total_length_m",
    "diverging_speed_kmh",
    "through_speed_kmh",
}
# Required attributes per element; "crossing_ratio_n|crossing_angle_deg" means either.
SWITCH_REQUIRED = {
    "turnout": TURNOUT_ATTRS,
    "single_slip": TURNOUT_ATTRS,
    "double_slip": TURNOUT_ATTRS,
    "diamond": {
        "crossing_ratio_n|crossing_angle_deg",
        "length_a_m",
        "length_b_m",
        "total_length_m",
        "through_speed_kmh",
    },
    "crossover": {"track_centre_m", "total_length_m"},
    "scissors_crossover": {"track_centre_m", "total_length_m", "diamond_ratio_n"},
}
SWITCH_GEOMETRIES = {"curved-crossing", "straight-crossing", "transition"}
SWITCH_CROSSINGS = {"rigid", "movable"}
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


def load_supply_systems() -> list[dict]:
    return yaml.safe_load((LIB / "supply-systems.yaml").read_text(encoding="utf-8"))


def load_switches() -> list[dict]:
    return yaml.safe_load((LIB / "switches.yaml").read_text(encoding="utf-8"))


def validate_entry(
    where: str, v: dict, sources: dict[str, dict], used: set[str]
) -> list[str]:
    """Checks shared by parameter values and supply-system attributes."""
    errors = []
    if v.get("basis") not in BASES:
        errors.append(f"{where}: basis must be one of {sorted(BASES)}")
    if v.get("check") not in CHECKS:
        errors.append(f"{where}: check must be one of {sorted(CHECKS)}")
    if not v.get("rationale"):
        errors.append(f"{where}: missing rationale")
    if not v.get("sources"):
        errors.append(f"{where}: no sources")
    for sid in v.get("sources", []):
        used.add(sid)
        if sid not in sources:
            errors.append(f"{where}: unknown source {sid}")
    if "central" not in v:
        errors.append(f"{where}: missing central")
    return errors


def validate_supply(
    sources: dict[str, dict], systems: list[dict], used: set[str]
) -> list[str]:
    errors: list[str] = []
    ids = [s.get("id") for s in systems]
    for dup in sorted({i for i in ids if ids.count(i) > 1}):
        errors.append(f"supply system {dup}: defined twice")
    for sy in systems:
        sid = sy.get("id", "<no id>")
        if extra := set(sy) - SUPPLY_FIELDS:
            errors.append(f"supply system {sid}: unknown fields {sorted(extra)}")
        if sy.get("collection") not in COLLECTIONS:
            errors.append(
                f"supply system {sid}: collection must be one of {sorted(COLLECTIONS)}"
            )
        if sy.get("current") not in ("ac", "dc"):
            errors.append(f"supply system {sid}: current must be ac or dc")
        for m in sy.get("typical_modes", []):
            if m not in MODES:
                errors.append(f"supply system {sid}: unknown mode {m}")
        attrs = sy.get("attributes") or {}
        if "nominal_v" not in attrs:
            errors.append(f"supply system {sid}: missing nominal_v")
        for name, v in attrs.items():
            where = f"supply system {sid}.{name}"
            if extra := set(v) - VALUE_FIELDS - {"options"}:
                errors.append(f"{where}: unknown fields {sorted(extra)}")
            errors += validate_entry(where, v, sources, used)
            if "options" in v and v.get("central") not in v["options"]:
                errors.append(f"{where}: central not in options")
        volts = [attrs[k]["central"] for k in VOLTAGE_ORDER if k in attrs]
        if volts != sorted(volts):
            errors.append(
                f"supply system {sid}: needs Umin2 <= Umin1 <= Un <= Umax1 <= Umax2"
            )
    return errors


def validate_switches(
    sources: dict[str, dict], switches: list[dict], used: set[str]
) -> list[str]:
    """Schema plus geometry consistency of the switches and crossings catalogue."""
    errors: list[str] = []
    ids = [s.get("id") for s in switches]
    for dup in sorted({i for i in ids if ids.count(i) > 1}):
        errors.append(f"switch {dup}: defined twice")
    by_id = {s.get("id"): s for s in switches}
    for sw in switches:
        sid = sw.get("id", "<no id>")
        el = sw.get("element")
        if extra := set(sw) - SWITCH_FIELDS:
            errors.append(f"switch {sid}: unknown fields {sorted(extra)}")
        if el not in SWITCH_REQUIRED:
            errors.append(
                f"switch {sid}: element must be one of {sorted(SWITCH_REQUIRED)}"
            )
            continue
        if not sw.get("label") or not sw.get("standard"):
            errors.append(f"switch {sid}: missing label or standard")
        for m in sw.get("typical_modes", []):
            if m not in MODES:
                errors.append(f"switch {sid}: unknown mode {m}")
        if el == "turnout" and sw.get("geometry") not in SWITCH_GEOMETRIES:
            errors.append(
                f"switch {sid}: geometry must be one of {sorted(SWITCH_GEOMETRIES)}"
            )
        if el in ("crossover", "scissors_crossover"):
            base = by_id.get(sw.get("built_from"))
            if not base or base.get("element") != "turnout":
                errors.append(f"switch {sid}: built_from must be a turnout id")
        elif sw.get("crossing") not in SWITCH_CROSSINGS:
            errors.append(
                f"switch {sid}: crossing must be one of {sorted(SWITCH_CROSSINGS)}"
            )
        attrs = sw.get("attributes") or {}
        for req in SWITCH_REQUIRED[el]:
            if not any(r in attrs for r in req.split("|")):
                errors.append(f"switch {sid}: missing attribute {req}")
        for name, v in attrs.items():
            where = f"switch {sid}.{name}"
            if extra := set(v) - VALUE_FIELDS:
                errors.append(f"{where}: unknown fields {sorted(extra)}")
            errors += validate_entry(where, v, sources, used)
            nums = [
                v.get(k) for k in ("low", "central", "high") if v.get(k) is not None
            ]
            if any(not isinstance(n, (int, float)) for n in nums):
                errors.append(f"{where}: low/central/high must be numbers")
            elif nums != sorted(nums):
                errors.append(f"{where}: needs low <= central <= high")
        errors += check_switch_geometry(sid, sw, attrs, by_id)
    return errors


def central(attrs: dict, name: str):
    return (attrs.get(name) or {}).get("central")


def check_switch_geometry(sid: str, sw: dict, attrs: dict, by_id: dict) -> list[str]:
    """Central values must describe a buildable element."""
    errors = []
    a, b, total = (
        central(attrs, k) for k in ("length_a_m", "length_b_m", "total_length_m")
    )
    if None not in (a, b, total) and abs(a + b - total) > 0.01:
        errors.append(f"switch {sid}: length_a_m + length_b_m != total_length_m")
    div, thr = (
        central(attrs, "diverging_speed_kmh"),
        central(attrs, "through_speed_kmh"),
    )
    if div is not None and thr is not None and div > thr:
        errors.append(f"switch {sid}: diverging speed above through speed")
    n, r = central(attrs, "crossing_ratio_n"), central(attrs, "diverging_radius_m")
    if sw["element"] == "turnout" and n and r and a:
        tangent = r * math.tan(math.atan(1 / n) / 2)
        if (
            sw.get("geometry") == "curved-crossing"
            and abs(a - tangent) > 0.005 * tangent
        ):
            errors.append(
                f"switch {sid}: curved crossing needs a = R·tan(α/2) = {tangent:.3f}"
            )
    if sw["element"] in ("crossover", "scissors_crossover"):
        base = by_id.get(sw.get("built_from")) or {}
        battrs = base.get("attributes") or {}
        ba, bn, d = (
            central(battrs, "length_a_m"),
            central(battrs, "crossing_ratio_n"),
            central(attrs, "track_centre_m"),
        )
        if None not in (ba, bn, d, total) and abs(2 * ba + d * bn - total) > 0.05:
            errors.append(
                f"switch {sid}: total_length_m must be 2·a + d·n = {2 * ba + d * bn:.3f}"
            )
        bb = central(battrs, "length_b_m")
        if (
            None not in (bb, bn, d)
            and d * math.hypot(bn, 1) < (1 if sw["element"] == "crossover" else 2) * bb
        ):
            errors.append(
                f"switch {sid}: track centres too close for the turnout legs to meet"
            )
    return errors


def validate(
    sources: dict[str, dict], params: list[dict], used_sources: set[str]
) -> list[str]:
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
            errors += validate_entry(where, v, sources, used_sources)
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


def render_supply(systems: list[dict]) -> list[str]:
    cols = [
        ("nominal_v", "Un (V)"),
        ("frequency_hz", "f (Hz)"),
        ("u_min2_v", "Umin2"),
        ("u_min1_v", "Umin1"),
        ("u_max1_v", "Umax1"),
        ("u_max2_v", "Umax2"),
        ("contact_wire_height_m", "Wire height (m)"),
        ("pantograph_head_mm", "Pantograph head (mm)"),
        ("trolley_wire_spacing_mm", "Wire spacing (mm)"),
        ("conductor_rail_contact", "Rail contact"),
        ("standstill_current_a", "Standstill current (A)"),
        ("min_power_factor", "Min. power factor"),
    ]
    lines = [
        "## Energy supply systems",
        "",
        "Vehicles list the supply systems they support (`supplySystems`); a section can only be run by a vehicle",
        "whose list contains the section's system, whose pantograph head or collector shoe fits the listed options,",
        "and whose voltage range covers Umin1–Umax1. Central values; where options exist the central value is the",
        "default and the others are accepted. Full basis, sources and rationale per attribute:",
        "[`supply-systems.yaml`](supply-systems.yaml).",
        "",
        "| Id | System | Modes | " + " | ".join(c for _, c in cols) + " |",
        "|---|---|---|" + "---|" * len(cols),
    ]
    for sy in systems:
        attrs = sy["attributes"]
        cells = []
        for key, _ in cols:
            v = attrs.get(key)
            if v is None:
                cells.append("–")
            elif "options" in v:
                cells.append(" / ".join(str(o) for o in v["options"]))
            elif v.get("low") is not None:
                cells.append(f"{v['central']} ({v['low']}–{v['high']})")
            else:
                cells.append(str(v["central"]))
        lines.append(
            f"| `{sy['id']}` | {sy['label']} | {', '.join(sy['typical_modes'])} | "
            + " | ".join(cells)
            + " |"
        )
    lines.append("")
    return lines


def render_switches(switches: list[dict]) -> list[str]:
    def cell(attrs: dict, key: str) -> str:
        v = attrs.get(key)
        if v is None:
            return "–"
        if v.get("low") is not None:
            return f"{v['central']} ({v['low']}–{v['high']})"
        return str(v["central"])

    cols = [
        ("crossing_ratio_n", "1:n"),
        ("diverging_radius_m", "R (m)"),
        ("length_a_m", "a (m)"),
        ("length_b_m", "b (m)"),
        ("total_length_m", "Length (m)"),
        ("track_centre_m", "Track centres (m)"),
        ("diverging_speed_kmh", "V diverging (km/h)"),
        ("through_speed_kmh", "V through (km/h)"),
    ]
    lines = [
        "## Switches and crossings",
        "",
        "The railway design tool connects tracks only with these elements (ADR-0030 point 5). Central values,",
        "with low–high in brackets where the value is uncertain. a runs from the start of the switch to the",
        "intersection point of the track centre lines, b from there to the end of each leg. Full basis, sources",
        "and rationale per attribute: [`switches.yaml`](switches.yaml); geometry model:",
        "[README](README.md#switches-and-crossings).",
        "",
        "| Id | Element | Standard | Built from | Crossing | Modes | "
        + " | ".join(c for _, c in cols)
        + " |",
        "|---|---|---|---|---|---|" + "---|" * len(cols),
    ]
    for sw in switches:
        attrs = dict(sw["attributes"])
        if "crossing_angle_deg" in attrs and "crossing_ratio_n" not in attrs:
            attrs["crossing_ratio_n"] = {
                "central": f"{attrs['crossing_angle_deg']['central']}°"
            }
        if "diamond_ratio_n" in attrs:
            attrs["crossing_ratio_n"] = attrs["diamond_ratio_n"]
        built = f"`{sw['built_from']}`" if sw.get("built_from") else "–"
        crossing = (
            " ".join(x for x in (sw.get("geometry"), sw.get("crossing")) if x) or "–"
        )
        lines.append(
            f"| `{sw['id']}` | {sw['element']} | {sw['standard']} | {built} | {crossing} | "
            f"{', '.join(sw['typical_modes'])} | "
            + " | ".join(cell(attrs, k) for k, _ in cols)
            + " |"
        )
    lines.append("")
    return lines


def render(
    sources: dict[str, dict],
    params: list[dict],
    systems: list[dict],
    switches: list[dict],
) -> str:
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
    lines += [
        "- [Energy supply systems](#energy-supply-systems)",
        "- [Switches and crossings](#switches-and-crossings)",
        "- [Sources](#sources)",
        "",
    ]

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

    lines += render_supply(systems)
    lines += render_switches(switches)
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
    systems = load_supply_systems()
    switches = load_switches()
    used: set[str] = set()
    errors = (
        validate(sources, params, used)
        + validate_supply(sources, systems, used)
        + validate_switches(sources, switches, used)
    )
    turnout_ids = {s["id"] for s in switches if s.get("element") == "turnout"}
    supply_ids = {"none"} | {s["id"] for s in systems}
    for p in params:
        if (
            p["key"] == "mode.new_track_electrification"
            and set(p.get("options", [])) != supply_ids
        ):
            errors.append(
                "mode.new_track_electrification: options must be 'none' plus the supply-system ids"
            )
        if (
            p["key"] == "switch.default_turnout"
            and not set(p.get("options", [])) <= turnout_ids
        ):
            errors.append(
                "switch.default_turnout: options must be turnout ids from switches.yaml"
            )
    for sid in sorted(set(sources) - used):
        errors.append(f"source {sid}: defined but never used")
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    text = render(sources, params, systems, switches)
    if args.render:
        OUT.write_text(text, encoding="utf-8")
    if args.check_rendered and OUT.read_text(encoding="utf-8") != text:
        print(f"{OUT.relative_to(ROOT)} is stale; run with --render", file=sys.stderr)
        return 1
    n_values = sum(len(p["values"]) for p in params)
    print(
        f"OK: {len(params)} parameters, {n_values} values, {len(systems)} supply systems, "
        f"{len(switches)} switches and crossings, {len(sources)} sources"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
