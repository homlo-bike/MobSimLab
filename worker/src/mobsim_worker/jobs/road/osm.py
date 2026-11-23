"""OpenStreetMap input of the road network: tiles merged, the planner's street setup applied, depots added.

The API stores the street tiles (OSM XML from Overpass, as the street line tool loads them) with the run.
Here they become one OSM file for ``netconvert``:

- Tiles overlap (ways are returned whole), so nodes, ways and relations are merged by id.
- The planner's street setup from the GIS tab (``StreetSetup``) changes the way's lane tags: general traffic
  lanes and a bus lane on the kerb side of each direction. Fields the planner left unset keep what OSM says.
- The planner's junction setup (``JunctionSetup``) gives a junction traffic lights or takes them away.
- Each depot's driving network (gates, aisles, lanes, drives; ``crates/depot-layout``) is added as service
  ways for buses only, and every fence gate is joined to the nearest street a bus may use, at a new node
  inserted into that street.

Ids of added nodes and ways start at ``ADDED_ID_BASE``, far above any OSM id, so they never clash.
"""

from __future__ import annotations

import math
import xml.etree.ElementTree as ET  # noqa: S405 (OSM XML from our own API's Overpass cache; no entities)
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any

#: First id of the nodes and ways added here.
ADDED_ID_BASE = 9_000_000_000_000_000

#: Highway classes a bus may drive on (crates/street-routing `way_info`, ROAD_CLASSES of the street tiles).
BUS_CLASSES = frozenset(
    "motorway motorway_link trunk trunk_link primary primary_link secondary secondary_link tertiary "
    "tertiary_link unclassified residential living_street service road busway bus_guideway".split()
)

#: Furthest a fence gate may be from a street it is joined to, m.
MAX_GATE_LINK_M = 250.0

LonLat = tuple[float, float]


@dataclass
class Way:
    """One OSM way: its node ids and tags."""

    id: int
    nodes: list[int]
    tags: dict[str, str]


@dataclass
class OsmData:
    """Merged OSM data: nodes (lon, lat, tags), ways and the relations as XML elements (turn restrictions)."""

    nodes: dict[int, tuple[float, float, dict[str, str]]] = field(default_factory=dict)
    ways: dict[int, Way] = field(default_factory=dict)
    relations: dict[int, ET.Element] = field(default_factory=dict)
    next_id: int = ADDED_ID_BASE

    def new_id(self) -> int:
        """Return a fresh id for an added node or way."""
        self.next_id += 1
        return self.next_id

    def add_node(self, lonlat: LonLat, tags: dict[str, str] | None = None) -> int:
        """Add a node and return its id."""
        nid = self.new_id()
        self.nodes[nid] = (lonlat[0], lonlat[1], tags or {})
        return nid


def merge_tiles(tiles: Iterable[str]) -> OsmData:
    """Merge OSM XML tiles into one data set (first copy of an element wins; tiles carry whole ways).

    Args:
        tiles: OSM XML documents.

    Returns:
        The merged data.

    Raises:
        ValueError: A tile is not OSM XML.
    """
    data = OsmData()
    for text in tiles:
        try:
            root = ET.fromstring(text)  # noqa: S314 (see the import)
        except ET.ParseError as e:
            raise ValueError(f"a street tile is not OSM XML: {e}") from e
        for el in root:
            tags = {t.get("k", ""): t.get("v", "") for t in el.findall("tag")}
            if el.tag == "node":
                nid = int(el.get("id", "0"))
                if nid not in data.nodes:
                    data.nodes[nid] = (float(el.get("lon", "0")), float(el.get("lat", "0")), tags)
            elif el.tag == "way":
                wid = int(el.get("id", "0"))
                if wid not in data.ways:
                    data.ways[wid] = Way(wid, [int(n.get("ref", "0")) for n in el.findall("nd")], tags)
            elif el.tag == "relation":
                rid = int(el.get("id", "0"))
                data.relations.setdefault(rid, el)
    # Ways whose nodes a tile left out cannot be built; drop the missing nodes.
    for w in data.ways.values():
        w.nodes = [n for n in w.nodes if n in data.nodes]
    data.ways = {k: w for k, w in data.ways.items() if len(w.nodes) >= 2}
    return data


def _int_tag(v: str | None) -> int | None:
    try:
        n = int(str(v).split(";")[0])
    except ValueError:
        return None
    return n if n > 0 else None


