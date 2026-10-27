"""Spike S1: co-simulation of SUMO (libsumo) and the Rust rail kernel in one process.

Scenario (all coordinates in metres):

* Rail kernel track R1 runs north from (0, 0) to the portal at (0, 1000). It crosses
  a two-way road at y = 500 on a level crossing. The crossing section belongs to the
  rail kernel; the road side is a SUMO traffic light that the coordinator controls.
* SUMO street running P (0, 1000) -> M (0, 1500) -> Q (0, 2000): the tram shares the
  street with cars joining from a side street at M.
* Rail kernel track R2 continues north from Q (0, 2000) to (0, 3000).

One tram (same ID everywhere) runs R1 -> street -> R2. The script checks that it is
never teleported, that its travelled distance is continuous across both handovers,
that the level crossing is red whenever the crossing section is reserved, and it
measures the coordinator overhead per step against a SUMO-only baseline.

Usage: python s1_cosim.py [--steps N] [--json out.json]
Dependencies: eclipse-sumo + libsumo (EPL-2.0 OR GPL-2.0-or-later), mobsim_kernels.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

import libsumo as traci
import mobsim_kernels
import sumo

DT = 0.5
TRAM = "tram1"
TRAM_LEN = 30.0
STREET_ROUTE = ["PM", "MQ"]
ENTRY_STUB = 40.0  # R2 starts with a stub that overlaps the last 40 m of MQ.

# Rail sections: index -> (length, speed limit m/s)
R1 = [(300.0, 19.4), (180.0, 19.4), (40.0, 11.1), (480.0, 13.9)]  # 0..1000, crossing = 2
R2 = [(ENTRY_STUB, 8.3), (460.0, 19.4), (500.0, 19.4)]  # stub + 2000..3000
CROSSING_TDS = 2
LC_CLOSE_LEAD_S = 8.0  # road red for this long before the rail route may be set


def write_network(d: Path) -> Path:
    """Purpose: build the SUMO network and demand in directory `d`.

    Output: path of the .sumocfg. Side effects: writes files, runs netconvert.
    """
    (d / "n.nod.xml").write_text(
        """<nodes>
  <node id="W" x="-500" y="500"/><node id="X" x="0" y="500" type="traffic_light"/>
  <node id="E" x="500" y="500"/>
  <node id="P" x="0" y="1000"/><node id="M" x="0" y="1500" type="priority"/>
  <node id="Q" x="0" y="2000"/><node id="S" x="-500" y="1500"/><node id="Z" x="500" y="2000"/>
</nodes>"""
    )
    (d / "n.edg.xml").write_text(
        """<edges>
  <edge id="WX" from="W" to="X" numLanes="1" speed="13.9" allow="passenger"/>
  <edge id="XE" from="X" to="E" numLanes="1" speed="13.9" allow="passenger"/>
  <edge id="EX" from="E" to="X" numLanes="1" speed="13.9" allow="passenger"/>
  <edge id="XW" from="X" to="W" numLanes="1" speed="13.9" allow="passenger"/>
  <edge id="PM" from="P" to="M" numLanes="1" speed="13.9" allow="tram passenger"/>
  <edge id="SM" from="S" to="M" numLanes="1" speed="13.9" allow="passenger" priority="1"/>
  <edge id="MQ" from="M" to="Q" numLanes="1" speed="13.9" allow="tram passenger" priority="3"/>
  <edge id="QZ" from="Q" to="Z" numLanes="1" speed="13.9" allow="passenger"/>
