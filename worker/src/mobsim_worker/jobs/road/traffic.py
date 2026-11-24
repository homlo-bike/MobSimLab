"""Background car traffic of a road run, from the traffic peaks the planner sets per street in the GIS tab.

Every street carries cars in each direction (one-way streets: the one direction) at the rate the planner set
for the morning or evening peak (``StreetSetup.cars_morning_peak`` / ``cars_evening_peak``), else the default
for its road type (``street.peak_cars_*_vph``). Outside the two peak windows, the rate is the peak value times
the project's off-peak share. Buses-only ways (busways, depots) and pedestrian streets carry none.

The cars are sampled from candidate routes (SUMO's ``randomTrips.py``, routed once with ``duarouter``) so
that the count on each street does not go above its target: the routes are taken in a seeded random order,
again and again, while every street they use still has room (the greedy method of SUMO's ``routeSampler``).
Each car leaves at a random time in its interval. Cars are not shown in the replay; they are there to load
the streets.

The default rates of the road types are what such a street carries where its junctions let the cars through,
which a city's street network as a whole cannot: a side street that gives way to two main roads gets a car
through only in the gaps of their traffic, and a car waiting to turn across oncoming traffic holds up the
queue behind it. Filling every street to its default jammed whole districts (Damascus bug 30). So each
street's default rate is cut to ``MAX_LOAD`` of what its end junction lets through (``approach_capacity``).
A street's own counts from the GIS tab are kept as the planner set them.
"""

from __future__ import annotations

import math
import os
import random
import sys
import time
import xml.etree.ElementTree as ET  # noqa: S405 (files SUMO itself wrote for this run)
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import structlog

from mobsim_worker.jobs.road.network import RoadNet, run_tool, sumo_tool
from mobsim_worker.jobs.road.osm import Way, way_of_edge

log = structlog.get_logger("mobsim_worker")

#: Road type of each OSM highway class (apps/web/src/features/street-setup/model.ts ``peakCarsDefault``).
ROAD_TYPE = {
    "trunk": "trunk",
    "trunk_link": "trunk",
    "motorway": "trunk",
    "motorway_link": "trunk",
    "primary": "primary",
    "primary_link": "primary",
    "secondary": "secondary",
    "secondary_link": "secondary",
    "tertiary": "tertiary",
    "tertiary_link": "tertiary",
    "busway": "none",
    "bus_guideway": "none",
    "pedestrian": "none",
}

#: Candidate routes per car the counts ask for (more gives the sampler more choice).
CANDIDATES_PER_CAR = 3

#: Most candidate routes generated.
MAX_CANDIDATES = 60_000

#: Threads ``duarouter`` routes the candidate routes on (the worker runs one run at a time).
ROUTING_THREADS = max(1, min(4, os.cpu_count() or 1))

#: Cars per hour a lane passes when its queue moves without a stop (HCM base saturation flow, rounded).
SATURATION_VPH = 1800.0

#: Share of what a junction lets through that a street's default background traffic may fill.
MAX_LOAD = 0.8

#: Gap a car waits for before it pulls out of a street that gives way, and between cars that follow, s
#: (HCM two-way stop control, cars).
CRITICAL_GAP_S = 6.5
FOLLOW_UP_S = 3.5

#: Cars per hour a junction of equal streets (right before left, all-way stop) passes in all.
EQUAL_JUNCTION_VPH = 1200.0


@dataclass(frozen=True)
class Interval:
    """A part of the run with one traffic rate: ``[begin, end)`` in seconds, and whether it is a peak."""

    begin: float
    end: float
    peak: str | None  # "morning", "evening" or None (off peak)


def intervals(begin: float, end: float, peaks: Sequence[Sequence[float]]) -> list[Interval]:
    """Cut the run's window at the peak windows' edges (the first peak is the morning one)."""
    cuts = {begin, end}
    for a, b in peaks:
        cuts.update(t for t in (a, b) if begin < t < end)
    ts = sorted(cuts)
    out: list[Interval] = []
    for a, b in zip(ts, ts[1:], strict=False):
        mid = (a + b) / 2
        which = None
        for k, (pa, pb) in enumerate(peaks):
            if pa <= mid < pb:
                which = "morning" if k == 0 else "evening"
        out.append(Interval(a, b, which))
    return out


