"""The road simulation run on the background worker (07-simulation §3, Phase 5).

Steps, each reported as progress and each a point where a cancelled run stops:

1. **Network.** Merge the street tiles, apply the planner's street setup, add the depots, ``netconvert``.
2. **Background traffic.** Cars from the traffic peaks per street (``traffic.py``).
3. **Service.** Each street line's vehicles from depot slot to depot slot (``service.py``), with battery and
   trolleybus energy (trolleybus wires charge while driving).
4. **Run.** SUMO through libsumo (``sim.py``), with a replay of the street line vehicles.
5. **Results.** Per line: punctuality, delays, bunching, circuit times and speed, time lost in traffic and at
   signals, energy; for the run: events (gridlock, out of charge, not back in the depot) and teleports (0).

Same inputs, seed and SUMO version give the same result (NFR-ACC-02): every random choice is seeded.
"""

from __future__ import annotations

import math
import os
import tempfile
from collections.abc import Mapping
from typing import Any, Literal, Protocol

from mobsim_worker.jobs.road import osm, service, sim, traffic
from mobsim_worker.jobs.road.network import RoadNet, netconvert

Outcome = Literal["done", "stopped"]

#: Room around the lines and depots kept in the network (background traffic needs streets to come from), m.
MARGIN_M = 600.0

#: A stop departure later than this is late, s (the system test's ``recording.late_threshold_s``).
LATE_S = 120.0

#: Simulated time allowed after the last planned arrival for vehicles to get back to their depot, s.
RETURN_S = 3600.0


class Reporter(Protocol):
    """Where the run reports to (the run's row) and learns that it should stop."""

    def report(self, step: dict[str, Any], result: dict[str, Any]) -> None:
        """Save what the run is doing now and what it has found so far."""
        ...

    def should_stop(self) -> bool:
        """Whether to stop before the next step."""
        ...


def _bbox(scenario: Mapping[str, Any]) -> tuple[float, float, float, float]:
    pts: list[tuple[float, float]] = []
    for ln in scenario.get("lines", []):
        for leg in ln.get("legs", []):
            pts.extend((float(c[0]), float(c[1])) for c in leg.get("coords", []))
        for k in ("pull_out", "pull_in"):
            if ln.get(k):
                pts.extend((float(c[0]), float(c[1])) for c in ln[k].get("coords", []))
    for d in scenario.get("depots", []):
        for n in d.get("network", {}).get("nodes", []):
            pts.append((float(n["lonlat"][0]), float(n["lonlat"][1])))
    if not pts:
        raise ValueError("the scenario has no street lines with a route")
    lat = sum(p[1] for p in pts) / len(pts)
    dlat = MARGIN_M / 111_320.0
    dlon = MARGIN_M / (111_320.0 * max(0.1, math.cos(math.radians(lat))))
    return (
        min(p[0] for p in pts) - dlon,
        min(p[1] for p in pts) - dlat,
        max(p[0] for p in pts) + dlon,
        max(p[1] for p in pts) + dlat,
    )


def _pct(xs: list[float], q: float) -> float:
    if not xs:
        return 0.0
    s = sorted(xs)
    return s[min(len(s) - 1, int(len(s) * q))]