</edges>"""
    )
    (d / "r.rou.xml").write_text(
        f"""<routes>
  <vType id="car" vClass="passenger" length="4.5" sigma="0.5"/>
  <vType id="tram" vClass="tram" length="{TRAM_LEN}" accel="1.2" decel="1.0" maxSpeed="19.4" sigma="0"/>
  <route id="street" edges="{' '.join(STREET_ROUTE)}"/>
  <flow id="we" type="car" begin="0" end="3600" vehsPerHour="600" from="WX" to="XE" departLane="best" departSpeed="max"/>
  <flow id="ew" type="car" begin="0" end="3600" vehsPerHour="600" from="EX" to="XW" departLane="best" departSpeed="max"/>
  <flow id="side" type="car" begin="0" end="3600" vehsPerHour="300" from="SM" to="QZ" departLane="best"/>
</routes>"""
    )
    bin_dir = Path(sumo.SUMO_HOME) / "bin"
    subprocess.run(
        [str(bin_dir / "netconvert"), "-n", "n.nod.xml", "-e", "n.edg.xml", "-o", "n.net.xml",
         "--no-turnarounds", "true", "--tls.join", "false", "--junctions.join", "false"],
        cwd=d, check=True, capture_output=True,
    )
    (d / "s.sumocfg").write_text(
        f"""<configuration>
  <input><net-file value="n.net.xml"/><route-files value="r.rou.xml"/></input>
  <time><step-length value="{DT}"/></time>
  <processing><time-to-teleport value="-1"/><collision.action value="warn"/></processing>
  <random_number><seed value="42"/></random_number>
  <report><no-step-log value="true"/><duration-log.disable value="true"/></report>
