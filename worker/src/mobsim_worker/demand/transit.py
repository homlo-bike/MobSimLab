"""Public transport skims and assignment: Spiess–Florian optimal strategies (AequilibraE hyperpaths).

The graph per period has, for every zone, an origin and a destination vertex; a vertex per stop; and two
vertices per stop of each pattern, arriving and departing. Walks join zones to stops (access and egress, up to
``demand.transit.access_factor`` times the mode's catchment) and nearby stops to each other
(``demand.transit.transfer_max_m``). Boarding links carry the pattern's frequency; Spiess–Florian waits ``1 /
Σ frequency`` at a stop, so a frequency of ``1 / (½ headway × wait weight)`` gives the perceived wait of half
a headway. Every boarding adds the change penalty; the first one is taken off again in mode choice. Link costs
are perceived seconds; the skims also give the real in-vehicle, walk and bicycle seconds, the fixed costs
(unlocking, parking, fares, steps) and the number of boardings.

Catchment effects: zones near a shared-bike station reach stops near another station by shared bike (walk to
the station, unlock, ride, fare), for everyone. People with a bicycle also ride their own to stops with a bike
parking nearby (bike and ride) in a second graph, ``with_bike``, which is the first graph with those links
added. Boarding at a stop recorded without step-free access costs ``demand.step_free.share`` times
``demand.step_free.penalty_min`` more.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from aequilibrae.paths.public_transport import HyperpathGenerating

from mobsim_worker.demand.inputs import Bundle, Floats
from mobsim_worker.demand.network import UNREACHABLE, ActiveSkims, Projection, nearest_m

INF_FREQ = 1e10


@dataclass
class TransitGraph:
    """The graph of one period and what each link is."""

    edges: pd.DataFrame
    n_zones: int
    n_vertices: int
    #: Rows of ``edges`` that are the base graph; the rest are bike-and-ride links (``with_bike`` graphs).
    n_base: int = -1


@dataclass
class TransitSkims:
    """Skims between zones (minutes, and boardings); ``available`` where a path with a vehicle exists."""

    perceived_min: Floats
    ivt_min: Floats
    walk_min: Floats
    wait_min: Floats
    boardings: Floats
    available: np.ndarray


@dataclass
class Access:
    """Where shared bikes and bike parkings are: straight distances to the nearest station or parking, m."""

    zone_station_m: Floats
    stop_station_m: Floats
    stop_parking_m: Floats
    #: Fare of a shared-bike ride as seconds of a non-work trip.
    shared_fare_s: float


def access(bundle: Bundle, proj: Projection, vot_other_per_min: float) -> Access:
    """Distances to the nearest shared-bike station and bike parking, and the shared-bike fare in seconds."""
    b, t = bundle.bikes, bundle.transit
    fare = bundle.values["demand.shared_bike.fare_usd"] * bundle.economy.ppp_per_usd
    return Access(
        zone_station_m=nearest_m(bundle.zones.lonlat, b.rental, proj),
        stop_station_m=nearest_m(t.stop_lonlat, b.rental, proj),
        stop_parking_m=nearest_m(t.stop_lonlat, b.parking, proj),
        shared_fare_s=fare / vot_other_per_min * 60.0 if vot_other_per_min > 0 else 0.0,
    )


COLUMNS = [
    "a_node",
    "b_node",
    "trav_time",
    "freq",
    "link_type",
    "ivt_s",
    "walk_s",
    "bike_s",
    "fixed_s",
    "line",
    "pattern",
    "pos",
]
Row = tuple[int, int, float, float, str, float, float, float, float, int, int, int]


def build_graph(bundle: Bundle, act: ActiveSkims, period: str, acc: Access | None = None) -> TransitGraph:
    """The Spiess–Florian graph of one period.

    Args:
        bundle: The run's input.
        act: Walking and cycling skims over zones then stops (``network.walk_cycle_skims``).
        period: ``am``, ``md``, ``pm`` or ``ev``.
        acc: Shared-bike stations near zones and stops; None for no shared bikes.
    """
    v, t = bundle.values, bundle.transit
    walk_dist = act.walk_dist
    nz, ns = len(bundle.zones), len(t.stop_ids)
    speed = v["demand.walk_speed_kmh"] / 3.6  # m/s
    w_walk, w_wait = v["demand.mode.walk_weight"], v["demand.mode.wait_weight"]
    penalty = v["demand.mode.transfer_penalty_min"] * 60.0
    steps = v["demand.step_free.share"] * v["demand.step_free.penalty_min"] * 60.0
    rows: list[Row] = []

    def add(
        a: int,
        b: int,
        tt: float,
        f: float,
        kind: str,
        ivt: float,
        walk: float,
        li: int = -1,
        pi: int = -1,
        pos: int = -1,
        fixed: float = 0.0,
    ) -> None:
        rows.append((a, b, tt, f, kind, ivt, walk, 0.0, fixed, li, pi, pos))

    def origin(z: int) -> int:
        return z

    def dest(z: int) -> int:
        return nz + z

    def stop(s: int) -> int:
        return 2 * nz + s

    nxt = 2 * nz + ns
    if ns:
        zs = walk_dist[:nz, nz:]
        reach = np.array([t.catchment_m.get(m, t.default_catchment_m) for m in t.stop_mode])
        reach = reach * v["demand.transit.access_factor"]
        for z, s in zip(*np.nonzero(zs <= reach[None, :]), strict=True):
            sec = float(zs[z, s]) / speed
            add(origin(int(z)), stop(int(s)), w_walk * sec, INF_FREQ, "access_connector", 0.0, sec)
        sz = walk_dist[nz:, :nz]
        for s, z in zip(*np.nonzero(sz <= reach[:, None]), strict=True):
            sec = float(sz[s, z]) / speed
            add(stop(int(s)), dest(int(z)), w_walk * sec, INF_FREQ, "egress_connector", 0.0, sec)
        ss = walk_dist[nz:, nz:]
        for a, b in zip(*np.nonzero(ss <= v["demand.transit.transfer_max_m"]), strict=True):
            if a != b:
                sec = float(ss[a, b]) / speed
                add(stop(int(a)), stop(int(b)), w_walk * sec, INF_FREQ, "outer_transfer", 0.0, sec)
    for li, line in enumerate(t.lines):
        for pi, pat in enumerate(line.patterns):
            hw = pat.headway_s.get(period)
            if hw is None:
                continue
            freq = 1.0 / (0.5 * hw * w_wait)
            # Two vertices per stop of the pattern: arriving (alight from) and departing (board onto), so a
            # rider cannot board and alight at one stop without riding.
            first = nxt
            nxt += 2 * len(pat.stops)

            def dep(k: int, first: int = first) -> int:
                return first + 2 * k

            def arr(k: int, first: int = first) -> int:
                return first + 2 * k + 1

            n = len(pat.stops)
            for k, s in enumerate(pat.stops):
                if k < n - 1:
                    extra = steps if t.stop_step_free[s] is False else 0.0
                    add(stop(s), dep(k), penalty + extra, freq, "boarding", 0.0, 0.0, li, pi, k, extra)
                    run = pat.run_s[k]
                    add(dep(k), arr(k + 1), run, INF_FREQ, "on-board", run, 0.0, li, pi, k)
                if 0 < k < n - 1:
                    add(arr(k), dep(k), 0.0, INF_FREQ, "dwell", 0.0, 0.0, li, pi, k)
                if k > 0:
                    add(arr(k), stop(s), 0.0, INF_FREQ, "alighting", 0.0, 0.0, li, pi, k)
    edges = pd.DataFrame(rows, columns=COLUMNS)
    shared = _shared_bike(bundle, act, acc) if acc is not None and ns else None
    if shared is not None:
        edges, nxt = _via_vehicle(edges, shared, nz, nxt)
    return TransitGraph(edges=edges, n_zones=nz, n_vertices=nxt, n_base=len(edges))


def _via_vehicle(edges: pd.DataFrame, bike: pd.DataFrame, nz: int, nxt: int) -> tuple[pd.DataFrame, int]:
    """Add bicycle links so that they lead only to a vehicle: an access link ends at a vertex of its own per
    stop, from which only that stop's boardings go on; an egress link starts at one only alightings reach.
    Otherwise a ride to a stop and a walk from it would count as public transport without any vehicle.

    Returns:
        The edges with the bicycle links and the copied boardings and alightings, and the next free vertex.
    """  # noqa: D205
    out = [edges]
    bike = bike.copy()
    for kind, end, col, link in (
        ("access", "b_node", "a_node", "boarding"),
        ("egress", "a_node", "b_node", "alighting"),
    ):
        mine = bike["link_type"].str.endswith(kind)
        if not mine.any():
            continue
        stops = np.unique(bike.loc[mine, end].to_numpy())
        new = {int(v): nxt + i for i, v in enumerate(stops)}
        nxt += len(stops)
        bike.loc[mine, end] = bike.loc[mine, end].map(new).to_numpy()
        copy = edges[(edges["link_type"] == link) & edges[col].isin(new.keys())].copy()
        copy[col] = copy[col].map(new).to_numpy()
        out.append(copy)
    out.append(bike)
    del nz
    return pd.concat(out, ignore_index=True), nxt


def _shared_bike(bundle: Bundle, act: ActiveSkims, acc: Access) -> pd.DataFrame | None:
    """Shared-bike links from zones to stops and from stops to zones; None where no station is in reach."""
    v = bundle.values
    nz = len(bundle.zones)
    near = v["demand.shared_bike.station_max_m"]
    zs = np.flatnonzero(acc.zone_station_m <= near)
    ss = np.flatnonzero(acc.stop_station_m <= near)
    if not len(zs) or not len(ss):
        return None
    speed = v["demand.walk_speed_kmh"] / 3.6
    bike_speed = v["analysis.cycle_speed_kmh"] / 3.6
    w_walk, w_bike = v["demand.mode.walk_weight"], v["demand.mode.cycle_mode_weight"]
    fixed = v["demand.shared_bike.unlock_min"] * 60.0 + acc.shared_fare_s
    longest = v["demand.shared_bike.max_m"]
    parts = []
    for there, ride in (
        (True, act.cycle_dist[np.ix_(zs, nz + ss)]),
        (False, act.cycle_dist[np.ix_(nz + ss, zs)].T),
    ):
        zi, si = np.nonzero((ride > 0) & (ride <= longest))
        if not len(zi):
            continue
        z, st = zs[zi], ss[si]
        walk = (acc.zone_station_m[z] + acc.stop_station_m[st]) / speed
        bike = ride[zi, si] / bike_speed
        zone_v = z if there else nz + z
        stop_v = 2 * nz + st
        parts.append(
            pd.DataFrame(
                {
                    "a_node": (zone_v if there else stop_v).astype(np.int64),
                    "b_node": (stop_v if there else zone_v).astype(np.int64),
                    "trav_time": w_walk * walk + w_bike * bike + fixed,
                    "freq": INF_FREQ,
                    "link_type": "shared_bike_access" if there else "shared_bike_egress",
                    "ivt_s": 0.0,
                    "walk_s": walk,
                    "bike_s": bike,
                    "fixed_s": fixed,
                    "line": -1,
                    "pattern": -1,
                    "pos": -1,
                }
            )
        )
    return pd.concat(parts, ignore_index=True) if parts else None


def with_bike(bundle: Bundle, g: TransitGraph, act: ActiveSkims, acc: Access) -> TransitGraph | None:
    """The graph for people with a bicycle: ``g`` with bike-and-ride links from zones to stops with a bike
    parking; None when no stop has one in reach.
    """  # noqa: D205
    v = bundle.values
    nz = g.n_zones
    stops = np.flatnonzero(acc.stop_parking_m <= v["demand.bike_ride.parking_max_m"])
    if not len(stops):
        return None
    bike_speed = v["analysis.cycle_speed_kmh"] / 3.6
    w_bike = v["demand.mode.cycle_mode_weight"]
    park = v["demand.bike_ride.parking_min"] * 60.0
    ride = act.cycle_dist[:nz, nz + stops]
    zi, si = np.nonzero((ride > 0) & (ride <= v["demand.bike_ride.max_m"]))
    if not len(zi):
        return None
    bike = ride[zi, si] / bike_speed
    extra = pd.DataFrame(
        {
            "a_node": zi.astype(np.int64),
            "b_node": (2 * nz + stops[si]).astype(np.int64),
            "trav_time": w_bike * bike + park,
            "freq": INF_FREQ,
            "link_type": "bike_ride_access",
            "ivt_s": 0.0,
            "walk_s": 0.0,
            "bike_s": bike,
            "fixed_s": park,
            "line": -1,
            "pattern": -1,
            "pos": -1,
        }
    )
    base = g.edges.iloc[: g.n_base] if g.n_base >= 0 else g.edges
    edges, nxt = _via_vehicle(base, extra, nz, g.n_vertices)
    return TransitGraph(edges=edges, n_zones=nz, n_vertices=nxt, n_base=len(base))


def _hyperpath(g: TransitGraph, skim: bool) -> HyperpathGenerating:
    nz = g.n_zones
    # Every vertex must exist in the edge table for the CSC index; a lone zone gets a self-loop of no use.
    edges = g.edges
    present = np.zeros(g.n_vertices, dtype=bool)
    present[edges["a_node"].to_numpy()] = True
    present[edges["b_node"].to_numpy()] = True
    missing = np.flatnonzero(~present)
    if len(missing):
        pad = pd.DataFrame(
            {
                "a_node": missing,
                "b_node": missing,
                "trav_time": UNREACHABLE,
                "freq": INF_FREQ,
                "link_type": "pad",
                "ivt_s": 0.0,
                "walk_s": 0.0,
                "bike_s": 0.0,
                "fixed_s": 0.0,
                "line": -1,
                "pattern": -1,
                "pos": -1,
            }
        )
        edges = pd.concat([edges, pad], ignore_index=True)
    return HyperpathGenerating(
        edges,
        tail="a_node",
        head="b_node",
        trav_time="trav_time",
        freq="freq",
        skim_cols=["trav_time", "ivt_s", "walk_s", "bike_s", "fixed_s", "boardings"] if skim else None,
        o_vert_ids=np.arange(nz, dtype=np.int64),
        d_vert_ids=np.arange(nz, 2 * nz, dtype=np.int64),
        nodes_to_indices=np.arange(g.n_vertices, dtype=np.int64),
    )


def skims(bundle: Bundle, g: TransitGraph) -> TransitSkims:
    """Zone-to-zone skims of one period's graph."""
    v = bundle.values
    nz = g.n_zones
    none = np.zeros((nz, nz), dtype=bool)
    if not (g.edges["link_type"] == "boarding").any():
        z = np.zeros((nz, nz))
        return TransitSkims(z, z, z, z, z, none)
    h = _hyperpath(g, skim=True)
    empty = np.array([], dtype=np.uint32)
    h.assign(empty, empty, np.array([], dtype=np.float64))
    m = h.skim_matrix
    get = {n: np.array(m.get_matrix(n), dtype=np.float64) for n in m.names}
    tt, ivt, walk, board = get["trav_time"], get["ivt_s"], get["walk_s"], get["boardings"]
    bike, fixed = get["bike_s"], get["fixed_s"]
    available = (board >= 1) & (tt > 0) & (tt < UNREACHABLE)
    penalty = v["demand.mode.transfer_penalty_min"] * 60.0
    known = ivt + v["demand.mode.walk_weight"] * walk + v["demand.mode.cycle_mode_weight"] * bike + fixed
    wait = (tt - known - penalty * board) / v["demand.mode.wait_weight"]
    wait = np.maximum(wait, 0.0)
    return TransitSkims(
        perceived_min=np.where(available, tt / 60.0, UNREACHABLE),
        ivt_min=ivt / 60.0,
        walk_min=walk / 60.0,
        wait_min=wait / 60.0,
        boardings=board,
        available=available,
    )


def assign(g: TransitGraph, od: Floats) -> pd.DataFrame:
    """Load a zone-to-zone matrix of riders onto the graph; the edge table with a ``volume`` column."""
    out = g.edges.copy()
    out["volume"] = 0.0
    o, d = np.nonzero(od > 0)
    if not len(o) or not (g.edges["link_type"] == "boarding").any():
        return out
    h = _hyperpath(g, skim=False)
    h.assign(
        o.astype(np.uint32),
        (d + g.n_zones).astype(np.uint32),
        od[o, d].astype(np.float64),
    )
    out["volume"] = h._edges["volume"].to_numpy()[: len(out)]
    return out