def line_results(
    plan: service.LinePlan,
    line: Mapping[str, Any],
    stops: list[dict[str, str]],
    outcome: sim.SimOutcome,
    from_s: float,
    to_s: float,
) -> dict[str, Any]:
    """Measure one line: from the plan, SUMO's stop output and what the loop watched."""
    r: dict[str, Any] = {
        "index": plan.index,
        "name": plan.name,
        "mode": plan.mode,
        "color": plan.color,
        "energy": plan.energy,
        "problem": plan.problem,
        "notes": plan.notes,
        "vehicles": len(plan.vehicles),
        "cycle_s": plan.cycle_s,
        "circuit_m": plan.circuit_m,
    }
    if plan.problem:
        return r
    planned: dict[tuple[str, str], service.PlannedStop] = {}
    for v in plan.vehicles:
        for s in v.stops:
            key = f"{v.line}:{s.trip}:{'end' if s.kind == 'last' else s.point}"
            planned[(v.id, key)] = s
    deps: dict[int, list[tuple[float, float]]] = {}
    delays: list[float] = []
    starts: dict[tuple[str, int], float] = {}
    backs: dict[tuple[str, int], float] = {}
    for st in stops:
        vid = st.get("id", "")
        p = planned.get((vid, st.get("tripId", "")))
        if p is None:
            continue
        started = float(st.get("started", "nan"))
        ended = float(st.get("ended", "nan"))
        if p.kind == "last":
            backs[(vid, p.trip)] = started
            continue
        if p.first:
            starts[(vid, p.trip)] = ended
            if p.trip > 0:
                backs[(vid, p.trip - 1)] = started
        if from_s <= p.planned_dep < to_s and math.isfinite(ended):
            delays.append(ended - p.planned_dep)
            deps.setdefault(p.point, []).append((ended, p.planned_dep))
    gaps = bunched = 0
    for xs in deps.values():
        xs.sort()
        for (a, pa), (b, pb) in zip(xs, xs[1:], strict=False):
            gaps += 1
            if b - a < 0.5 * abs(pb - pa):
                bunched += 1
    cycles = [backs[k] - starts[k] for k in starts if k in backs and backs[k] > starts[k]]
    dwell = float(line["dwell_s"])
    run_cycle = sum(cycles) / len(cycles) if cycles else 0.0
    trips = sum(1 for v in plan.vehicles for d in v.trips if from_s <= d < to_s)
    trips_run = len(cycles)
    ws = [outcome.watches[v.id] for v in plan.vehicles]
    lost_traffic = sum(w.lost_traffic_s for w in ws)
    lost_signals = sum(w.lost_signals_s for w in ws)
    all_trips = sum(len(v.trips) for v in plan.vehicles)
    r.update(
        {
            "trips": trips,
            "trips_run": trips_run,
            "planned_run_s": plan.cycle_s - dwell,
            "run_cycle_s": run_cycle,
            "speed_kmh": (plan.circuit_m / run_cycle * 3.6) if run_cycle > 0 else 0.0,
            "punctuality": (sum(1 for d in delays if d <= LATE_S) / len(delays)) if delays else 1.0,
            "mean_delay_s": max(0.0, sum(delays) / len(delays)) if delays else 0.0,
            "p95_delay_s": max(0.0, _pct(delays, 0.95)),
            "bunched_share": bunched / gaps if gaps else 0.0,
            "lost_traffic_s": lost_traffic / all_trips if all_trips else 0.0,
            "lost_signals_s": lost_signals / all_trips if all_trips else 0.0,
            "back_in_depot": sum(
                1 for v, w in zip(plan.vehicles, ws, strict=True) if w.arrived and v.slot_in
            ),
        }
    )
    if plan.energy in ("battery", "trolleybus"):
        used = sum(w.consumed_wh - w.regenerated_wh for w in ws) / 1000.0
        km = sum(w.distance_m for w in ws) / 1000.0
        caps = [w.capacity_wh for w in ws if w.capacity_wh > 0]
        socs = [
            (w.min_charge_wh or 0.0) / w.capacity_wh
            for w in ws
            if w.capacity_wh > 0 and w.min_charge_wh is not None
        ]
        r["energy_use"] = {
            "kwh": used,
            "km": km,
            "kwh_per_km": used / km if km > 0 else 0.0,
            "battery_kwh": (caps[0] / 1000.0) if caps else 0.0,
            "min_charge_share": min(socs) if socs else None,
            "ran_out": sum(1 for w in ws if w.energy_out),
        }
    return r


