"""Background car traffic of a road run, from the traffic peaks the planner sets per street in the GIS tab.

Every street carries cars in each direction (one-way streets: the one direction) at the rate the planner set
for the morning or evening peak (``StreetSetup.cars_morning_peak`` / ``cars_evening_peak``), else the default
for its road type (``street.peak_cars_*_vph``). Outside the two peak windows, the rate is the peak value times
the project's off-peak share. Buses-only ways (busways, depots) and pedestrian streets carry none.

The cars are sampled from candidate routes (SUMO's ``randomTrips.py``, routed with ``duarouter``) so that the
count on each street does not go above its target: the routes are taken in a seeded random order, again and
again, while every street they use still has room (the greedy method of SUMO's ``routeSampler``). Each car
leaves at a random time in its interval. Cars are not shown in the replay; they are there to load the streets.
"""

from __future__ import annotations

import os
import random
import sys
import xml.etree.ElementTree as ET  # noqa: S405 (files SUMO itself wrote for this run)
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from mobsim_worker.jobs.road.network import RoadNet, run_tool, sumo_tool
from mobsim_worker.jobs.road.osm import Way, way_of_edge

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
    """Return the target car count of each edge in each interval."""
    out: list[dict[str, float]] = []
    edges = [e for e in net.net.getEdges() if e.allows("passenger") and e.getFunction() == ""]
    for part in parts:
        hours = (part.end - part.begin) / 3600.0
        c: dict[str, float] = {}
        for e in edges:
            w = way_of_edge(e.getID())
            if w is None:
                continue
            rate = way_rate(ways.get(w), setups.get(w), defaults, part.peak, off_peak_share)
            if rate > 0:
                c[e.getID()] = rate * hours
        out.append(c)
    return out


def candidates(net_file: str, cwd: str, begin: float, end: float, wanted: int, seed: int) -> list[list[str]]:
    """Generate candidate car routes over the whole network with ``randomTrips.py`` and ``duarouter``."""
    n = max(50, min(MAX_CANDIDATES, wanted * CANDIDATES_PER_CAR))
    span = max(1.0, end - begin)
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
        "--validate",
        "--seed",
        str(seed),
        "-o",
        "candidates.trips.xml",
        "-r",
        "candidates.rou.xml",
    ]
    run_tool(args, cwd)
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

    Routes are taken in a random order, pass after pass, while every edge they use has room for a car.
    """
    left = {e: float(c) for e, c in target.items()}
    order = list(range(len(routes)))
    chosen: list[int] = []
    while len(chosen) < max_cars:
        rng.shuffle(order)
        took = 0
        for i in order:
            r = routes[i]
            if all(left.get(e, 0.0) >= 1.0 for e in r):
                for e in r:
                    left[e] -= 1.0
                chosen.append(i)
                took += 1
                if len(chosen) >= max_cars:
                    break
        if took == 0:
            break
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
) -> Traffic:
    """Write the background cars of the run window ``[begin, end)`` to ``path`` (a SUMO routes file)."""
    by_way = {int(s["way"]): s for s in setups if "way" in s}
    defaults = {str(k): float(v) for k, v in dict(traffic.get("defaults", {})).items()}
    share = float(traffic.get("off_peak_share", 0.0))
    peaks = [list(map(float, p)) for p in traffic.get("peaks", [])]
    parts = intervals(begin, end, peaks)
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
    for part, target in zip(parts, targets, strict=True):
        wanted = int(sum(target.values()) / 8) + 1
        if not target or wanted <= 1:
            continue
        routes = candidates(net_file, cwd, part.begin, part.end, wanted, seed)
        for i in sample(routes, target, rng, max_cars=200_000):
            r = list(routes[i])
            cars.append((part.begin + rng.random() * (part.end - part.begin), r))
            sampled_km += sum(lengths.get(e, 0.0) for e in r) / 1000.0
    cars.sort(key=lambda c: c[0])
    for k, (t, r) in enumerate(cars):
        v = ET.SubElement(root, "vehicle", id=f"bg{k}", type="car", depart=f"{t:.1f}", departLane="best")
        ET.SubElement(v, "route", edges=" ".join(r))
    ET.ElementTree(root).write(path, encoding="utf-8", xml_declaration=True)
    return Traffic(cars=len(cars), target_car_km=target_km, sampled_car_km=sampled_km)
