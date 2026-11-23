"""The street lines' vehicles in SUMO: from their depot slot, through their trips, back to a depot slot.

Each line comes from the street line tool as its circuit (points and routed legs from its first end stop), its
planned departures from that stop in the run's window, its dwell and layover, and its depot runs. Here:

- **Blocks.** Departures are given to vehicles in order: a vehicle takes the next departure once it is planned
  back at the first stop (as the system test's street run does); a new vehicle pulls out when none is back.
- **Routes.** A vehicle's route is: its depot slot, out of the depot (gate), the pull-out run, its circuits,
  the rest of the circuit to the pull-in stop, the pull-in run, in through the depot gate, to a slot. Drawn
  routes are matched to the SUMO edges; gaps are closed with the shortest bus path.
- **Stops.** Every stop of every trip is a SUMO stop with the line's dwell. At the first stop the vehicle
  waits for its departure (``until``); at other end stops it waits for its planned departure (the layover
  takes up delay). Dwell is fixed per line for now; passenger-based dwell comes with the demand model.
- **Depots.** A vehicle enters the network at its slot (``departPos``) at its pull-out time and leaves it at a
  slot of the same depot (``arrivalPos``), so it is never inserted or removed mid-route. Lines without a
  depot start and end on the street at their depot point, or at their first stop; the run notes this.
"""

from __future__ import annotations

import math
import xml.etree.ElementTree as ET
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from mobsim_worker.jobs.road.network import NoBusLink, RoadNet
from mobsim_worker.jobs.road.osm import DepotWays

LonLat = tuple[float, float]

#: Minutes before its first departure a vehicle is planned to reach the first stop, s.
READY_BEFORE_S = 180.0

#: Speed assumed inside a depot to plan the time from the slot to the gate, m/s.
DEPOT_SPEED_MPS = 3.0

#: Stop length on the street beyond the vehicle, m (room to pull in).
STOP_EXTRA_M = 5.0


@dataclass
class PlannedStop:
    """One stop a vehicle makes: which trip and point, its planned departure, and the SUMO stop."""

    trip: int
    point: int
    name: str
    kind: str  # stop | end_stop | last (back at the first stop after the last trip)
    planned_dep: float
    first: bool  # the first stop of a trip (the vehicle waits for its departure)
    lane: str
    pos: float


@dataclass
class TransitVehicle:
    """A vehicle of a line in the run."""

    id: str
    line: int
    number: int
    depart: float
    trips: list[float]
    stops: list[PlannedStop]
    route: list[str]
    depart_lane: str
    depart_pos: float
    arrival_pos: float | None
    slot_out: LonLat | None
    slot_in: LonLat | None
    depot: str | None


@dataclass
class LinePlan:
    """What the run plans for one line, and why it could not run when it cannot."""

    index: int
    name: str
    mode: str
    color: str
    energy: str
    cycle_s: float
    circuit_m: float = 0.0
    vehicles: list[TransitVehicle] = field(default_factory=list)
    problem: str | None = None
    notes: list[str] = field(default_factory=list)


def _pt(p: Sequence[float]) -> LonLat:
    return (float(p[0]), float(p[1]))


def _metres(a: LonLat, b: LonLat) -> float:
    k = 111_320.0
    return math.hypot((b[0] - a[0]) * k * math.cos(math.radians(a[1])), (b[1] - a[1]) * k)


def planned_offsets(line: Mapping[str, Any]) -> tuple[list[float], float]:
    """Planned departure of each circuit point after the trip's start, and the planned circuit time.

    Points are in circuit order from the first stop (point 0); the circuit ends back at point 0.

    Returns:
        Offsets (point 0 is 0) and the time until the vehicle is ready again at point 0, s.
    """
    points = line["points"]
    legs = line["legs"]
    dwell = float(line["dwell_s"])
    layover = float(line["layover_s"])
    offs = [0.0]
    t = 0.0
    n = len(points)
    for k in range(n):
        t += float(legs[k]["time_s"])
        p = points[(k + 1) % n]
        if (k + 1) % n == 0:
            t += dwell
            break
        stop = p["kind"] != "via"
        t += (dwell if stop else 0.0) + (layover if p["kind"] == "end_stop" else 0.0)
        offs.append(t)
    return offs, t


def blocks(departures: Sequence[float], cycle_s: float) -> list[list[float]]:
    """Give each departure to a vehicle: the one planned back first, else a new one."""
    free: list[float] = []
    out: list[list[float]] = []
    for d in sorted(departures):
        best = min(range(len(free)), key=lambda i: free[i], default=-1)
        if best < 0 or free[best] > d:
            free.append(d + cycle_s)
            out.append([d])
        else:
            free[best] = d + cycle_s
            out[best].append(d)
    return out