def way_rate(
    way: Way | None,
    setup: Mapping[str, Any] | None,
    defaults: Mapping[str, float],
    peak: str | None,
    off_peak_share: float,
) -> float:
    """Cars per hour in one direction of a way in an interval."""
    if way is None:
        return 0.0
    road = ROAD_TYPE.get(way.tags.get("highway", ""), "local")
    if road == "none":
        return 0.0
    field = "cars_evening_peak" if peak == "evening" else "cars_morning_peak"
    own = setup.get(field) if setup else None
    if peak is None:
        # Off peak: the share of the peak value (the busier of the two when the planner set both).
        vals = [setup.get(f) for f in ("cars_morning_peak", "cars_evening_peak")] if setup else []
        nums = [float(v) for v in vals if isinstance(v, int | float)]
        base = max(nums) if nums else float(defaults.get(road, 0.0))
        return max(0.0, base * off_peak_share)
    if isinstance(own, int | float):
        return max(0.0, float(own))
    return max(0.0, float(defaults.get(road, 0.0)))


def counts(
    net: RoadNet,
    ways: Mapping[int, Way],
    setups: Mapping[int, Mapping[str, Any]],
    defaults: Mapping[str, float],
    parts: Sequence[Interval],
    off_peak_share: float,
) -> list[dict[str, float]]:
    """Return the target car count of each edge in each interval.

    Default rates are cut to ``MAX_LOAD`` of what the edge's end junction lets through; the planner's own
    counts are kept.
    """
    out: list[dict[str, float]] = []
    edges = [e for e in net.net.getEdges() if e.allows("passenger") and e.getFunction() == ""]
    for part in parts:
        hours = (part.end - part.begin) / 3600.0
        rates: dict[str, float] = {}
        own: set[str] = set()
        for e in edges:
            w = way_of_edge(e.getID())
            if w is None:
                continue
            rate = way_rate(ways.get(w), setups.get(w), defaults, part.peak, off_peak_share)
            if rate > 0:
                rates[e.getID()] = rate
                if planner_set(setups.get(w)):
                    own.add(e.getID())
        out.append({e: r * hours for e, r in limit(net, rates, own).items()})
    return out


def limit(net: RoadNet, rates: Mapping[str, float], own: set[str]) -> dict[str, float]:
    """Cut each edge's rate to ``MAX_LOAD`` of what its end junction lets through (``own`` edges stay).

    The traffic a street gives way to is taken at its full rate, not cut: SUMO's drivers take fewer gaps
    than the HCM's, and with the cut rates the test city still jammed.
    """
    cap = approach_capacity(net, rates)
    return {e: r if e in own else min(r, MAX_LOAD * cap.get(e, r / MAX_LOAD)) for e, r in rates.items()}


def planner_set(setup: Mapping[str, Any] | None) -> bool:
    """Whether the planner set a street's own peak counts in the GIS tab."""
    if not setup:
        return False
    return any(isinstance(setup.get(f), int | float) for f in ("cars_morning_peak", "cars_evening_peak"))


def gap_capacity(conflicting_vph: float) -> float:
    """Cars per hour a lane that gives way gets into the gaps of ``conflicting_vph`` (HCM two-way stop)."""
    if conflicting_vph <= 0:
        return 3600.0 / FOLLOW_UP_S
    v = conflicting_vph / 3600.0
    return conflicting_vph * math.exp(-v * CRITICAL_GAP_S) / (1.0 - math.exp(-v * FOLLOW_UP_S))


def _phases(net: RoadNet, tls_id: str) -> list[tuple[str, float]]:
    """The signal program of a junction: each phase's link states and its share of the cycle."""
    tls = net.net.getTLS(tls_id)
    programs = list(tls.getPrograms().values()) if tls else []
    if not programs:
        return []
    phases = [(str(ph.state), float(ph.duration)) for ph in programs[0].getPhases()]
    cycle = sum(d for _, d in phases)
    return [(st, d / cycle) for st, d in phases] if cycle > 0 else []


