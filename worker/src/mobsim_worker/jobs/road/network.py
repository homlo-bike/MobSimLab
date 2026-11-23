"""The SUMO network of a road run: netconvert, and matching drawn routes and points to its edges.

``netconvert`` reads the merged OSM file (``osm.py``) with SUMO's OSM type map: lanes, speeds, turn
restrictions, bus lanes (``--osm.lane-access``) and traffic signals from OSM (``highway=traffic_signals``,
grouped at junctions). Junctions close together are joined, as on real city maps.

The street line tool routes over the same OSM ways, so its routes are matched to the SUMO edges with
``sumolib.route.mapTrace`` (dense points, buses only), and gaps are closed with the shortest bus path. The
street line tool's router does not know every turn netconvert builds (turn lanes, joined junctions, no
U-turns), so ``mapTrace`` can return two edges in a row with no link for a bus between them; ``match`` closes
such a break with the shortest bus path, or names it (``NoBusLink``) when there is none.
"""

from __future__ import annotations

import math
import os
import subprocess  # noqa: S404 (runs SUMO's own netconvert with fixed arguments)
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

#: Spacing of the points a drawn route is cut into before matching, m.
DENSIFY_M = 12.0

#: Search radius when matching a route or a point to edges, m.
MATCH_M = 30.0

LonLat = tuple[float, float]


def sumo_home() -> str:
    """Return SUMO's installation folder (the ``eclipse-sumo`` wheel)."""
    import sumo  # noqa: PLC0415 (only in the worker image and local builds with the ``sim`` extra)

    home: str = sumo.SUMO_HOME
    return home


def sumo_binary(name: str) -> str:
    """Return the path of a SUMO program (``netconvert``, ``duarouter``, ``sumo``)."""
    return os.path.join(sumo_home(), "bin", name)


def sumo_tool(name: str) -> str:
    """Return the path of a SUMO Python tool (``randomTrips.py``, ``routeSampler.py``)."""
    return os.path.join(sumo_home(), "tools", name)


def tool_env() -> dict[str, str]:
    """Environment for SUMO programs and tools: ``SUMO_HOME`` and PROJ's data from the wheel."""
    home = sumo_home()
    return {**os.environ, "SUMO_HOME": home, "PROJ_DATA": os.path.join(home, "data", "proj")}


def run_tool(args: Sequence[str], cwd: str, timeout_s: float = 1800.0) -> str:
    """Run a SUMO program and return its output.

    Raises:
        RuntimeError: The program failed; the message has the end of its output.
    """
    p = subprocess.run(  # noqa: S603 (fixed program paths, no shell)
        list(args), cwd=cwd, env=tool_env(), capture_output=True, text=True, timeout=timeout_s, check=False
    )
    if p.returncode != 0:
        tail = (p.stderr or p.stdout).strip().splitlines()[-6:]
        raise RuntimeError(f"{os.path.basename(args[0])} failed: " + " ".join(tail))
    return p.stdout + p.stderr


def netconvert(
    osm_file: str, net_file: str, cwd: str, left_hand: bool, keep: Sequence[str] = ()
) -> list[str]:
    """Build the SUMO network from the OSM file.

    Args:
        osm_file: The merged OSM file.
        net_file: Where to write the network.
        cwd: Working folder.
        left_hand: Traffic drives on the left.
        keep: Edges that must not be merged with their neighbours (the depots' lanes and drives).

    Returns:
        netconvert's warnings (the first few, for the run's notes).
    """
    args = [
        sumo_binary("netconvert"),
        "--osm-files",
        osm_file,
        "-o",
        net_file,
        "--osm.lane-access",
        "--osm.turn-lanes",
        "--geometry.remove",
        "--geometry.remove.keep-ptstops",
        "--roundabouts.guess",
        "--ramps.guess",
        "--junctions.join",
        "--tls.guess-signals",
        "--tls.join",
        "--tls.default-type",
        "actuated",
        "--keep-edges.by-vclass",
        "bus,passenger",
        "--remove-edges.isolated",
        "--output.street-names",
        "--output.original-names",
        "--no-turnarounds.except-deadend",
        "--seed",
        "1",
    ]
    if left_hand:
        args.append("--lefthand")
    if keep:
        keep_file = os.path.join(cwd, "keep.txt")
        with open(keep_file, "w", encoding="utf-8") as f:
            f.write("\n".join(keep))
        args += ["--geometry.remove.keep-edges.input-file", keep_file]
    out = run_tool(args, cwd)
    return [ln for ln in out.splitlines() if ln.startswith("Warning")][:20]


