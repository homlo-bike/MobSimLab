"""A small synthetic town for the road simulation tests: a 5 × 5 street grid, 200 m apart, near Zurich.

The middle east–west street (row 2) is a primary road with a trolleybus wire and traffic signals at its middle
crossing; the others are residential. Split into two "tiles" that overlap (whole ways in both), as the API's
Overpass tiles do.
"""

from __future__ import annotations

from typing import Any

LON0, LAT0 = 8.5400, 47.3700
STEP_M = 200.0
N = 5
DLAT = STEP_M / 111_320.0
DLON = STEP_M / (111_320.0 * 0.6773)  # cos(47.37°)


def lonlat(i: int, j: int) -> tuple[float, float]:
    """Grid point: column ``i`` (east), row ``j`` (north)."""
    return (LON0 + i * DLON, LAT0 + j * DLAT)


def node_id(i: int, j: int) -> int:
    return 1000 + j * 10 + i


def tiles() -> list[str]:
    """Two OSM XML tiles: west half and east half; ways crossing the middle are in both."""
    ways: list[tuple[int, list[int], dict[str, str]]] = []
    wid = 100
    for j in range(N):
        tags = {"highway": "residential", "name": f"Row {j}"}
        if j == 2:
            tags = {"highway": "primary", "name": "Main Street", "trolley_wire": "yes", "maxspeed": "50"}
        for i in range(N - 1):
            wid += 1
            ways.append((wid, [node_id(i, j), node_id(i + 1, j)], dict(tags)))
    for i in range(N):
        for j in range(N - 1):
            wid += 1
            ways.append(
                (wid, [node_id(i, j), node_id(i, j + 1)], {"highway": "residential", "name": f"Col {i}"})
            )
    out = []
    for half in (range(0, 3), range(2, 5)):
        parts = ['<?xml version="1.0" encoding="UTF-8"?>', '<osm version="0.6">']
        used = {n for _, ns, _ in ways for n in ns if any(node_id(i, j) == n for i in half for j in range(N))}
        tile_ways = [w for w in ways if any(n in used for n in w[1])]
        nodes = sorted({n for _, ns, _ in tile_ways for n in ns})
        for n in nodes:
            j, i = divmod(n - 1000, 10)
            lon, lat = lonlat(i, j)
            tag = '<tag k="highway" v="traffic_signals"/>' if (i, j) == (2, 2) else ""
            parts.append(f'<node id="{n}" lat="{lat:.7f}" lon="{lon:.7f}">{tag}</node>')
        for w, ns, tags in tile_ways:
            nds = "".join(f'<nd ref="{n}"/>' for n in ns)
            tg = "".join(f'<tag k="{k}" v="{v}"/>' for k, v in tags.items())
            parts.append(f'<way id="{w}">{nds}{tg}</way>')
        parts.append("</osm>")
        out.append("\n".join(parts))
    return out


def depot_network() -> dict[str, Any]:
    """A tiny depot south of the grid's south-west corner: gate, one lane of two slots, back to the gate."""
    g = (LON0 + 0.5 * DLON, LAT0 - 0.25 * DLAT)
    fence = (LON0 + 0.5 * DLON, LAT0 - 0.02 * DLAT)
    a = (LON0 + 0.2 * DLON, LAT0 - 0.4 * DLAT)
    b = (LON0 + 0.8 * DLON, LAT0 - 0.4 * DLAT)
    return {
        "nodes": [
            {"id": "fence:g1", "lonlat": list(fence)},
            {"id": "gate:g1", "lonlat": list(g)},
            {"id": "yard:a", "lonlat": list(a)},
            {"id": "yard:b", "lonlat": list(b)},
        ],
        "edges": [
            {
                "id": "e0",
                "kind": "gate",
                "from": "fence:g1",
                "to": "gate:g1",
                "one_way": False,
                "coords": [list(fence), list(g)],
                "length_m": 46,
            },
            {
                "id": "e1",
                "kind": "drive",
                "from": "gate:g1",
                "to": "yard:a",
                "one_way": True,
                "coords": [list(g), list(a)],
                "length_m": 70,
            },
            {
                "id": "e2",
                "kind": "lane",
                "from": "yard:a",
                "to": "yard:b",
                "one_way": True,
                "coords": [list(a), list(b)],
                "length_m": 120,
                "of": "L1",
            },
            {
                "id": "e3",
                "kind": "drive",
                "from": "yard:b",
                "to": "gate:g1",
                "one_way": True,
                "coords": [list(b), list(g)],
                "length_m": 70,
            },
        ],
    }