def approach_capacity(net: RoadNet, rates: Mapping[str, float]) -> dict[str, float]:
    """Return the cars per hour each edge's end junction lets through from it.

    Each link (a lane's turn into the junction) passes ``SATURATION_VPH`` while it may go freely, and the
    gaps in the traffic it gives way to (``gap_capacity``) while it must yield:

    - At traffic lights: per phase, a protected green (``G``) at the full rate; a permissive green (``g``,
      such as a left turn across oncoming traffic) in the gaps of the edges that have a protected green in
      the same phase, their rate packed into their green time.
    - Without lights: a link with priority (``M``) at the full rate; one that gives way (``m``, ``s``, such
      as a side street or a left turn off the main road) in the gaps of the other edges into the junction
      that have priority; links of equal streets (``=``, ``w``) at an even share of ``EQUAL_JUNCTION_VPH``.

    A lane passes no more than its slowest link (the car at the front of the queue holds the others up).
    At traffic lights an edge passes the sum of its lanes: a car waiting to turn clears at the end of the
    green. Without lights it may wait on and on, and the cars behind it squeeze into the lanes beside it, so
    the edge passes its slowest lane's rate times its lanes.

    Args:
        net: The network (read with its signal programs).
        rates: Cars per hour on each edge (the edges to rate).
    """
    links: dict[str, list[tuple[str, Any]]] = {}
    by_node: dict[str, list[str]] = {}
    for eid in rates:
        e = net.edge(eid)
        by_node.setdefault(e.getToNode().getID(), []).append(eid)
        links[eid] = [
            (c.getFromLane().getID(), c)
            for conns in e.getOutgoing().values()
            for c in conns
            if c.getFromLane().allows("passenger")
        ]
    programs: dict[str, list[tuple[str, float]]] = {}

    def program(tls_id: str) -> list[tuple[str, float]]:
        if tls_id not in programs:
            programs[tls_id] = _phases(net, tls_id)
        return programs[tls_id]

    def green(eid: str, tls_id: str, phase: str) -> bool:
        return any(
            c.getTLSID() == tls_id
            and 0 <= c.getTLLinkIndex() < len(phase)
            and phase[c.getTLLinkIndex()] == "G"
            for _, c in links[eid]
        )

    def green_share(eid: str, tls_id: str) -> float:
        return sum(share for st, share in program(tls_id) if green(eid, tls_id, st))

    def link_capacity(eid: str, c: Any) -> float:
        node = net.edge(eid).getToNode().getID()
        others = [o for o in by_node[node] if o != eid]
        tls_id = c.getTLSID()
        if tls_id:
            phases = program(tls_id)
            k = int(c.getTLLinkIndex())
            if not phases or not 0 <= k < len(phases[0][0]):
                return SATURATION_VPH / 2
            total = 0.0
            for st, share in phases:
                if st[k] == "G":
                    total += share * SATURATION_VPH
                elif st[k] == "g":
                    foes = sum(
                        rates[o] / max(0.1, green_share(o, tls_id)) for o in others if green(o, tls_id, st)
                    )
                    total += share * min(SATURATION_VPH, gap_capacity(foes))
            return total
        state = str(c.getState())
        if state in ("M", "O"):
            return SATURATION_VPH
        if state in ("m", "s", "o"):
            major = sum(rates[o] for o in others if any(str(x.getState()) == "M" for _, x in links[o]))
            return min(SATURATION_VPH, gap_capacity(major))
        return EQUAL_JUNCTION_VPH / max(1, len(by_node[node]))

    cap: dict[str, float] = {}
    for eid, ls in links.items():
        lanes: dict[str, float] = {}
        for lane, c in ls:
            lanes[lane] = min(lanes.get(lane, SATURATION_VPH), link_capacity(eid, c))
        if lanes and any(c.getTLSID() for _, c in ls):
            cap[eid] = sum(lanes.values())
        elif lanes:
            cap[eid] = len(lanes) * min(lanes.values())
        else:
            cap[eid] = SATURATION_VPH * max(
                1, sum(1 for ln in net.edge(eid).getLanes() if ln.allows("passenger"))
            )
    return cap


def candidates(
    net_file: str,
    cwd: str,
    wanted: int,
    seed: int,
    should_stop: Callable[[], bool] | None = None,
) -> list[list[str]]:
    """Generate candidate car routes over the whole network with ``randomTrips.py`` and ``duarouter``.

    The routes do not depend on the time of day (their cars are given departure times when sampled), so one
    set serves every interval of the run. Trips with no route are left out by ``duarouter`` itself, so the
    trips are not validated first (that routed them all twice or more); ``duarouter`` routes with A* on
    several threads.
    """
    n = max(50, min(MAX_CANDIDATES, wanted * CANDIDATES_PER_CAR))
    span = 3600.0
    args = [
        sys.executable,
        sumo_tool("randomTrips.py"),
        "-n",
        net_file,
        "-b",
        "0",
        "-e",
        f"{span:.0f}",
        "-p",
        f"{span / n:.4f}",
        "--fringe-factor",
        "5",
        "--min-distance",
        "300",
        "--vclass",
        "passenger",
        "--no-validate",
        "--threads",
        str(ROUTING_THREADS),
        "--duarouter-routing-algorithm",
        "astar",
        "--seed",
        str(seed),
        "-o",
        "candidates.trips.xml",
        "-r",
        "candidates.rou.xml",
    ]
    run_tool(args, cwd, should_stop=should_stop)
    root = ET.parse(os.path.join(cwd, "candidates.rou.xml")).getroot()  # noqa: S314
    routes: list[list[str]] = []
    for v in root.iter("vehicle"):
        r = v.find("route")
        if r is not None and r.get("edges"):
            routes.append(r.get("edges", "").split())
    return routes