@dataclass
class DepotPlace:
    """Where a vehicle parks: the depot, its lane edge, position and the slot centre."""

    depot: str
    edge: str
    lane: str
    pos: float
    center: LonLat


class Depots:
    """The depots of the run in the SUMO network: lane edges, slots and gates."""

    def __init__(self, net: RoadNet, depots: Sequence[Mapping[str, Any]], ways: Mapping[str, DepotWays]):
        """Index the depots' slots and assignments."""
        self.net = net
        self.by_id = {str(d["id"]): d for d in depots}
        self.ways = ways
        self.slot_of: dict[tuple[str, int], tuple[str, str, Mapping[str, Any]]] = {}
        self.lane_edge: dict[tuple[str, str], str] = {}
        self.gate_edges: dict[str, list[str]] = {}
        for d in depots:
            did = str(d["id"])
            w = ways.get(did)
            lanes = {str(ln["id"]): ln for ln in d.get("lanes", [])}
            edges = d.get("network", {}).get("edges", [])
            for e in edges:
                wid = w.edge_way.get(str(e["id"])) if w else None
                if wid is None:
                    continue
                sumo_ids = [s for s in (str(wid), f"{wid}#0") if net.has_edge(s)]
                if e.get("kind") == "lane" and e.get("of") and sumo_ids:
                    self.lane_edge[(did, str(e["of"]))] = sumo_ids[0]
                if e.get("kind") == "gate":
                    self.gate_edges.setdefault(did, []).extend(sumo_ids)
            for a in d.get("assignments", []):
                lane = lanes.get(str(a["lane"]))
                if lane is None:
                    continue
                slot = next((s for s in lane.get("slots", []) if str(s["id"]) == str(a["slot"])), None)
                if slot is not None:
                    self.slot_of[(str(a["line"]), int(a["vehicle"]))] = (did, str(a["lane"]), slot)

    def place(self, line_key: str, number: int) -> DepotPlace | None:
        """Return the slot a line's vehicle parks in, on the SUMO network, or None."""
        hit = self.slot_of.get((line_key, number))
        if hit is None:
            return None
        did, lane_id, slot = hit
        edge = self.lane_edge.get((did, lane_id))
        if edge is None:
            return None
        center = _pt(slot["center"])
        lp = self.net.lane_pos(edge, center)
        if lp is None:
            return None
        lane, pos = lp
        length = float(self.net.edge(edge).getLength())
        return DepotPlace(did, edge, lane, max(1.0, min(length - 0.5, pos)), center)


@dataclass
class Matched:
    """A line's circuit on the SUMO network: edges, and where each stop point is on them."""

    edges: list[str]
    at: dict[int, tuple[int, str, float]]  # point -> (edge index, lane, pos); the start point is at index 0
    end_at: tuple[int, str, float]  # the start point again, at the end of the circuit


def match_circuit(net: RoadNet, line: Mapping[str, Any]) -> Matched | str:
    """Match a line's circuit to the network and place its stops; a message when it cannot."""
    points = line["points"]
    coords: list[LonLat] = []
    for leg in line["legs"]:
        cs = [_pt(c) for c in leg["coords"]]
        coords.extend(cs if not coords else cs[1:])
    try:
        edges = net.match(coords)
    except NoBusLink as e:
        return no_link(e, points)
    if len(edges) < 1:
        return "its route could not be matched to the streets"
    at: dict[int, tuple[int, str, float]] = {}
    start = 0
    for i, p in enumerate(points):
        if p["kind"] == "via":
            continue
        placed = net.place(edges, _pt(p["lonlat"]), start)
        if placed is None:
            return f"stop {p.get('name') or i + 1} is not on the matched route"
        at[i] = (placed.index, placed.lane, placed.pos)
        start = placed.index
    # The start point again, at the end: search backwards from the last edge.
    p0 = _pt(points[0]["lonlat"])
    end = None
    for k in range(len(edges) - 1, max(start, len(edges) - 60) - 1, -1):
        lp = net.lane_pos(edges[k], p0)
        if lp is None:
            continue
        lane, pos = lp
        x, y = net.xy(p0)
        lane_obj = net.net.getLane(lane)
        _, dist = lane_obj.getClosestLanePosAndDist((x, y))
        if dist <= 30.0:
            end = (k, lane, pos)
            break
    if end is None:
        return "the route does not come back to its first stop"
    return Matched(edges, at, end)


