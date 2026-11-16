"""Street graphs and skims for car, walking and cycling (AequilibraE), and the zone connectors.

Every zone's centre joins the street network at its nearest junctions (``demand.connector.count``); stops join
the walk network at their nearest junction. Car links get a free-flow time (legal speed times
``demand.road.free_flow_share``) and a capacity (cars per hour per lane by road class, times the lanes tagged
in OpenStreetMap or the class default). Walking and cycling use perceived network distance at the project's
speeds: a metre in a pedestrian street counts ``demand.walk.pedestrian_factor``; a metre on a cycle track,
on a bike lane or on a main road without either counts ``demand.cycle.factor.*``.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from aequilibrae.paths import Graph, NetworkSkimming
from scipy.spatial import cKDTree

from mobsim_worker.demand.inputs import ROAD_CLASSES, Bundle, Floats

#: Seconds per minute and metres per km, for readability.
MIN = 60.0
#: A cost that stands for "no path" in skims.
UNREACHABLE = 1e9


class Projection:
    """Local equirectangular projection (metres) around the model area's centre; good to a few km."""

    def __init__(self, lonlat: Floats) -> None:
        """Centre the projection on the points' mean."""
        self.lon0 = float(np.mean(lonlat[:, 0]))
        self.lat0 = float(np.mean(lonlat[:, 1]))
        self.kx = 111_320.0 * np.cos(np.radians(self.lat0))
        self.ky = 110_574.0

    def xy(self, lonlat: Floats) -> Floats:
        """Degrees to metres."""
        out = np.empty_like(lonlat, dtype=np.float64)
        out[:, 0] = (lonlat[:, 0] - self.lon0) * self.kx
        out[:, 1] = (lonlat[:, 1] - self.lat0) * self.ky
        return out


@dataclass
class CarNetwork:
    """The directed car links (street link index and direction for each) and the graph's link table."""

    table: pd.DataFrame
    #: For each car link: index of the street link and 0 forward (a → b) or 1 backward.
    street_link: np.ndarray
    street_dir: np.ndarray
    zone_ids: np.ndarray  # node ids of the zone centroids (1..Z)


@dataclass
class ActiveNetwork:
    """Walking or cycling graph: undirected street links with length and perceived length, both directions."""

    table: pd.DataFrame
    zone_ids: np.ndarray
    stop_ids: np.ndarray  # node ids of the stops, after the zones


@dataclass
class ActiveSkims:
    """Walking and cycling skims.

    ``walk_min`` and ``cycle_min`` are zone-to-zone minutes of perceived distance; ``walk_dist`` is the walk
    in metres and ``cycle_dist`` the perceived ride in metres, each over zones then stops.
    """

    walk_min: Floats
    cycle_min: Floats
    walk_dist: Floats
    cycle_dist: Floats


def perceived_factor(bundle: Bundle, mode: str) -> Floats:
    """How much a metre of each street link counts for walking (``walk``) or cycling (``cycle``)."""
    s, v = bundle.streets, bundle.values
    f = np.ones(len(s.a))
    if mode == "walk":
        f[s.pedestrian] = v["demand.walk.pedestrian_factor"]
        return f
    busy = np.isin(s.road_class, [ROAD_CLASSES.index(c) for c in ("trunk", "primary", "secondary")])
    f[busy & (s.cycle_facility == 0)] = v["demand.cycle.factor.busy_road"]
    f[s.cycle_facility == 1] = v["demand.cycle.factor.lane"]
    f[s.cycle_facility == 2] = v["demand.cycle.factor.track"]
    return f


def nearest(points: Floats, candidates: Floats, k: int) -> tuple[np.ndarray, np.ndarray]:
    """The ``k`` nearest candidates of every point: (distances, indices), each shaped (P, k)."""
    k = max(1, min(k, len(candidates)))
    d, i = cKDTree(candidates).query(points, k=k)
    return np.asarray(d).reshape(len(points), k), np.asarray(i).reshape(len(points), k)


def _connectors(
    first_id: int,
    points: Floats,
    node_xy: Floats,
    usable: np.ndarray,
    k: int,
    node_offset: int,
) -> list[tuple[int, int, float]]:
    """Links from each point (ids from ``first_id``) to its ``k`` nearest usable nodes (point, node, m)."""
    idx = np.flatnonzero(usable)
    if not len(idx):
        return []
    d, j = nearest(points, node_xy[idx], k)
    out = []
    for p in range(len(points)):
        for col in range(d.shape[1]):
            out.append((first_id + p, node_offset + int(idx[j[p, col]]), max(float(d[p, col]), 1.0)))
    return out