def run_road(
    settings: Mapping[str, Any],
    scenario: Mapping[str, Any],
    tiles: list[str],
    reporter: Reporter,
    workdir: str | None = None,
) -> tuple[Outcome, dict[str, Any], bytes | None]:
    """Run the road simulation.

    Args:
        settings: ``params``: ``from_s``, ``to_s``, ``warmup_s``, ``seed``, ``step_s``.
        scenario: The street lines, depots, street setup and traffic values (built by the simulator panel).
        tiles: The street tiles (OSM XML) covering the lines and depots.
        reporter: Gets progress and says when to stop.
        workdir: Folder for SUMO's files (a temporary folder when None).

    Returns:
        ``"done"`` or ``"stopped"``, the result, and the gzipped replay (None if it stopped before SUMO).
    """
    if workdir is None:
        with tempfile.TemporaryDirectory(prefix="mobsim-road-") as tmp:
            return run_road(settings, scenario, tiles, reporter, tmp)
    p = dict(settings.get("params", {}))
    from_s = float(p["from_s"])
    to_s = float(p["to_s"])
    warmup = float(p.get("warmup_s", 1800.0))
    seed = int(p.get("seed", 1))
    step_s = float(p.get("step_s", 0.5))
    begin = max(0.0, from_s - warmup)
    result: dict[str, Any] = {
        "notes": [],
        "lines": [],
        "events": [],
        "run": None,
        "network": None,
        "traffic": None,
    }

    def step(name: str, **extra: Any) -> bool:
        reporter.report({"step": name, **extra}, result)
        return reporter.should_stop()

    if step("network"):
        return "stopped", result, None
    left = scenario.get("driving_side") == "left"
    data = osm.merge_tiles(tiles)
    osm.clip(data, *_bbox(scenario))
    osm.apply_street_setup(data, scenario.get("streets", []), left_hand=left)
    osm_signals = osm.mapped_signals(data)  # before the planner's junction setup adds or removes lights
    lights_on, lights_off = osm.apply_junction_setup(data, scenario.get("junctions", []))
    if lights_on or lights_off:
        result["notes"].append(
            f"junction setup: {lights_on:,} junctions given traffic lights, {lights_off:,} without"
        )
    depot_ways: dict[str, osm.DepotWays] = {}
    for d in scenario.get("depots", []):
        dw = osm.add_depot(data, d.get("network", {}))
        depot_ways[str(d["id"])] = dw
        if dw.unjoined:
            result["notes"].append(
                f"depot {d.get('name') or d['id']}: a gate is not near a street a bus may use"
            )
    wired = {w.id for w in data.ways.values() if w.tags.get("trolley_wire") in ("yes", "both")}
    wired |= {
        w.id
        for w in data.ways.values()
        if "yes" in (w.tags.get("trolley_wire:forward"), w.tags.get("trolley_wire:backward"))
    }
    osm_file = os.path.join(workdir, "streets.osm")
    net_file = os.path.join(workdir, "net.net.xml")
    osm.write(data, osm_file)
    keep = [str(i) for i in data.ways if i >= osm.ADDED_ID_BASE]
    warnings = netconvert(osm_file, net_file, workdir, left, keep)
    net = RoadNet(net_file)
    edges = [e for e in net.net.getEdges() if e.getFunction() == ""]
    result["network"] = {
        "edges": len(edges),
        "km": sum(e.getLength() for e in edges) / 1000.0,
        # Junctions with lights; netconvert runs lights closer than 20 m as one controller (``--tls.join``).
        "signals": sum(1 for n in net.net.getNodes() if n.getType().startswith("traffic_light")),
        "osm_signals": osm_signals,
        "warnings": len(warnings),
    }
    if osm_signals == 0 and lights_on == 0:
        result["notes"].append(
            "OpenStreetMap maps no traffic lights on these streets, so every junction runs without lights "
            "and side streets wait for gaps in the main roads' traffic. Give the main junctions traffic "
            "lights in GIS › Streets."
        )

    if step("planning"):
        return "stopped", result, None
    lines = list(scenario.get("lines", []))
    depots = service.Depots(net, scenario.get("depots", []), depot_ways)
    plans = [service.plan_line(net, ln, depots) for ln in lines]
    for pl in plans:
        if pl.problem:
            result["notes"].append(f"{pl.name} cannot run: {pl.problem}")
    runnable = [pl for pl in plans if not pl.problem and pl.vehicles]
    if not runnable:
        raise ValueError(
            "no street line can run: " + "; ".join(n for n in result["notes"])
            if result["notes"]
            else "no street lines"
        )
    last_planned = max(v.trips[-1] + pl.cycle_s for pl in runnable for v in pl.vehicles)
    first_depart = min(v.depart for pl in runnable for v in pl.vehicles)
    begin = min(begin, max(0.0, first_depart - 1.0))
    end = max(to_s, last_planned) + RETURN_S
    transit_file = os.path.join(workdir, "transit.rou.xml")
    service.write_transit(runnable, lines, net, transit_file)
    additional = ""
    if any(pl.energy == "trolleybus" for pl in runnable) and wired:
        additional = os.path.join(workdir, "wires.add.xml")
        service.write_wires(net, wired, float(scenario.get("trolley_charge_kw", 120.0)), additional)

    if step("traffic"):
        return "stopped", result, None
    bg_file = os.path.join(workdir, "background.rou.xml")
    tr = traffic.write_background(
        net,
        net_file,
        workdir,
        data.ways,
        scenario.get("streets", []),
        scenario.get("traffic", {}),
        begin,
        max(to_s, last_planned),
        seed,
        bg_file,
    )
    result["traffic"] = {
        "cars": tr.cars,
        "target_car_km": tr.target_car_km,
        "sampled_car_km": tr.sampled_car_km,
    }

    def progress(t: float, until: float) -> None:
        reporter.report({"step": "simulating", "t": t, "begin": begin, "end": until}, result)

    files = {
        "net": net_file,
        "routes": f"{bg_file},{transit_file}",
        "additional": additional,
        "stops": os.path.join(workdir, "stops.xml"),
        "tripinfo": os.path.join(workdir, "tripinfo.xml"),
    }
    out = sim.run_sumo(
        files=files,
        plans=runnable,
        begin=begin,
        end=end,
        step_s=step_s,
        seed=seed,
        report=progress,
        should_stop=reporter.should_stop,
    )
    stops = sim.read_stops(files["stops"])
    by_index = {int(ln["index"]): ln for ln in lines}
    result["lines"] = [line_results(pl, by_index[pl.index], stops, out, from_s, to_s) for pl in plans]
    result["events"] = out.events[:500]
    result["run"] = {
        "begin": begin,
        "end": out.sim_end,
        "from_s": from_s,
        "to_s": to_s,
        "teleports": out.teleports,
        "collisions": out.collisions,
        "background_inserted": out.background_inserted,
        "background_removed": out.background_removed,
        "vehicles": sum(len(pl.vehicles) for pl in runnable),
        "back_in_depot": sum(1 for w in out.watches.values() if w.arrived and w.vehicle.slot_in),
        "gridlocks": sum(1 for e in out.events if e["kind"] == "gridlock"),
        "wall_s": out.wall_s,
        "speedup": (out.sim_end - begin) / out.wall_s if out.wall_s > 0 else 0.0,
        "seed": seed,
        "step_s": step_s,
        "complete": not out.stopped,
    }
    if out.background_removed:
        result["notes"].append(
            f"{out.background_removed:,} background cars stood for over {sim.CAR_STUCK_S / 60:.0f} minutes "
            "and were taken out of the traffic to clear jams; the streets may be busier than they can carry"
        )
    replay = sim.pack_replay(runnable, out, stops)
    return ("stopped" if out.stopped else "done"), result, replay