def no_link(e: NoBusLink, points: Sequence[Mapping[str, Any]]) -> str:
    """Say where a route has no way for a bus, by the nearest stop of the line."""
    stops = [p for p in points if p.get("kind") != "via"] or list(points)
    near = min(stops, key=lambda p: _metres(e.at, _pt(p["lonlat"])))
    name = near.get("name") or f"stop {points.index(near) + 1}"
    return (
        f"{e}, near {name} ({_metres(e.at, _pt(near['lonlat'])):.0f} m away): the traffic model's streets "
        "have no turn there that a bus may take, for example a U-turn or a banned turn. Move the route "
        "or a via point so that it takes another street there"
    )


def stop_range(pos: float, lane_len: float, veh_len: float) -> tuple[float, float]:
    """Return ``startPos``/``endPos`` of a stop of a vehicle at ``pos`` (front at the end) on the lane."""
    end = min(lane_len, max(veh_len + STOP_EXTRA_M, pos + veh_len / 2))
    return max(0.0, end - veh_len - STOP_EXTRA_M), end


class RouteBuilder:
    """A vehicle's route, built piece by piece; gaps between pieces are closed with the shortest bus path."""

    def __init__(self, net: RoadNet) -> None:
        """Start an empty route."""
        self.net = net
        self.edges: list[str] = []

    def add(self, piece: Sequence[str]) -> int | None:
        """Append a piece; return the route index of its first edge, or None when it cannot be reached."""
        if not piece:
            return len(self.edges) - 1
        n = len(self.edges)
        if n and self.edges[-1] == piece[0]:
            self.edges.extend(piece[1:])
            return n - 1
        if not self.net.join(self.edges, piece):
            return None
        return len(self.edges) - len(piece)


def _stop(
    points: Sequence[Mapping[str, Any]], p_i: int, trip: int, dep: float, lane: str, pos: float
) -> PlannedStop:
    p = points[p_i]
    return PlannedStop(
        trip=trip,
        point=p_i,
        name=str(p.get("name") or f"Stop {p_i + 1}"),
        kind=str(p["kind"]),
        planned_dep=dep,
        first=False,
        lane=lane,
        pos=pos,
    )


def _pull_run(
    net: RoadNet,
    run: Mapping[str, Any] | None,
    what: str,
    points: Sequence[Mapping[str, Any]],
    notes: list[str],
) -> list[str]:
    """Match a pull-out or pull-in run; without a bus path its vehicles take the shortest one instead."""
    if not run:
        return []
    try:
        return net.match([_pt(c) for c in run["coords"]])
    except NoBusLink as e:
        notes.append(
            f"the {what} run is not followed ({no_link(e, points)}); its vehicles take the shortest way"
        )
        return []