def car_network(bundle: Bundle, proj: Projection) -> CarNetwork:
    """The car graph: one link per direction cars may use, plus zone connectors (both directions)."""
    s, v, z = bundle.streets, bundle.values, bundle.zones
    nz = len(z)
    node_xy = proj.xy(s.nodes)
    offset = nz + 1  # node ids: zones 1..Z, then street nodes
    cap = np.array([v[f"demand.road.capacity.{c}"] for c in ROAD_CLASSES])[s.road_class]
    lanes_default = np.array([v[f"demand.road.lanes.{c}"] for c in ROAD_CLASSES])[s.road_class]
    ff = np.maximum(s.speed_kmh * v["demand.road.free_flow_share"], 5.0)
    t_min = s.length_m / 1000.0 / ff * 60.0
    rows: list[tuple[int, int, float, float, float]] = []
    link_ref: list[int] = []
    link_dir: list[int] = []
    for d, (allowed, lanes, frm, to) in enumerate(
        ((s.car_fwd, s.lanes_fwd, s.a, s.b), (s.car_bwd, s.lanes_bwd, s.b, s.a))
    ):
        idx = np.flatnonzero(allowed)
        ln = np.where(lanes[idx] > 0, lanes[idx], lanes_default[idx])
        for i, lane in zip(idx, ln, strict=True):
            rows.append(
                (
                    int(frm[i]) + offset,
                    int(to[i]) + offset,
                    float(s.length_m[i]),
                    float(t_min[i]),
                    float(cap[i] * lane),
                )
            )
            link_ref.append(int(i))
            link_dir.append(d)
    used = np.zeros(len(s.nodes), dtype=bool)
    used[s.a[s.car_fwd | s.car_bwd]] = True
    used[s.b[s.car_fwd | s.car_bwd]] = True
    if not used.any():
        raise ValueError("no street in the model area is open to cars")
    # Connector speed: the fastest car street at the junction (free-flow), so a connector is never a shortcut.
    node_speed = np.zeros(len(s.nodes))
    car = s.car_fwd | s.car_bwd
    np.maximum.at(node_speed, s.a[car], ff[car])
    np.maximum.at(node_speed, s.b[car], ff[car])
    big = 1e6
    for zid, nid, dist in _connectors(
        1, proj.xy(z.lonlat), node_xy, used, int(v["demand.connector.count"]), offset
    ):
        speed = max(float(node_speed[nid - offset]), 5.0)
        t = dist / 1000.0 / speed * 60.0
        rows.append((zid, nid, dist, t, big))
        rows.append((nid, zid, dist, t, big))
        link_ref.append(-1)
        link_dir.append(0)
        link_ref.append(-1)
        link_dir.append(1)
    table = pd.DataFrame(rows, columns=["a_node", "b_node", "distance", "free_flow_time", "capacity"])
    table.insert(0, "link_id", np.arange(1, len(table) + 1))
    table.insert(3, "direction", 1)
    return CarNetwork(
        table=table,
        street_link=np.asarray(link_ref),
        street_dir=np.asarray(link_dir),
        zone_ids=np.arange(1, nz + 1),
    )


def active_network(bundle: Bundle, proj: Projection, mode: str) -> ActiveNetwork:
    """The walking (``walk``) or cycling (``cycle``) graph with zones and stops joined, both directions."""
    s, v, z = bundle.streets, bundle.values, bundle.zones
    nz = len(z)
    ns = len(bundle.transit.stop_ids)
    allowed = s.walk if mode == "walk" else s.cycle
    if not allowed.any():
        raise ValueError(
            f"no street in the model area is open to {'walking' if mode == 'walk' else 'cycling'}"
        )
    offset = nz + ns + 1
    node_xy = proj.xy(s.nodes)
    idx = np.flatnonzero(allowed)
    a = s.a[idx] + offset
    b = s.b[idx] + offset
    length = s.length_m[idx]
    felt = length * perceived_factor(bundle, mode)[idx]
    rows_a = [a, b]
    rows_b = [b, a]
    rows_l = [length, length]
    rows_p = [felt, felt]
    used = np.zeros(len(s.nodes), dtype=bool)
    used[s.a[idx]] = True
    used[s.b[idx]] = True
    con = _connectors(1, proj.xy(z.lonlat), node_xy, used, int(v["demand.connector.count"]), offset)
    if ns:
        con += _connectors(nz + 1, proj.xy(bundle.transit.stop_lonlat), node_xy, used, 1, offset)
    if con:
        ca = np.array([c[0] for c in con])
        cb = np.array([c[1] for c in con])
        cl = np.array([c[2] for c in con])
        rows_a += [ca, cb]
        rows_b += [cb, ca]
        rows_l += [cl, cl]
        rows_p += [cl, cl]
    table = pd.DataFrame(
        {
            "a_node": np.concatenate(rows_a).astype(np.int64),
            "b_node": np.concatenate(rows_b).astype(np.int64),
            "distance": np.concatenate(rows_l).astype(np.float64),
            "perceived": np.concatenate(rows_p).astype(np.float64),
        }
    )
    table.insert(0, "link_id", np.arange(1, len(table) + 1))
    table["direction"] = 1
    return ActiveNetwork(table=table, zone_ids=np.arange(1, nz + 1), stop_ids=np.arange(nz + 1, nz + ns + 1))


