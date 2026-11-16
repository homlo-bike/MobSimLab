"""The street network of a demand run from OpenStreetMap street tiles (the API stores them with the run).

The tiles are the street line tool's (OSM XML from Overpass, road classes only). Ways are split into links at
junctions, so every link joins two junctions or ends. Each link gets:

- its road class (motorway, trunk, primary, secondary, tertiary, or local for every other street);
- the legal speed from ``maxspeed`` where OSM gives it, else ``demand.road.speed_kmh.<class>``;
- lanes per direction from ``lanes``, ``lanes:forward`` and ``lanes:backward`` (0 where OSM does not say, so
  the model uses ``demand.road.lanes.<class>``);
- whether cars may drive each way (``oneway``, ``access``, pedestrian streets and busways closed), and
  whether people may walk and cycle along it (not on motorways, ``motorroad`` or where ``foot`` or
  ``bicycle`` is ``no``).

Only the largest connected piece of the network is kept, so no zone joins an island it cannot leave.
"""

from __future__ import annotations

import math
import re
from collections.abc import Iterable
from typing import Any

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

from mobsim_worker.demand.inputs import ROAD_CLASSES, InputError, Values
from mobsim_worker.jobs.road.osm import merge_tiles

#: Road class of each OSM highway value; any other street is ``local``.
CLASS_OF = {
    "motorway": "motorway",
    "motorway_link": "motorway",
    "trunk": "trunk",
    "trunk_link": "trunk",
    "primary": "primary",
    "primary_link": "primary",
    "secondary": "secondary",
    "secondary_link": "secondary",
    "tertiary": "tertiary",
    "tertiary_link": "tertiary",
}
#: Streets no car may use.
NO_CARS = frozenset({"pedestrian", "busway", "bus_guideway"})
#: Streets nobody walks or cycles along.
NO_PEOPLE = frozenset({"motorway", "motorway_link", "busway", "bus_guideway"})
CLOSED = frozenset({"no", "private"})

_MPH = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*mph\s*$")
_KMH = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*(?:km/h|kmh)?\s*$")


def maxspeed_kmh(v: str | None) -> float | None:
    """The legal speed a ``maxspeed`` tag gives, km/h; None for zone codes (``DE:urban``) or nonsense."""
    if not v:
        return None
    first = v.split(";")[0]
    m = _MPH.match(first)
    if m:
        return float(m.group(1)) * 1.609344
    m = _KMH.match(first)
    if m:
        s = float(m.group(1))
        return s if 0 < s <= 150 else None
    return None


def _lanes(v: str | None) -> float:
    try:
        n = float(str(v).split(";")[0])
    except ValueError:
        return 0.0
    return n if 0 < n <= 12 else 0.0


def _metres(a: tuple[float, float], b: tuple[float, float]) -> float:
    kx = 111_320.0 * math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 110_574.0)


def _access(t: dict[str, str]) -> tuple[bool, bool, bool]:
    """Cars, walking and cycling allowed on a way at all."""
    hw = t.get("highway", "")
    car = hw not in NO_CARS and not any(t.get(k) in CLOSED for k in ("access", "motor_vehicle", "motorcar"))
    if t.get("access") in CLOSED and t.get("motorcar") in ("yes", "designated", "destination"):
        car = True
    people = hw not in NO_PEOPLE and t.get("motorroad") != "yes"
    walk = people and t.get("foot") not in CLOSED and not (t.get("access") in CLOSED and "foot" not in t)
    cycle = (
        people and t.get("bicycle") not in CLOSED and not (t.get("access") in CLOSED and "bicycle" not in t)
    )
    if hw == "pedestrian":
        cycle = t.get("bicycle") in ("yes", "designated", "permissive")
    return car, walk, cycle


def streets_from_tiles(tiles: Iterable[str], values: Values) -> dict[str, Any]:
    """The ``streets`` part of the bundle (contracts/demand-input.schema.json) from OSM street tiles.

    Raises:
        InputError: The tiles hold no usable street.
    """
    try:
        data = merge_tiles(tiles)
    except ValueError as e:
        raise InputError(str(e)) from e
    default_speed = {c: values[f"demand.road.speed_kmh.{c}"] for c in ROAD_CLASSES}
    usable = []
    uses: dict[int, int] = {}
    for w in data.ways.values():
        car, walk, cycle = _access(w.tags)
        if not (car or walk or cycle):
            continue
        usable.append((w, car, walk, cycle))
        for i, n in enumerate(w.nodes):
            # Ends count twice, so they always split.
            uses[n] = uses.get(n, 0) + (2 if i in (0, len(w.nodes) - 1) else 1)
    index: dict[int, int] = {}
    nodes: list[list[float]] = []

    def node(n: int) -> int:
        i = index.get(n)
        if i is None:
            i = index[n] = len(nodes)
            lon, lat, _ = data.nodes[n]
            nodes.append([round(lon, 7), round(lat, 7)])
        return i

    links: list[list[float]] = []
    for w, car, walk, cycle in usable:
        t = w.tags
        cls = CLASS_OF.get(t.get("highway", ""), "local")
        speed = maxspeed_kmh(t.get("maxspeed")) or default_speed[cls]
        one = t.get("oneway") in ("yes", "1", "true") or t.get("junction") == "roundabout"
        rev = t.get("oneway") == "-1"
        total = _lanes(t.get("lanes"))
        fwd = _lanes(t.get("lanes:forward"))
        bwd = _lanes(t.get("lanes:backward"))
        if one or rev:
            fwd = fwd or total
            bwd = 0.0
        elif total and not (fwd and bwd):
            fwd = fwd or max(1.0, (total - bwd) if bwd else math.floor(total / 2))
            bwd = bwd or max(1.0, total - fwd)
        car_f = car and not rev
        car_b = car and not one
        if rev:
            fwd, bwd = 0.0, fwd
        start = 0
        length = 0.0
        for k in range(1, len(w.nodes)):
            a, b = data.nodes[w.nodes[k - 1]], data.nodes[w.nodes[k]]
            length += _metres((a[0], a[1]), (b[0], b[1]))
            if k == len(w.nodes) - 1 or uses.get(w.nodes[k], 0) > 1:
                if w.nodes[start] != w.nodes[k] and length > 0:
                    links.append(
                        [
                            node(w.nodes[start]),
                            node(w.nodes[k]),
                            round(max(length, 1.0), 1),
                            ROAD_CLASSES.index(cls),
                            round(speed, 1),
                            fwd,
                            bwd,
                            int(car_f),
                            int(car_b),
                            int(walk),
                            int(cycle),
                        ]
                    )
                start = k
                length = 0.0
    if not links:
        raise InputError("the model area has no streets in OpenStreetMap")
    return _largest_piece(nodes, links)


def _largest_piece(nodes: list[list[float]], links: list[list[float]]) -> dict[str, Any]:
    """Keep only the links of the largest connected piece, with their nodes renumbered."""
    a = np.array([lk[0] for lk in links], dtype=np.int64)
    b = np.array([lk[1] for lk in links], dtype=np.int64)
    n = len(nodes)
    g = coo_matrix((np.ones(len(a)), (a, b)), shape=(n, n))
    _, label = connected_components(g, directed=False)
    main = np.bincount(label).argmax()
    keep_node = label == main
    new_id = np.cumsum(keep_node) - 1
    out_links = []
    for lk, x, y in zip(links, a, b, strict=True):
        if keep_node[x]:
            out_links.append([int(new_id[x]), int(new_id[y]), *lk[2:]])
    out_nodes = [p for p, k in zip(nodes, keep_node, strict=True) if k]
    return {"nodes": out_nodes, "links": out_links}