def _oneway(t: dict[str, str]) -> bool:
    if t.get("oneway") in ("no", "false", "0"):
        return False
    return t.get("oneway") in ("yes", "1", "true", "-1") or t.get("junction") == "roundabout"


def _bus_lane_count(t: dict[str, str]) -> int:
    """Bus lanes OSM already tags on a way (``bus:lanes``/``psv:lanes`` designated, or ``busway*=lane``)."""
    n = 0
    for k, v in t.items():
        if k.startswith(("bus:lanes", "psv:lanes")):
            n += v.split("|").count("designated")
    if n == 0:
        if "lane" in (t.get("busway:both"), t.get("busway")):
            n = 1 if _oneway(t) else 2
        else:
            n = sum(1 for k in ("busway:left", "busway:right") if t.get(k) == "lane")
    return n


def _moves(s: dict[str, Any]) -> bool:
    return s.get("kind") == "lane" and any(u != "walk" for u in s.get("users") or [])


def _goes(s: dict[str, Any], forward: bool) -> bool:
    d = s.get("dir") or "both"
    return _moves(s) and (d == "both" or d == ("forward" if forward else "backward"))


def _apply_sections(t: dict[str, str], sections: Sequence[dict[str, Any]]) -> None:
    """Write a custom street layout (``StreetSetup.sections``) as OSM lane tags, as ``street-routing`` does.

    Lanes cars may use are general lanes; lanes of buses (or taxis) without cars are bus lanes. A street
    without car lanes is closed to motor traffic (buses still allowed on their lanes).
    """

    def has(s: dict[str, Any], u: str) -> bool:
        return s.get("kind") == "lane" and u in (s.get("users") or [])

    def road_lane(s: dict[str, Any]) -> bool:
        return has(s, "car") or has(s, "bus") or has(s, "taxi")

    fwd = [s for s in sections if _goes(s, True) and road_lane(s)]
    # OSM lists the backward lanes left to right looking backward: the way's order reversed.
    bwd = [s for s in reversed(sections) if _goes(s, False) and road_lane(s)]
    cars = (any(has(s, "car") for s in fwd), any(has(s, "car") for s in bwd))
    bus = (any(has(s, "bus") for s in fwd), any(has(s, "bus") for s in bwd))
    f, b = cars if any(cars) else bus
    for k in [
        k
        for k in t
        if k.startswith(
            ("oneway", "lanes", "turn:lanes", "busway", "bus:lanes", "psv:lanes", "access:lanes", "cycleway")
        )
        or k in ("width", "width:carriageway")
    ]:
        del t[k]
    t["oneway"] = "yes" if f and not b else "-1" if b and not f else "no"
    if any(cars) and ((bus[0] and not f) or (bus[1] and not b)):
        t["oneway:bus"] = "no"
    if not any(cars):
        t["motor_vehicle"] = "no"
    if any(bus):
        if not any(cars):
            t["bus"] = "yes"
    else:
        t["bus"] = t["psv"] = "no"

    def access(lanes: list[dict[str, Any]]) -> str:
        return "|".join("yes" if has(s, "car") else "designated" for s in lanes)

    if fwd or bwd:
        t["lanes"] = str(len(fwd) + len(bwd))
    if t["oneway"] == "no":
        t["lanes:forward"] = str(len(fwd))
        t["lanes:backward"] = str(len(bwd))
        if any(not has(s, "car") for s in fwd):
            t["bus:lanes:forward"] = access(fwd)
        if any(not has(s, "car") for s in bwd):
            t["bus:lanes:backward"] = access(bwd)
    else:
        one = fwd if t["oneway"] == "yes" else bwd
        if any(not has(s, "car") for s in one):
            t["bus:lanes"] = access(one)