def densify(coords: Sequence[LonLat], step_m: float = DENSIFY_M) -> list[LonLat]:
    """Return the polyline with extra points so that none are more than ``step_m`` apart."""
    out: list[LonLat] = []
    for a, b in zip(coords, coords[1:], strict=False):
        k = 111_320.0
        d = math.hypot((b[0] - a[0]) * k * math.cos(math.radians(a[1])), (b[1] - a[1]) * k)
        n = max(1, int(d // step_m))
        out.extend((a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n) for i in range(n))
    if coords:
        out.append(coords[-1])
    return out


class NoBusLink(Exception):
    """A matched route has no way for a bus from one edge onto the next, not even round a detour."""

    def __init__(self, from_edge: str, to_edge: str, from_street: str, to_street: str, at: LonLat) -> None:
        """Keep both edges, their street names and where the first one ends."""
        super().__init__(f"no way for a bus from {from_street} onto {to_street}")
        self.from_edge = from_edge
        self.to_edge = to_edge
        self.from_street = from_street
        self.to_street = to_street
        self.at = at


@dataclass
class Placed:
    """A point placed on a route: the index of the edge in the route, the lane and the position on it."""

    index: int
    lane: str
    pos: float
    dist: float


class RoadNet:
    """The SUMO network, read with sumolib, and the helpers that place routes and points on it."""

    def __init__(self, net_file: str) -> None:
        """Read the network (with internal lanes off; shapes in metres)."""
        import sumolib  # noqa: PLC0415

        self.net: Any = sumolib.net.readNet(net_file, withInternal=False)
        self._sumolib = sumolib

    def xy(self, p: LonLat) -> tuple[float, float]:
        """Return network coordinates of a point."""
        x, y = self.net.convertLonLat2XY(p[0], p[1])
        return float(x), float(y)

    def lonlat(self, x: float, y: float) -> LonLat:
        """Return ``[lon, lat]`` of network coordinates."""
        lon, lat = self.net.convertXY2LonLat(x, y)
        return float(lon), float(lat)

    def edge(self, edge_id: str) -> Any:
        """Return an edge by id."""
        return self.net.getEdge(edge_id)

    def has_edge(self, edge_id: str) -> bool:
        """Whether the network has an edge."""
        return bool(self.net.hasEdge(edge_id))

    def bus_lane(self, edge: Any) -> Any | None:
        """Return the kerb-most lane of an edge a bus may use, or None."""
        for lane in edge.getLanes():
            if lane.allows("bus"):
                return lane
        return None

    def match(self, coords: Sequence[LonLat]) -> list[str]:
        """Match a drawn route to bus edges, in order; empty when it cannot be matched.

        Raises:
            NoBusLink: Two edges of the match follow each other with no bus path between them.
        """
        trace = [self.xy(p) for p in densify(coords)]
        if len(trace) < 2:
            return []
        edges = self._sumolib.route.mapTrace(
            trace, self.net, MATCH_M, fillGaps=2000, gapPenalty=5000, vClass="bus", direction=True
        )
        return self.connect([e.getID() for e in edges])

    def connect(self, edges: Sequence[str]) -> list[str]:
        """Return the edges with every break between two of them closed by the shortest bus path.

        ``mapTrace`` jumps from one edge to the next when no bus path between them is shorter than its gap
        limit (a turn netconvert does not allow, such as a U-turn or a banned turn), and SUMO refuses such a
        route ("no connection between edge … and edge …").

        Raises:
            NoBusLink: There is no bus path at all between two edges that follow each other.
        """
        out: list[str] = []
        for e in edges:
            if not out or out[-1] == e or self.follows(out[-1], e):
                if not out or out[-1] != e:
                    out.append(e)
                continue
            gap = self.path(out[-1], e)
            if gap is None:
                a, b = self.edge(out[-1]), self.edge(e)
                x, y = a.getToNode().getCoord()
                raise NoBusLink(out[-1], e, self.street(a), self.street(b), self.lonlat(x, y))
            out.extend(gap[1:])
        return out

    def street(self, edge: Any) -> str:
        """Name an edge for a planner: its street name, or the OSM way it comes from."""
        name = str(edge.getName() or "").strip()
        if name:
            return name
        way = edge.getID().lstrip("-").split("#")[0]
        return f"an unnamed street (OSM way {way})"

    def path(self, a: str, b: str) -> list[str] | None:
        """Return the shortest bus path from edge ``a`` to edge ``b`` (both included), or None."""
        if a == b:
            return [a]
        route, _ = self.net.getShortestPath(self.edge(a), self.edge(b), vClass="bus")
        return [e.getID() for e in route] if route else None

    def follows(self, a: str, b: str) -> bool:
        """Whether a bus may drive from the end of edge ``a`` straight onto edge ``b``."""
        ea = self.edge(a)
        return any(e.getID() == b for e in ea.getAllowedOutgoing("bus"))

    def join(self, route: list[str], piece: Sequence[str]) -> bool:
        """Append ``piece`` to ``route``, closing a gap with the shortest bus path; False if impossible."""
        if not piece:
            return True
        if not route:
            route.extend(piece)
            return True
        first = piece[0]
        if route[-1] == first:
            route.extend(piece[1:])
            return True
        if self.follows(route[-1], first):
            route.extend(piece)
            return True
        gap = self.path(route[-1], first)
        if gap is None:
            return False
        route.extend(gap[1:])
        route.extend(piece[1:])
        return True

    def place(self, route: Sequence[str], p: LonLat, start: int, look_ahead: int = 60) -> Placed | None:
        """Place a point on the route at or after edge index ``start``: the first edge that passes close by.

        Returns:
            Where it is, or None when no edge of the route passes within ``MATCH_M``.
        """
        x, y = self.xy(p)
        best: Placed | None = None
        for i in range(start, min(len(route), start + look_ahead)):
            lane = self.bus_lane(self.edge(route[i]))
            if lane is None:
                continue
            pos, dist = lane.getClosestLanePosAndDist((x, y))
            if dist <= MATCH_M and (best is None or dist < best.dist - 5.0):
                best = Placed(i, lane.getID(), float(pos), float(dist))
                if dist < 8.0:
                    break
            elif best is not None and dist > MATCH_M:
                break
        return best

    def lane_pos(self, edge_id: str, p: LonLat) -> tuple[str, float] | None:
        """Return the bus lane of an edge and the position on it nearest to a point."""
        lane = self.bus_lane(self.edge(edge_id))
        if lane is None:
            return None
        pos, _ = lane.getClosestLanePosAndDist(self.xy(p))
        return lane.getID(), float(pos)
