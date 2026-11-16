"""Road assignment: user equilibrium by bi-conjugate Frank-Wolfe with BPR volume-delay (AequilibraE)."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from aequilibrae.matrix import AequilibraeMatrix
from aequilibrae.paths import TrafficAssignment, TrafficClass

from mobsim_worker.demand.inputs import Floats, Values
from mobsim_worker.demand.network import UNREACHABLE, CarNetwork, graph, skim


@dataclass
class RoadResult:
    """Cars per hour and volume/capacity per car link, congested skims and how far the equilibrium got."""

    flow: Floats
    vc: Floats
    car_min: Floats
    car_km: Floats
    rgap: float
    iterations: int


def free_flow(net: CarNetwork) -> tuple[Floats, Floats]:
    """Free-flow car time (min) and distance (km) between zones."""
    g = graph(net.table, net.zone_ids, "free_flow_time", ["free_flow_time", "distance"], "c")
    s = skim(g, ["free_flow_time", "distance"])
    km = np.where(s["distance"] >= UNREACHABLE, UNREACHABLE, s["distance"] / 1000.0)
    return s["free_flow_time"], km


def assign(net: CarNetwork, cars_per_hour: Floats, v: Values) -> RoadResult:
    """Assign one hour of car trips between zones to the roads and skim the congested network."""
    n = len(net.zone_ids)
    g = graph(net.table, net.zone_ids, "free_flow_time", ["free_flow_time", "distance"], "c")
    m = AequilibraeMatrix()
    m.create_empty(zones=n, matrix_names=["cars"], memory_only=True)
    m.index[:] = net.zone_ids
    m.matrices[:, :, 0] = cars_per_hour
    m.computational_view(["cars"])
    tc = TrafficClass("cars", g, m)
    ta = TrafficAssignment()
    ta.set_classes([tc])
    ta.set_vdf("BPR")
    ta.set_vdf_parameters({"alpha": v["demand.road.bpr_alpha"], "beta": v["demand.road.bpr_beta"]})
    ta.set_capacity_field("capacity")
    ta.set_time_field("free_flow_time")
    ta.set_algorithm("bfw")
    ta.max_iter = int(v["demand.road.max_iterations"])
    ta.rgap_target = v["demand.road.relative_gap"]
    ta.set_cores(0)
    ta.execute()
    res = ta.results()
    flow = np.zeros(len(net.table))
    ids = net.table["link_id"].to_numpy()
    by_id = res["cars_ab"].reindex(ids).fillna(0.0).to_numpy() if "cars_ab" in res else flow
    flow[:] = by_id
    cap = net.table["capacity"].to_numpy()
    sk = tc.results.skims
    t = np.array(sk.get_matrix("free_flow_time"), dtype=np.float64)
    d = np.array(sk.get_matrix("distance"), dtype=np.float64)
    bad = ~np.isfinite(t) | (t > 1e15)
    t[bad] = UNREACHABLE
    d = np.where(bad, UNREACHABLE, d / 1000.0)
    report = ta.report()
    rgap = float(report["rgap"].iloc[-1]) if len(report) else float("nan")
    return RoadResult(
        flow=flow, vc=flow / np.maximum(cap, 1e-9), car_min=t, car_km=d, rgap=rgap, iterations=len(report)
    )