def graph(table: pd.DataFrame, centroids: np.ndarray, cost: str, skims: list[str], mode: str) -> Graph:
    """An AequilibraE graph over a link table, ready for skims and assignment."""
    g = Graph()
    g.mode = mode
    g.network = table.copy()
    g.prepare_graph(np.asarray(centroids, dtype=np.int64), remove_dead_ends=False)
    g.set_graph(cost)
    g.set_skimming(skims)
    g.set_blocked_centroid_flows(True)
    return g


def skim(g: Graph, names: list[str]) -> dict[str, Floats]:
    """Shortest-path skims between all centroids, by field; ``UNREACHABLE`` where there is no path."""
    ns = NetworkSkimming(g)
    ns.execute()
    m = ns.results.skims
    out = {}
    for n in names:
        a = np.array(m.get_matrix(n), dtype=np.float64)
        a[~np.isfinite(a) | (a > 1e15)] = UNREACHABLE
        out[n] = a
    return out


def with_intrazonal(m: Floats, share: float) -> Floats:
    """A copy whose diagonal is ``share`` times the nearest other zone (per row)."""
    out = m.copy()
    off = out.copy()
    np.fill_diagonal(off, np.inf)
    near = off.min(axis=1)
    near[~np.isfinite(near) | (near >= UNREACHABLE)] = 0.0
    np.fill_diagonal(out, share * near)
    return out


def walk_cycle_skims(bundle: Bundle, proj: Projection) -> ActiveSkims:
    """Walking and cycling skims over zones and stops, by the perceived shortest paths."""
    v = bundle.values
    nz = len(bundle.zones)
    walk_net = active_network(bundle, proj, "walk")
    cents = np.concatenate([walk_net.zone_ids, walk_net.stop_ids])
    fields = ["distance", "perceived"]
    w = skim(graph(walk_net.table, cents, "perceived", fields, "w"), fields)
    wp = w["perceived"][:nz, :nz]
    walk_min = np.where(wp >= UNREACHABLE, UNREACHABLE, wp / 1000.0 / v["demand.walk_speed_kmh"] * 60.0)
    cyc_net = active_network(bundle, proj, "cycle")
    cents = np.concatenate([cyc_net.zone_ids, cyc_net.stop_ids])
    cd = skim(graph(cyc_net.table, cents, "perceived", ["perceived"], "b"), ["perceived"])["perceived"]
    cz = cd[:nz, :nz]
    cyc_min = np.where(cz >= UNREACHABLE, UNREACHABLE, cz / 1000.0 / v["analysis.cycle_speed_kmh"] * 60.0)
    share = v["demand.intrazonal_share"]
    return ActiveSkims(
        walk_min=with_intrazonal(walk_min, share),
        cycle_min=with_intrazonal(cyc_min, share),
        walk_dist=w["distance"],
        cycle_dist=cd,
    )


def pedestrian_share(bundle: Bundle, proj: Projection) -> Floats:
    """Share of each zone's street length that is pedestrian; each link belongs to the nearest zone centre."""
    s, z = bundle.streets, bundle.zones
    out = np.zeros(len(z))
    if not s.pedestrian.any():
        return out
    xy = proj.xy(s.nodes)
    mid = (xy[s.a] + xy[s.b]) / 2.0
    _, near = nearest(mid, proj.xy(z.lonlat), 1)
    zone = near[:, 0]
    total = np.bincount(zone, weights=s.length_m, minlength=len(z))
    ped = np.bincount(zone, weights=np.where(s.pedestrian, s.length_m, 0.0), minlength=len(z))
    np.divide(ped, total, out=out, where=total > 0)
    return out


def nearest_m(points: Floats, candidates: Floats, proj: Projection) -> Floats:
    """Straight distance from each point (lon/lat) to the nearest candidate, m; infinite if there is none."""
    if not len(candidates) or not len(points):
        return np.full(len(points), np.inf)
    d, _ = nearest(proj.xy(points), proj.xy(candidates), 1)
    return d[:, 0]