def line(index: int = 0, energy: str = "trolleybus", headway_s: float = 300.0) -> dict[str, Any]:
    """A line along Main Street: end stops near the west and east ends, a stop in the middle."""
    p0, p1, p2 = lonlat(0, 2), lonlat(2, 2), lonlat(4, 2)
    a = (p0[0] + 0.5 * DLON, p0[1])
    b = (p1[0] + 0.5 * DLON, p1[1])
    c = (p2[0] - 0.5 * DLON, p2[1])
    # Eastbound on Main Street, back westbound (same street, other direction).
    legs = [
        {"coords": [list(a), list(lonlat(1, 2)), list(lonlat(2, 2)), list(b)], "time_s": 60.0},
        {"coords": [list(b), list(lonlat(3, 2)), list(c)], "time_s": 45.0},
        {
            "coords": [list(c), list(lonlat(3, 2)), list(lonlat(2, 2)), list(lonlat(1, 2)), list(a)],
            "time_s": 100.0,
        },
    ]
    points = [
        {"name": "West End", "kind": "end_stop", "lonlat": list(a)},
        {"name": "Middle", "kind": "stop", "lonlat": list(b)},
        {"name": "East End", "kind": "end_stop", "lonlat": list(c)},
    ]
    fence = (LON0 + 0.5 * DLON, LAT0 - 0.02 * DLAT)
    start = 7 * 3600.0
    return {
        "index": index,
        "name": "Line 1",
        "mode": "trolleybus" if energy == "trolleybus" else "bus",
        "color": "#1e8a4f",
        "vehicle": {
            "length_m": 12.0,
            "width_m": 2.55,
            "max_speed_kmh": 70.0,
            "weight_t": 18.0,
            "energy": energy,
            "battery_kwh": 60.0,
            "hvac_kw": 15.0,
        },
        "dwell_s": 20.0,
        "layover_s": 120.0,
        "points": points,
        "legs": legs,
        "departures": [start + k * headway_s for k in range(6)],
        "pull_out": {
            "coords": [list(fence), list(lonlat(0, 0)), list(lonlat(0, 1)), list(lonlat(0, 2)), list(a)],
            "time_s": 120.0,
            "at": 0,
        },
        "pull_in": {
            "coords": [list(a), list(lonlat(0, 2)), list(lonlat(0, 1)), list(lonlat(0, 0)), list(fence)],
            "time_s": 120.0,
            "at": 0,
        },
        "depot": "d1",
    }


def depot() -> dict[str, Any]:
    """The depot with its network, one lane of six slots and an assignment for each of line 0's vehicles."""
    net = depot_network()
    a = net["nodes"][2]["lonlat"]
    b = net["nodes"][3]["lonlat"]
    slots = []
    for k in range(6):
        f = 0.9 - k * 0.15
        slots.append(
            {
                "id": f"s{k}",
                "center": [a[0] + (b[0] - a[0]) * f, a[1]],
                "heading_deg": 90.0,
                "length_m": 13.0,
                "width_m": 3.2,
                "charger": k < 2,
            }
        )
    return {
        "id": "d1",
        "name": "Depot",
        "network": net,
        "lanes": [{"id": "L1", "slots": slots}],
        "assignments": [
            {"line": "street:0", "vehicle": k, "lane": "L1", "slot": f"s{k}", "charger": k < 2}
            for k in range(6)
        ],
    }