def plan_line(net: RoadNet, line: Mapping[str, Any], depots: Depots) -> LinePlan:
    """Plan a line's vehicles: blocks, routes, stops and depot slots."""
    index = int(line["index"])
    veh = line["vehicle"]
    plan = LinePlan(
        index=index,
        name=str(line.get("name") or f"Street line {index + 1}"),
        mode=str(line.get("mode", "bus")),
        color=str(line.get("color", "#d2392c")),
        energy=str(veh.get("energy", "other")),
        cycle_s=0.0,
    )
    points = line["points"]
    if len(points) < 2 or len(line["legs"]) != len(points):
        plan.problem = "it has fewer than two points or is not routed"
        return plan
    offs, cycle = planned_offsets(line)
    plan.cycle_s = cycle
    deps = [float(d) for d in line.get("departures", [])]
    if not deps:
        plan.problem = "it has no departures in the period"
        return plan
    m = match_circuit(net, line)
    if isinstance(m, str):
        plan.problem = m
        return plan
    total = sum(float(net.edge(e).getLength()) for e in m.edges)
    last_len = float(net.edge(m.edges[-1]).getLength())
    plan.circuit_m = max(1.0, total - m.at[0][2] - (last_len - m.end_at[2]))
    pull_out = line.get("pull_out") or None
    pull_in = line.get("pull_in") or None
    out_at = int(pull_out["at"]) if pull_out else 0
    in_at = int(pull_in["at"]) if pull_in else 0
    out_edges = _pull_run(net, pull_out, "pull-out", points, plan.notes)
    in_edges = _pull_run(net, pull_in, "pull-in", points, plan.notes)
    depot_id = str(line["depot"]) if line.get("depot") else None
    if depot_id is None:
        plan.notes.append("no depot: its vehicles start and end on the street")
    stops_order = [i for i in range(len(points)) if points[i]["kind"] != "via"]
    circuit = m.edges
    for number, trips in enumerate(blocks(deps, cycle)):
        place_out = depots.place(f"street:{index}", number) if depot_id else None
        if depot_id and place_out is None:
            plan.notes.append(f"vehicle {number + 1} has no slot in the depot: it starts at the depot gate")
        rb = RouteBuilder(net)
        if place_out is not None:
            rb.add([place_out.edge])
            if out_edges and rb.add(out_edges) is None:
                plan.notes.append(f"vehicle {number + 1} cannot leave its depot: it starts on the street")
                place_out = None
                rb = RouteBuilder(net)
        if place_out is None and depot_id:
            gates = depots.gate_edges.get(depot_id, [])
            if gates:
                rb.add([gates[0]])
        if out_edges and (not rb.edges or rb.edges[-1] != out_edges[-1]):
            rb.add(out_edges)
        # To the point it pulls out to, then out of service round to the first stop.
        if out_at and out_at in m.at and rb.add(circuit[m.at[out_at][0] :]) is None:
            plan.problem = "its vehicles cannot reach the route from the depot"
            return plan
        ready_index = max(0, len(rb.edges) - 1)
        stops: list[PlannedStop] = []
        for t_i, dep in enumerate(trips):
            base = rb.add(circuit)
            if base is None:
                plan.problem = "its circuit is not closed on the streets" if t_i else "it cannot be reached"
                return plan
            for p_i in stops_order:
                ei, lane, pos = m.at[p_i]
                st = _stop(points, p_i, t_i, dep + (offs[p_i] if p_i < len(offs) else 0.0), lane, pos)
                st.first = p_i == 0
                stops.append(st)
        # Back at the first stop for the last time: passengers get off.
        _, lane, pos = m.end_at
        last = _stop(points, 0, len(trips) - 1, trips[-1] + cycle, lane, pos)
        last.kind = "last"
        stops.append(last)
        # On to the pull-in point (out of service), the pull-in run and the depot.
        if in_at and in_at in m.at:
            rb.add(circuit[: m.at[in_at][0] + 1])
        place_in = place_out
        if in_edges:
            rb.add(in_edges)
        if place_in is not None and rb.add([place_in.edge]) is None:
            plan.notes.append(f"vehicle {number + 1} cannot get back into its depot: it ends on the street")
            place_in = None
        # Leave the slot early enough to be at the first stop a few minutes before the first departure.
        dist = sum(float(net.edge(e).getLength()) for e in rb.edges[: ready_index + 1])
        drive = dist / 8.0 + (60.0 if place_out else 0.0)
        depart = max(0.0, trips[0] - READY_BEFORE_S - drive)
        if place_out is not None:
            depart_lane, depart_pos = place_out.lane, place_out.pos
        else:
            lane_obj = net.bus_lane(net.edge(rb.edges[0]))
            depart_lane = lane_obj.getID() if lane_obj is not None else f"{rb.edges[0]}_0"
            depart_pos = 0.0
        ends_in_slot = place_in is not None and rb.edges[-1] == place_in.edge
        plan.vehicles.append(
            TransitVehicle(
                id=f"L{index}v{number}",
                line=index,
                number=number,
                depart=depart,
                trips=list(trips),
                stops=stops,
                route=rb.edges,
                depart_lane=depart_lane,
                depart_pos=depart_pos,
                arrival_pos=place_in.pos if ends_in_slot and place_in is not None else None,
                slot_out=place_out.center if place_out else None,
                slot_in=place_in.center if ends_in_slot and place_in is not None else None,
                depot=place_out.depot if place_out else depot_id,
            )
        )
    return plan


#: Physical values of SUMO's ``Energy`` model for a battery or trolleybus: SUMO's documented example
#: values for a 12 m bus (sumo.dlr.de/docs/Models/Electric.html); mass, auxiliary power and battery size
#: come from the line's vehicle and the project's values.
BUS_ENERGY_PARAMS = {
    "frontSurfaceArea": 7.5,
    "airDragCoefficient": 0.7,
    "radialDragCoefficient": 0.1,
    "rollDragCoefficient": 0.01,
    "propulsionEfficiency": 0.9,
    "recuperationEfficiency": 0.6,
}

#: Lengths above which SUMO draws an articulated bus.
ARTICULATED_M = 15.0


