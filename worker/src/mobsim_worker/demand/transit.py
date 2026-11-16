"""Public transport skims and assignment: Spiess–Florian optimal strategies (AequilibraE hyperpaths).

The graph per period has, for every zone, an origin and a destination vertex; a vertex per stop; and a vertex
per stop of each pattern. Walks join zones to stops (access and egress, up to ``demand.transit.access_factor``
times the mode's catchment) and nearby stops to each other (``demand.transit.transfer_max_m``). Boarding links
carry the pattern's frequency; Spiess–Florian waits ``1 / Σ frequency`` at a stop, so a frequency of ``1 / (½
headway × wait weight)`` gives the perceived wait of half a headway. Every boarding adds the change penalty;
the first one is taken off again in mode choice. Link costs are perceived seconds; the skims also give the
real in-vehicle and walk seconds and the number of boardings.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from aequilibrae.paths.public_transport import HyperpathGenerating

from mobsim_worker.demand.inputs import Bundle, Floats
from mobsim_worker.demand.network import UNREACHABLE

INF_FREQ = 1e10


@dataclass
class TransitGraph:
    """The graph of one period and what each link is."""

    edges: pd.DataFrame
    n_zones: int
    n_vertices: int


@dataclass
class TransitSkims:
    """Skims between zones (minutes, and boardings); ``available`` where a path with a vehicle exists."""

    perceived_min: Floats
    ivt_min: Floats
    walk_min: Floats
    wait_min: Floats
    boardings: Floats
    available: np.ndarray


def build_graph(bundle: Bundle, walk_dist: Floats, period: str) -> TransitGraph:
    """The Spiess–Florian graph of one period.

    Args:
        bundle: The run's input.
        walk_dist: Walking distance in metres over zones then stops (``network.walk_cycle_skims``).
        period: ``am``, ``md``, ``pm`` or ``ev``.
    """
    v, t = bundle.values, bundle.transit
    nz, ns = len(bundle.zones), len(t.stop_ids)
    speed = v["demand.walk_speed_kmh"] / 3.6  # m/s
    w_walk, w_wait = v["demand.mode.walk_weight"], v["demand.mode.wait_weight"]
    penalty = v["demand.mode.transfer_penalty_min"] * 60.0
    rows: list[tuple[int, int, float, float, str, float, float, int, int, int]] = []

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
    ) -> None:
        rows.append((a, b, tt, f, kind, ivt, walk, li, pi, pos))

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
            first = nxt
            nxt += len(pat.stops)
            for k, s in enumerate(pat.stops):
                if k < len(pat.stops) - 1:
                    add(stop(s), first + k, penalty, freq, "boarding", 0.0, 0.0, li, pi, k)
                    run = pat.run_s[k]
                    add(first + k, first + k + 1, run, INF_FREQ, "on-board", run, 0.0, li, pi, k)
                if k > 0:
                    add(first + k, stop(s), 0.0, INF_FREQ, "alighting", 0.0, 0.0, li, pi, k)
    edges = pd.DataFrame(
        rows,
        columns=[
            "a_node",
            "b_node",
            "trav_time",
            "freq",
            "link_type",
            "ivt_s",
            "walk_s",
            "line",
            "pattern",
            "pos",
        ],
    )
    return TransitGraph(edges=edges, n_zones=nz, n_vertices=nxt)


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
        skim_cols=["trav_time", "ivt_s", "walk_s", "boardings"] if skim else None,
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
    available = (board >= 1) & (tt > 0) & (tt < UNREACHABLE)
    penalty = v["demand.mode.transfer_penalty_min"] * 60.0
    wait = (tt - ivt - v["demand.mode.walk_weight"] * walk - penalty * board) / v["demand.mode.wait_weight"]
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