def sample(
    routes: Sequence[Sequence[str]], target: Mapping[str, float], rng: random.Random, max_cars: int
) -> list[int]:
    """Pick routes (by index, with repeats) so that no edge's count goes above its target.

    Routes are taken in a random order, pass after pass, while every edge they use has room for a car. A
    route that does not fit once never fits again (the room on its edges only shrinks), so it is left out of
    the later passes; edges are numbered so that each check is a list lookup.
    """
    ids: dict[str, int] = {}
    left: list[float] = []
    for e, c in target.items():
        ids[e] = len(left)
        left.append(float(c))
    none = len(left)
    left.append(0.0)  # edges with no target: no room
    paths = [[ids.get(e, none) for e in r] for r in routes]
    alive = [i for i, p in enumerate(paths) if all(left[k] >= 1.0 for k in p)]
    chosen: list[int] = []
    while alive and len(chosen) < max_cars:
        rng.shuffle(alive)
        still: list[int] = []
        for i in alive:
            p = paths[i]
            if all(left[k] >= 1.0 for k in p):
                for k in p:
                    left[k] -= 1.0
                chosen.append(i)
                still.append(i)
                if len(chosen) >= max_cars:
                    break
        alive = still
    return chosen


@dataclass
class Traffic:
    """Background cars: routes file written, and what they were asked to do."""

    cars: int
    target_car_km: float
    sampled_car_km: float


def write_background(
    net: RoadNet,
    net_file: str,
    cwd: str,
    ways: Mapping[int, Way],
    setups: Sequence[Mapping[str, Any]],
    traffic: Mapping[str, Any],
    begin: float,
    end: float,
    seed: int,
    path: str,
    should_stop: Callable[[], bool] | None = None,
) -> Traffic:
    """Write the background cars of the run window ``[begin, end)`` to ``path`` (a SUMO routes file).

    Raises:
        Stopped: ``should_stop`` said yes while the candidate routes were made.
    """
    by_way = {int(s["way"]): s for s in setups if "way" in s}
    defaults = {str(k): float(v) for k, v in dict(traffic.get("defaults", {})).items()}
    share = float(traffic.get("off_peak_share", 0.0))
    peaks = [list(map(float, p)) for p in traffic.get("peaks", [])]
    parts = intervals(begin, end, peaks)
    t0 = time.monotonic()
    targets = counts(net, ways, by_way, defaults, parts, share)
    lengths = {e.getID(): e.getLength() for e in net.net.getEdges()}
    target_km = sum(c * lengths.get(e, 0.0) for t in targets for e, c in t.items()) / 1000.0
    rng = random.Random(seed)  # noqa: S311 (simulation sampling, not security)
    root = ET.Element("routes")
    ET.SubElement(
        root,
        "vType",
        id="car",
        vClass="passenger",
        color="0.6,0.6,0.6",
        speedDev="0.1",
        jmIgnoreFoeProb="0",
    )
    cars: list[tuple[float, list[str]]] = []
    sampled_km = 0.0
    wanted = [int(sum(t.values()) / 8) + 1 if t else 0 for t in targets]
    log.info(
        "background traffic: counts set",
        intervals=len(parts),
        target_car_km=round(target_km),
        seconds=round(time.monotonic() - t0, 1),
    )
    routes: list[list[str]] = []
    if max(wanted, default=0) > 1:
        t1 = time.monotonic()
        routes = candidates(net_file, cwd, max(wanted), seed, should_stop)
        log.info(
            "background traffic: candidate routes made",
            routes=len(routes),
            threads=ROUTING_THREADS,
            seconds=round(time.monotonic() - t1, 1),
        )
    for part, target, w in zip(parts, targets, wanted, strict=True):
        if not target or w <= 1:
            continue
        for i in sample(routes, target, rng, max_cars=200_000):
            r = list(routes[i])
            cars.append((part.begin + rng.random() * (part.end - part.begin), r))
            sampled_km += sum(lengths.get(e, 0.0) for e in r) / 1000.0
    cars.sort(key=lambda c: c[0])
    for k, (t, r) in enumerate(cars):
        v = ET.SubElement(root, "vehicle", id=f"bg{k}", type="car", depart=f"{t:.1f}", departLane="best")
        ET.SubElement(v, "route", edges=" ".join(r))
    ET.ElementTree(root).write(path, encoding="utf-8", xml_declaration=True)
    log.info("background traffic: cars written", cars=len(cars), seconds=round(time.monotonic() - t0, 1))
    return Traffic(cars=len(cars), target_car_km=target_km, sampled_car_km=sampled_km)