def vtype(root: ET.Element, line: Mapping[str, Any]) -> str:
    """Add the line's vehicle type and return its id."""
    v = line["vehicle"]
    tid = f"line{int(line['index'])}"
    length = float(v.get("length_m", 12.0))
    energy = str(v.get("energy", "other"))
    attrs = {
        "id": tid,
        "vClass": "bus",
        "length": f"{length:.2f}",
        "width": f"{float(v.get('width_m', 2.55)):.2f}",
        "maxSpeed": f"{float(v.get('max_speed_kmh', 70.0)) / 3.6:.2f}",
        "accel": "1.0",
        "decel": "1.5",
        "minGap": "2.5",
        "guiShape": "bus/trolley"
        if energy == "trolleybus"
        else ("bus/flexible" if length > ARTICULATED_M else "bus"),
        "color": str(line.get("color", "#d2392c")),
        "speedDev": "0",
    }
    if energy in ("battery", "trolleybus"):
        attrs["emissionClass"] = "Energy/unknown"
        attrs["mass"] = f"{float(v.get('weight_t', 18.0)) * 1000:.0f}"
    t = ET.SubElement(root, "vType", attrs)
    if energy in ("battery", "trolleybus"):
        cap_wh = max(1.0, float(v.get("battery_kwh") or 0.0) * 1000.0)
        params = {
            "has.battery.device": "true",
            "device.battery.capacity": f"{cap_wh:.0f}",
            "device.battery.chargeLevel": f"{cap_wh:.0f}",
            "constantPowerIntake": f"{float(v.get('hvac_kw', 0.0)) * 1000:.0f}",
            **{k: str(x) for k, x in BUS_ENERGY_PARAMS.items()},
        }
        for k, val in params.items():
            ET.SubElement(t, "param", key=k, value=val)
    return tid


def write_transit(
    plans: Sequence[LinePlan], lines: Sequence[Mapping[str, Any]], net: RoadNet, path: str
) -> None:
    """Write the vehicle types and vehicles of all lines, with their routes and stops, to a routes file."""
    root = ET.Element("routes")
    types = {int(ln["index"]): vtype(root, ln) for ln in lines}
    lengths = {int(ln["index"]): float(ln["vehicle"].get("length_m", 12.0)) for ln in lines}
    dwell = {int(ln["index"]): float(ln["dwell_s"]) for ln in lines}
    vehicles = sorted((v for p in plans for v in p.vehicles), key=lambda v: (v.depart, v.id))
    for v in vehicles:
        attrs = {
            "id": v.id,
            "type": types[v.line],
            "depart": f"{v.depart:.1f}",
            "departLane": v.depart_lane.rsplit("_", 1)[-1],
            "departPos": f"{v.depart_pos:.2f}",
            "departSpeed": "0",
        }
        if v.arrival_pos is not None:
            attrs["arrivalPos"] = f"{v.arrival_pos:.2f}"
        el = ET.SubElement(root, "vehicle", attrs)
        ET.SubElement(el, "route", edges=" ".join(v.route))
        for s in v.stops:
            lane_len = float(net.net.getLane(s.lane).getLength())
            a, b = stop_range(s.pos, lane_len, lengths[v.line])
            st = {
                "lane": s.lane,
                "startPos": f"{a:.2f}",
                "endPos": f"{b:.2f}",
                "duration": f"{dwell[v.line]:.1f}",
                "friendlyPos": "true",
                "tripId": f"{v.line}:{s.trip}:{'end' if s.kind == 'last' else s.point}",
            }
            if s.first or s.kind == "end_stop":
                st["until"] = f"{s.planned_dep:.1f}"
            ET.SubElement(el, "stop", st)
    ET.ElementTree(root).write(path, encoding="utf-8", xml_declaration=True)


def write_wires(net: RoadNet, wired_ways: set[int], power_kw: float, path: str) -> int:
    """Write a charging station along every bus lane under a trolleybus wire (charging while driving).

    Returns:
        How many lanes are wired.
    """
    from mobsim_worker.jobs.road.osm import way_of_edge  # noqa: PLC0415

    root = ET.Element("additional")
    n = 0
    for e in net.net.getEdges():
        w = way_of_edge(e.getID())
        if w is None or w not in wired_ways:
            continue
        for lane in e.getLanes():
            if not lane.allows("bus"):
                continue
            ET.SubElement(
                root,
                "chargingStation",
                id=f"wire_{lane.getID()}",
                lane=lane.getID(),
                startPos="0",
                endPos=f"{lane.getLength():.2f}",
                power=f"{power_kw * 1000:.0f}",
                efficiency="0.95",
                chargeInTransit="1",
                chargeDelay="0",
            )
            n += 1
    ET.ElementTree(root).write(path, encoding="utf-8", xml_declaration=True)
    return n