</configuration>"""
    )
    return d / "s.sumocfg"


def tram_spec(path: list[int], start_head: float, stops: list[dict]) -> str:
    """Purpose: TrainSpec JSON for a 30 m, 40 t low-floor tram (generic assumption)."""
    return json.dumps({
        "name": TRAM, "length_m": TRAM_LEN, "mass_kg": 40_000.0, "max_accel_mps2": 1.2,
        "service_decel_mps2": 1.0, "max_speed_mps": 19.4, "power_w": 600_000.0,
        "davis_a_n": 600.0, "davis_b_n_per_mps": 15.0, "davis_c_n_per_mps2": 1.5,
        "path": path, "signals_at": list(range(len(path))), "cyclic": False,
        "stops": stops, "start_head_m": start_head, "depart_s": 0.0,
    })


@dataclass
class Trace:
    """Travelled-distance trace of the tram, one sample per step."""

    samples: list[tuple[float, str, float, float]] = field(default_factory=list)

    def add(self, t: float, owner: str, dist: float, v: float) -> None:
        self.samples.append((t, owner, dist, v))

    def max_gap(self) -> float:
        """Largest |Δdistance − v·dt| between consecutive samples (m)."""
        worst = 0.0
        for (t0, _, d0, v0), (t1, _, d1, v1) in zip(self.samples, self.samples[1:]):
            worst = max(worst, abs((d1 - d0) - 0.5 * (v0 + v1) * (t1 - t0)))
        return worst


def lc_box_clear() -> bool:
    """Purpose: true if no road vehicle is inside the level-crossing junction X."""
    return all(not traci.lane.getLastStepVehicleIDs(l) for l in traci.lane.getIDList() if l.startswith(":X_"))


def set_lc(state: str) -> None:
    """Purpose: show `state` ('r', 'y' or 'G') to every road movement at X."""
    n = len(traci.trafficlight.getRedYellowGreenState("X"))
    traci.trafficlight.setRedYellowGreenState("X", state * n)


def run(steps: int, cosim: bool) -> dict:
    """Purpose: run the scenario; with `cosim=False` only SUMO runs (baseline).

    Output: dict of measurements. Raises AssertionError on any failed check.
    """
    with tempfile.TemporaryDirectory() as tmp:
        cfg = write_network(Path(tmp))
        traci.start(["sumo", "-c", str(cfg)])
        r1 = mobsim_kernels.RailSim(json.dumps([{"length_m": l, "speed_limit_mps": v} for l, v in R1]),
                                    json.dumps({"route_request_margin_m": 100.0, "route_request_lookahead_s": 5.0,
                                                "deadlock_timeout_s": 900.0, "record_events": True}))
        r2 = mobsim_kernels.RailSim(json.dumps([{"length_m": l, "speed_limit_mps": v} for l, v in R2]),
                                    json.dumps({"route_request_margin_m": 100.0, "route_request_lookahead_s": 5.0,
                                                "deadlock_timeout_s": 900.0, "record_events": True}))
        trace = Trace()
        phase = "R1"
        tid1 = tid2 = None
        lc_state, lc_red_since, lc_violations, lc_closures = "G", None, 0, 0
        teleports = 0
        departed = 0
        street_len = sum(traci.lane.getLength(f"{e}_0") for e in STREET_ROUTE) if cosim else 0.0
        t_kernel = 0.0
        handovers: list[dict] = []
        if cosim:
            # Tram stands at a stop at y = 250 and departs at t = 60 s.
            spec = json.loads(tram_spec([0, 1, 2, 3], 250.0, []))
            spec["depart_s"] = 60.0
            tid1 = r1.add_train(json.dumps(spec))
            r1.set_blocked(CROSSING_TDS, True)  # crossing closed to rail until road is red and clear
        wall0 = time.perf_counter()
        for _ in range(steps):
            traci.simulationStep()
            teleports += traci.simulation.getStartingTeleportNumber()
            departed += traci.simulation.getDepartedNumber()
            if not cosim:
                continue
            k0 = time.perf_counter()
            t = traci.simulation.getTime()
            # Level crossing control.
            if phase == "R1":
                st = json.loads(r1.train_state(tid1))
                approaching = st["status"] == "Running" and st["head_m"] > 0 and r1.reserved_by(CROSSING_TDS) is None \
                    and st["head_m"] < 500.0 and (300.0 + 180.0 - st["head_m"]) < st["speed_mps"] ** 2 / 2.0 + 250.0
                if approaching and lc_state == "G":
                    lc_state, lc_red_since = "y", t
                    set_lc("y")
                    lc_closures += 1
                if lc_state == "y" and t - lc_red_since >= 3.0:
                    lc_state = "r"
                    set_lc("r")
                if lc_state == "r" and t - lc_red_since >= LC_CLOSE_LEAD_S and lc_box_clear():
                    r1.set_blocked(CROSSING_TDS, False)
            if lc_state == "r" and r1.reserved_by(CROSSING_TDS) is None and t - lc_red_since > LC_CLOSE_LEAD_S + 1 \
                    and (phase != "R1" or json.loads(r1.train_state(tid1))["head_m"] - TRAM_LEN > 520.0):
                r1.set_blocked(CROSSING_TDS, True)
                lc_state = "G"
                set_lc("G")
            if r1.reserved_by(CROSSING_TDS) is not None and traci.trafficlight.getRedYellowGreenState("X").lower().count("g"):
                lc_violations += 1
            # Portal R1 -> SUMO: open only if the street entry is free.
            if phase == "R1":
                entry_free = all(traci.vehicle.getLanePosition(v) > TRAM_LEN + 20.0
                                 for v in traci.lane.getLastStepVehicleIDs("PM_0"))
                r1.set_exit_open(tid1, entry_free)
                r1.step(DT)
                for ev in json.loads(r1.drain_events()):
                    if "HeadAtPortal" in ev:
                        st = json.loads(r1.train_state(tid1))
                        # SUMO places the vehicle during its next step without moving it, so
                        # insert it one step ahead to keep the distance continuous.
                        depart_off = st["head_m"] - 1000.0 + st["speed_mps"] * DT
                        traci.vehicle.add(TRAM, "street", typeID="tram", depart="now",
                                          departPos=str(TRAM_LEN + depart_off), departSpeed=str(st["speed_mps"]))
                        stop_set = False
                        phase = "R1->SUMO"
                        handovers.append({"t": t, "dir": "rail->road", "speed": st["speed_mps"]})
                st = json.loads(r1.train_state(tid1))
                trace.add(t, "rail", st["head_m"], st["speed_mps"])
            elif phase == "R1->SUMO":
                # Head is in SUMO; tail still on kernel track until it clears the portal.
                v = traci.vehicle.getSpeed(TRAM) if TRAM in traci.vehicle.getIDList() else json.loads(r1.train_state(tid1))["speed_mps"]
                r1.set_external_speed(tid1, v)
                r1.step(DT)
                st = json.loads(r1.train_state(tid1))
                if TRAM in traci.vehicle.getIDList():
                    if not stop_set:
                        # Hold the tram at the end of the street until the kernel admits it.
                        traci.vehicle.setStop(TRAM, "MQ", pos=traci.lane.getLength("MQ_0") - 0.1, duration=1e6)
                        stop_set = True
                    d = 1000.0 + depart_off + traci.vehicle.getDistance(TRAM)
                    trace.add(t, "road", d, v)
                if st["status"] == "Exited":
                    phase = "SUMO"
            elif phase == "SUMO":
                d = 1000.0 + depart_off + traci.vehicle.getDistance(TRAM)
                v = traci.vehicle.getSpeed(TRAM)
                trace.add(t, "road", d, v)
                if traci.vehicle.isStopped(TRAM):
                    # Ask the kernel to admit the tram onto R2 (atomic: fails if track is taken).
                    try:
                        tid2 = r2.add_train(tram_spec([0, 1, 2], ENTRY_STUB, []))
                    except ValueError:
                        tid2 = None
                    if tid2 is not None:
                        traci.vehicle.remove(TRAM)
                        phase = "R2"
                        handovers.append({"t": t, "dir": "road->rail", "speed": 0.0})
                        base = d
            elif phase == "R2":
                r2.step(DT)
                st = json.loads(r2.train_state(tid2))
                trace.add(t, "rail", base + st["head_m"] - ENTRY_STUB, st["speed_mps"])
            r1.check_invariants()
            r2.check_invariants()
            t_kernel += time.perf_counter() - k0
        wall = time.perf_counter() - wall0
        sim_t = traci.simulation.getTime()
        traci.close()
    out = {"cosim": cosim, "steps": steps, "sim_seconds": sim_t, "wall_seconds": wall, "teleports": teleports,
           "vehicles_departed": departed}
    if cosim:
        final = trace.samples[-1]
        out.update({
            "final_phase": phase,
            "handovers": handovers,
            "final_distance_m": final[2],
            "street_lanes_length_m": street_len,
            "r2_final_status": json.loads(r2.train_state(tid2))["status"] if tid2 is not None else None,
            "max_distance_discontinuity_m": trace.max_gap(),
            "lc_closures": lc_closures,
            "lc_violations": lc_violations,
            "coordinator_ms_per_step": 1000.0 * t_kernel / steps,
        })
        assert phase == "R2", f"tram did not reach R2 (phase {phase})"
        assert teleports == 0, "teleport happened"
        assert lc_violations == 0, "road green while crossing reserved"
        assert out["max_distance_discontinuity_m"] < 1.0, out["max_distance_discontinuity_m"]
    return out


def main() -> None:
    """Purpose: run baseline and co-simulation, print and optionally save a report."""
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=1200)
    ap.add_argument("--json")
    a = ap.parse_args()
    base = run(a.steps, cosim=False)
    co = run(a.steps, cosim=True)
    report = {"baseline": base, "cosim": co,
              "overhead_ms_per_step": 1000.0 * (co["wall_seconds"] - base["wall_seconds"]) / a.steps,
              "sumo_version": traci.simulation.getVersion()[1] if hasattr(traci.simulation, "getVersion") else "",
              "python": os.sys.version.split()[0]}
    print(json.dumps(report, indent=2))
    if a.json:
        Path(a.json).write_text(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