def apply_street_setup(data: OsmData, setups: Sequence[dict[str, Any]], left_hand: bool = False) -> int:
    """Change way tags as the planner set the streets up in the GIS tab (``StreetSetup``).

    ``oneway`` makes the street one-way (``True``: the direction OSM gives a one-way street, else the
    way's own direction) or two-way (``False``) for all traffic. ``traffic_lanes`` counts general traffic
    lanes over both directions, without bus lanes; ``bus_lane`` is a
    bus lane on the kerb side of each direction. Both are written as OSM lane tags (``lanes``,
    ``lanes:forward``/``backward``, ``bus:lanes:*``) that netconvert reads with ``--osm.lane-access``.
    Unset fields keep what OpenStreetMap says. A custom layout (``sections``: the street section by
    section, left to right along the way) replaces all of them (see ``_apply_sections``).

    Args:
        data: The merged OSM data, changed in place.
        setups: Street setups: ``way`` and the optional ``oneway``, ``traffic_lanes``, ``bus_lane``.
        left_hand: Traffic drives on the left (the kerb lane is the leftmost in OSM's lane order).

    Returns:
        How many ways were changed.
    """
    changed = 0
    for s in setups:
        w = data.ways.get(int(s.get("way", 0)))
        if w is None:
            continue
        lanes = s.get("traffic_lanes")
        bus = s.get("bus_lane")
        direction = s.get("oneway")
        t = w.tags
        sections = s.get("sections")
        if isinstance(sections, list):
            _apply_sections(t, sections)
            changed += 1
            continue
        if isinstance(direction, bool):
            if direction and not _oneway(t):
                t["oneway"] = "yes"
            elif not direction:
                for k in [k for k in t if k.startswith("oneway")]:
                    del t[k]
                t["oneway"] = "no"
        if not (isinstance(lanes, int | float) and lanes >= 1) and not isinstance(bus, bool):
            changed += isinstance(direction, bool)
            continue
        one = _oneway(t)
        had_bus = _bus_lane_count(t)
        if isinstance(lanes, int | float) and lanes >= 1:
            traffic = int(lanes)
        else:
            total = _int_tag(t.get("lanes"))
            traffic = max(1 if one else 2, (total or (1 if one else 2)) - had_bus)
        with_bus = bus if isinstance(bus, bool) else had_bus > 0
        for k in [
            k
            for k in t
            if k.startswith(("lanes", "turn:lanes", "busway", "bus:lanes", "psv:lanes", "access:lanes"))
        ]:
            del t[k]

        def access(n: int, bus: bool = with_bus) -> str:
            lane = ["yes"] * n + (["designated"] if bus else [])
            return "|".join(reversed(lane) if left_hand else lane)

        if one:
            t["lanes"] = str(traffic + (1 if with_bus else 0))
            if with_bus:
                t["bus:lanes"] = access(traffic)
        else:
            fwd = max(1, (traffic + 1) // 2)
            bwd = max(1, traffic - fwd)
            extra = 1 if with_bus else 0
            t["lanes"] = str(fwd + bwd + 2 * extra)
            t["lanes:forward"] = str(fwd + extra)
            t["lanes:backward"] = str(bwd + extra)
            if with_bus:
                t["bus:lanes:forward"] = access(fwd)
                t["bus:lanes:backward"] = access(bwd)
        changed += 1
    return changed


#: Signal nodes mapped on a junction's approaches (``highway=traffic_signals`` before the stop line)
#: that netconvert turns into the junction's lights (``--tls.guess-signals``), m from the junction.
APPROACH_SIGNAL_M = 30.0


def _signal_tagged(tags: dict[str, str]) -> bool:
    return tags.get("highway") == "traffic_signals" or tags.get("crossing") == "traffic_signals"


def apply_junction_setup(data: OsmData, setups: Sequence[dict[str, Any]]) -> tuple[int, int]:
    """Give junctions traffic lights or take them away, as the planner set them up in the GIS tab.

    A junction is its OSM nodes (``nodes``; osm2streets may merge several into one). ``signals: True``
    tags every one of them ``highway=traffic_signals`` (netconvert joins them into one controller,
    ``--tls.join``). ``signals: False`` removes the signal tags from those nodes and from signal nodes on
    the ways into the junction up to ``APPROACH_SIGNAL_M`` away, which netconvert would otherwise turn
    into the junction's lights. Junctions the planner left alone keep what OpenStreetMap maps.

    Args:
        data: The merged OSM data, changed in place.
        setups: Junction setups: ``nodes`` (OSM node ids) and ``signals``.

    Returns:
        How many junctions were given lights, and how many had them taken away.
    """
    on = off = 0
    for s in setups:
        signals = s.get("signals")
        nodes = [int(n) for n in s.get("nodes", []) if int(n) in data.nodes]
        if not isinstance(signals, bool) or not nodes:
            continue
        if signals:
            for n in nodes:
                data.nodes[n][2]["highway"] = "traffic_signals"
            on += 1
            continue
        here = set(nodes)
        drop = set(here)
        uses: dict[int, int] = {}
        for w in data.ways.values():
            for n in set(w.nodes):
                uses[n] = uses.get(n, 0) + 1
        for w in data.ways.values():
            idx = [i for i, n in enumerate(w.nodes) if n in here]
            for i in idx:
                for step in (-1, 1):
                    j, dist = i, 0.0
                    while 0 <= j + step < len(w.nodes):
                        a, b = data.nodes[w.nodes[j]], data.nodes[w.nodes[j + step]]
                        dist += _metres((a[0], a[1]), (b[0], b[1]))
                        if dist > APPROACH_SIGNAL_M or uses.get(w.nodes[j + step], 0) > 1:
                            break  # too far, or the next junction (its lights are its own)
                        j += step
                        drop.add(w.nodes[j])
        for n in drop:
            tags = data.nodes[n][2]
            if not _signal_tagged(tags):
                continue
            if tags.get("highway") == "traffic_signals":
                del tags["highway"]
            if tags.get("crossing") == "traffic_signals":
                tags["crossing"] = "uncontrolled"
            tags.pop("traffic_signals", None)
            tags.pop("traffic_signals:direction", None)
        off += 1
    return on, off


def _metres(a: LonLat, b: LonLat) -> float:
    k = 111_320.0
    dx = (b[0] - a[0]) * k * math.cos(math.radians((a[1] + b[1]) / 2))
    dy = (b[1] - a[1]) * k
    return math.hypot(dx, dy)


def _project(p: LonLat, a: LonLat, b: LonLat) -> tuple[float, LonLat]:
    """Return the fraction along a–b of the point nearest to ``p`` and that point (plane at the latitude)."""
    c = math.cos(math.radians(p[1]))
    ax, ay, bx, by, px, py = a[0] * c, a[1], b[0] * c, b[1], p[0] * c, p[1]
    dx, dy = bx - ax, by - ay
    d2 = dx * dx + dy * dy
    t = 0.0 if d2 <= 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / d2))
    return t, (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def bus_way(w: Way) -> bool:
    """Whether a bus may drive along a way (its class, and no ``access``/``psv``/``bus`` ban)."""
    t = w.tags
    if t.get("highway") not in BUS_CLASSES or t.get("area") == "yes":
        return False
    if t.get("bus") in ("no",) or t.get("psv") in ("no",):
        return False
    if (
        t.get("access") in ("no", "private")
        and t.get("bus") not in ("yes", "designated")
        and t.get("psv") not in ("yes", "designated")
    ):
        return False
    return True


def nearest_street_point(data: OsmData, p: LonLat, skip: set[int]) -> tuple[int, int, LonLat, float] | None:
    """Return the street way, segment index, point and distance nearest to ``p`` (bus streets only)."""
    best: tuple[int, int, LonLat, float] | None = None
    for w in data.ways.values():
        if w.id in skip or not bus_way(w):
            continue
        for i in range(len(w.nodes) - 1):
            a = data.nodes[w.nodes[i]]
            b = data.nodes[w.nodes[i + 1]]
            _, q = _project(p, (a[0], a[1]), (b[0], b[1]))
            d = _metres(p, q)
            if best is None or d < best[3]:
                best = (w.id, i, q, d)
    return best


def join_to_street(data: OsmData, node: int, skip: set[int]) -> float | None:
    """Join a node to the nearest bus street with a short way; return its length, or None if too far."""
    lon, lat, _ = data.nodes[node]
    hit = nearest_street_point(data, (lon, lat), skip)
    if hit is None or hit[3] > MAX_GATE_LINK_M:
        return None
    wid, seg, q, d = hit
    w = data.ways[wid]
    a = data.nodes[w.nodes[seg]]
    b = data.nodes[w.nodes[seg + 1]]
    if _metres(q, (a[0], a[1])) < 1.0:
        at = w.nodes[seg]
    elif _metres(q, (b[0], b[1])) < 1.0:
        at = w.nodes[seg + 1]
    else:
        at = data.add_node(q)
        w.nodes.insert(seg + 1, at)
    if d >= 0.5:
        lid = data.new_id()
        data.ways[lid] = Way(lid, [node, at], _depot_tags(one_way=False))
        skip.add(lid)
    else:
        # The gate is on the street: use the street node itself.
        data.nodes[node] = data.nodes[at]
        for dw in data.ways.values():
            dw.nodes = [at if n == node else n for n in dw.nodes]
    return d


def _depot_tags(one_way: bool) -> dict[str, str]:
    # A busway: SUMO's OSM type map lets buses only on it.
    return {
        "highway": "busway",
        "maxspeed": "15",
        "lanes": "1",
        # SUMO's type map makes busways one-way unless told otherwise.
        "oneway": "yes" if one_way else "no",
    }


@dataclass
class DepotWays:
    """What was added for one depot: the OSM way of each network edge, and the gates joined to the streets."""

    edge_way: dict[str, int] = field(default_factory=dict)
    joined: dict[str, float] = field(default_factory=dict)
    unjoined: list[str] = field(default_factory=list)


def add_depot(data: OsmData, network: dict[str, Any]) -> DepotWays:
    """Add a depot's driving network (``Report.network``) as bus-only service ways and join its gates.

    Args:
        data: The merged OSM data, changed in place.
        network: ``{"nodes": [{"id", "lonlat"}], "edges": [{"id", "kind", "from", "to", "one_way",
            "coords"}]}``.

    Returns:
        The way id of each edge, and the gates joined to a street (``fence:<gate id>`` node ids).
    """
    out = DepotWays()
    node_ids: dict[str, int] = {}
    for n in network.get("nodes", []):
        ll = n["lonlat"]
        node_ids[str(n["id"])] = data.add_node((float(ll[0]), float(ll[1])))
    added: set[int] = set()
    for e in network.get("edges", []):
        coords = [(float(c[0]), float(c[1])) for c in e.get("coords", [])]
        a = node_ids.get(str(e["from"]))
        b = node_ids.get(str(e["to"]))
        if a is None or b is None or len(coords) < 2:
            continue
        inner = [data.add_node(c) for c in coords[1:-1]]
        wid = data.new_id()
        data.ways[wid] = Way(wid, [a, *inner, b], _depot_tags(bool(e.get("one_way"))))
        added.add(wid)
        out.edge_way[str(e["id"])] = wid
    for key, nid in node_ids.items():
        if not key.startswith("fence:"):
            continue
        d = join_to_street(data, nid, added)
        if d is None:
            out.unjoined.append(key.removeprefix("fence:"))
        else:
            out.joined[key.removeprefix("fence:")] = d
    return out


def clip(data: OsmData, west: float, south: float, east: float, north: float) -> None:
    """Drop the ways with no node inside the box (and nodes no way uses, except tagged ones)."""

    def inside(n: int) -> bool:
        lon, lat, _ = data.nodes[n]
        return west <= lon <= east and south <= lat <= north

    data.ways = {k: w for k, w in data.ways.items() if k >= ADDED_ID_BASE or any(inside(n) for n in w.nodes)}
    used = {n for w in data.ways.values() for n in w.nodes}
    data.nodes = {k: v for k, v in data.nodes.items() if k in used}
    data.relations = {
        k: r
        for k, r in data.relations.items()
        if all(
            (m.get("type") != "way" or int(m.get("ref", "0")) in data.ways)
            and (m.get("type") != "node" or int(m.get("ref", "0")) in data.nodes)
            for m in r.findall("member")
        )
    }


def write(data: OsmData, path: str) -> None:
    """Write the data as one OSM XML file (nodes, then ways, then relations, as netconvert expects)."""
    root = ET.Element("osm", version="0.6", generator="mobsimlab")
    for nid in sorted(data.nodes):
        lon, lat, tags = data.nodes[nid]
        n = ET.SubElement(root, "node", id=str(nid), lat=f"{lat:.7f}", lon=f"{lon:.7f}", version="1")
        for k, v in tags.items():
            ET.SubElement(n, "tag", k=k, v=v)
    for wid in sorted(data.ways):
        w = data.ways[wid]
        el = ET.SubElement(root, "way", id=str(wid), version="1")
        for ref in w.nodes:
            ET.SubElement(el, "nd", ref=str(ref))
        for k, v in w.tags.items():
            ET.SubElement(el, "tag", k=k, v=v)
    for rid in sorted(data.relations):
        root.append(data.relations[rid])
    ET.ElementTree(root).write(path, encoding="utf-8", xml_declaration=True)


def way_of_edge(edge_id: str) -> int | None:
    """Return the OSM way id a netconvert edge id comes from (``123#2``, ``-123#0``, ``123``), or None."""
    s = edge_id.lstrip("-").split("#", 1)[0]
    return int(s) if s.isdigit() else None


def reversed_edge(edge_id: str) -> bool:
    """Whether a netconvert edge runs against its OSM way's direction."""
    return edge_id.startswith("-")
