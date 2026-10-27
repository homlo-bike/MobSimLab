"""Shared rules for the vehicle catalogue: mode folders and the ADR-0026 core-field gate."""

from __future__ import annotations

from typing import Any

# Mode id (as used by the assumption library) -> catalogue folder (08-vehicles.md §1).
MODE_FOLDERS = {
    "bus": "bus",
    "brt": "brt",
    "trolleybus": "trolleybus",
    "intercity_bus": "intercity-bus",
    "tram": "tram",
    "light_rail": "light-rail",
    "metro": "metro",
    "commuter_rail": "commuter-rail",
    "regional_rail": "regional-rail",
    "long_distance_rail": "long-distance-rail",
    "high_speed_rail": "high-speed-rail",
}

# ADR-0026 / 08 §3 rule 1: these must be sourced (not assumed) before a file enters the catalogue.
# Capacity is seats plus standing places at a stated density; standing area is then derived.
CORE_FIELDS = ("length", "width", "seats", "standingQuoted", "topSpeed", "energySource")


def core_gaps(rec: dict[str, Any]) -> list[str]:
    """Return the core fields of ``rec`` that are missing, assumed, or unknown.

    Input: a catalogue record. Output: field names in ``CORE_FIELDS`` order; empty means the
    record may enter the catalogue. No side effects.
    """
    gaps = []
    for field in CORE_FIELDS:
        q = rec.get(field)
        if not isinstance(q, dict) or q.get("assumed", True) or not q.get("sources"):
            gaps.append(field)
        elif field == "energySource" and q.get("value") == "unknown":
            gaps.append(field)
    return gaps
