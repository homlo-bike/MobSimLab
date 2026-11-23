"""The SUMO run itself (libsumo): step, watch the street line vehicles, record the replay, then measure.

While SUMO steps, the street line vehicles are watched:

- **Replay.** Their position, heading, speed and battery charge every ``frame_s`` seconds.
- **Lost time.** Each step a vehicle stands (below 0.5 m/s) away from a stop counts as lost: at signals when
  the next traffic light is within 40 m and not green, else in traffic.
- **Gridlock.** A vehicle that has stood over 5 minutes away from a stop and a red light is a run event.
  Nothing is teleported (``--time-to-teleport -1``): the vehicle stays where it is.
- **Energy.** A battery or trolleybus that runs out of charge stops where it is (a run event; no recharge).

After the run, SUMO's stop output gives each stop's departure; with the plan it gives punctuality, delays,
bunching and circuit times per line.
"""

from __future__ import annotations

import gzip
import json
import math
import time
import xml.etree.ElementTree as ET  # noqa: S405 (SUMO's own output files)
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from mobsim_worker.jobs.road.network import sumo_binary
from mobsim_worker.jobs.road.service import LinePlan, TransitVehicle

#: Speed below which a vehicle counts as standing, m/s.
STANDING_MPS = 0.5

#: A traffic light this close ahead, not green, means the vehicle waits at the signal, m.
SIGNAL_NEAR_M = 40.0

#: Standing this long away from a stop is a gridlock event, s.
GRIDLOCK_S = 300.0

#: Most position samples kept for the replay (vehicles × frames); the frame interval grows to stay below it.
MAX_SAMPLES = 1_500_000

#: Simulated seconds between progress reports.
PROGRESS_EVERY_S = 120.0

#: Least wall-clock time between progress reports, s (fast runs would otherwise write the run row too often).
PROGRESS_MIN_WALL_S = 1.0


@dataclass
class Watch:
    """What the loop learns about one street line vehicle."""

    vehicle: TransitVehicle
    frame0: int = -1
    samples: list[int] = field(default_factory=list)
    lost_traffic_s: float = 0.0
    lost_signals_s: float = 0.0
    stood_since: float | None = None
    gridlocked: bool = False
    energy_out: bool = False
    consumed_wh: float = 0.0
    regenerated_wh: float = 0.0
    charged_wh: float = 0.0
    capacity_wh: float = 0.0
    min_charge_wh: float | None = None
    distance_m: float = 0.0
    arrived: bool = False
    last_lonlat: tuple[float, float] | None = None


@dataclass
class SimOutcome:
    """What the run produced: per-vehicle watches, events, totals and the replay."""

    watches: dict[str, Watch]
    events: list[dict[str, Any]]
    teleports: int
    collisions: int
    background_inserted: int
    sim_end: float
    wall_s: float
    stopped: bool
    frame_s: float
    begin: float
    frames: int


def frame_interval(vehicles: int, span_s: float, base_s: float = 2.0) -> float:
    """Seconds between replay frames, at least ``base_s``, so that samples stay below ``MAX_SAMPLES``."""
    if vehicles <= 0 or span_s <= 0:
        return base_s
    need = vehicles * span_s / MAX_SAMPLES
    return float(max(base_s, math.ceil(need)))


def run_sumo(
    *,
    files: Mapping[str, str],
    plans: Sequence[LinePlan],
    begin: float,
    end: float,
    step_s: float,
    seed: int,
    report: Callable[[float, float], None],
    should_stop: Callable[[], bool],
) -> SimOutcome:
    """Run SUMO from ``begin`` until every street line vehicle has arrived, or ``end``.

    Args:
        files: ``net``, ``routes`` (comma-separated), ``additional`` (or empty), ``stops``, ``tripinfo``.
        plans: The planned lines.
        begin: First second of the run.
        end: Last second (the run stops then even if vehicles are still out).
        step_s: SUMO step length, s.
        seed: SUMO's random seed.
        report: Gets the simulated time and ``end`` now and then.
        should_stop: True when the run must stop (cancelled, or the worker is stopping).

    Returns:
        What happened.
    """
    import libsumo  # noqa: PLC0415 (only in the worker image and local builds with the ``sim`` extra)

    args = [
        sumo_binary("sumo"),
        "-n",
        files["net"],
        "-r",
        files["routes"],
        "--begin",
        f"{begin:.0f}",
        "--end",
        f"{end:.0f}",
        "--step-length",
        f"{step_s}",
        "--seed",
        str(seed),
        "--time-to-teleport",
        "-1",
        "--collision.action",
        "warn",
        "--stop-output",
        files["stops"],
        "--tripinfo-output",
        files["tripinfo"],
        "--no-step-log",
        "--duration-log.disable",
        "--xml-validation",
        "never",
        "--default.action-step-length",
        "1",
    ]
    if files.get("additional"):
        args += ["-a", files["additional"]]
    watches = {v.id: Watch(v) for p in plans for v in p.vehicles}
    energy_ids = {v.id for p in plans if p.energy in ("battery", "trolleybus") for v in p.vehicles}
    span = end - begin
    frame_s = frame_interval(len(watches), span)
    events: list[dict[str, Any]] = []
    teleports = 0
    collisions = 0
    inserted_bg = 0
    wall0 = time.monotonic()
    libsumo.start(args)
    stopped = False
    try:
        t = begin
        next_frame = begin
        next_report = begin
        last_wall = -PROGRESS_MIN_WALL_S
        active: set[str] = set()
        left = set(watches)
        while t < end:
            libsumo.simulationStep()
            t = float(libsumo.simulation.getTime())
            for vid in libsumo.simulation.getDepartedIDList():
                if vid in watches:
                    active.add(vid)
                else:
                    inserted_bg += 1
            for vid in libsumo.simulation.getArrivedIDList():
                if vid in watches:
                    active.discard(vid)
                    left.discard(vid)
                    watches[vid].arrived = True
            teleports += int(libsumo.simulation.getStartingTeleportNumber())
            collisions += int(libsumo.simulation.getCollidingVehiclesNumber())
            frame = t >= next_frame
            for vid in active:
                w = watches[vid]
                speed = float(libsumo.vehicle.getSpeed(vid))
                at_stop = bool(libsumo.vehicle.getStopState(vid) & 1)
                if speed < STANDING_MPS and not at_stop:
                    tls = libsumo.vehicle.getNextTLS(vid)
                    red = bool(tls) and tls[0][2] <= SIGNAL_NEAR_M and tls[0][3] not in ("G", "g")
                    if red:
                        w.lost_signals_s += step_s
                    else:
                        w.lost_traffic_s += step_s
                    if w.stood_since is None:
                        w.stood_since = t
                    elif not w.gridlocked and not red and t - w.stood_since >= GRIDLOCK_S:
                        w.gridlocked = True
                        x, y = libsumo.vehicle.getPosition(vid)
                        lon, lat = libsumo.simulation.convertGeo(x, y)
                        events.append(
                            {
                                "kind": "gridlock",
                                "t": t,
                                "vehicle": vid,
                                "line": w.vehicle.line,
                                "lonlat": [round(lon, 6), round(lat, 6)],
                                "edge": libsumo.vehicle.getRoadID(vid),
                            }
                        )
                else:
                    w.stood_since = None
                if frame or vid in energy_ids and int(t) % 10 == 0:
                    w.distance_m = float(libsumo.vehicle.getDistance(vid))
                    if vid in energy_ids:
                        _energy(libsumo, vid, w, t, events)
                if frame:
                    x, y = libsumo.vehicle.getPosition(vid)
                    lon, lat = libsumo.simulation.convertGeo(x, y)
                    w.last_lonlat = (lon, lat)
                    k = int(round((t - begin) / frame_s))
                    if w.frame0 < 0:
                        w.frame0 = k
                    # Fill frames the vehicle was in the network but not sampled (should not happen).
                    while w.frame0 + len(w.samples) // 5 < k:
                        w.samples.extend(w.samples[-5:] if w.samples else [0, 0, 0, 0, -1])
                    soc = -1
                    if w.capacity_wh > 0 and w.min_charge_wh is not None:
                        soc = int(round(100 * _charge(libsumo, vid) / w.capacity_wh))
                    w.samples.extend(
                        [
                            int(round(lon * 1e5)),
                            int(round(lat * 1e5)),
                            int(round(float(libsumo.vehicle.getAngle(vid)))) % 360,
                            int(round(speed * 3.6)),
                            soc,
                        ]
                    )
            if frame:
                next_frame += frame_s
            if t >= next_report and time.monotonic() - last_wall >= PROGRESS_MIN_WALL_S:
                next_report = t + PROGRESS_EVERY_S
                last_wall = time.monotonic()
                report(t, end)
                if should_stop():
                    stopped = True
                    break
            if not left and t >= max((v.vehicle.depart for v in watches.values()), default=begin):
                break
    finally:
        libsumo.close()
    for vid, w in watches.items():
        if not w.arrived and w.vehicle.depart < t:
            events.append(
                {
                    "kind": "not_back",
                    "t": t,
                    "vehicle": vid,
                    "line": w.vehicle.line,
                    "lonlat": [round(w.last_lonlat[0], 6), round(w.last_lonlat[1], 6)]
                    if w.last_lonlat
                    else None,
                }
            )
    return SimOutcome(
        watches=watches,
        events=events,
        teleports=teleports,
        collisions=collisions,
        background_inserted=inserted_bg,
        sim_end=t,
        wall_s=time.monotonic() - wall0,
        stopped=stopped,
        frame_s=frame_s,
        begin=begin,
        frames=int((t - begin) / frame_s) + 1,
    )


def _charge(libsumo: Any, vid: str) -> float:
    return float(libsumo.vehicle.getParameter(vid, "device.battery.chargeLevel") or 0.0)


def _energy(libsumo: Any, vid: str, w: Watch, t: float, events: list[dict[str, Any]]) -> None:
    """Read a vehicle's battery; stop it for good when it has run out of charge."""
    get = libsumo.vehicle.getParameter
    if w.capacity_wh <= 0:
        w.capacity_wh = float(get(vid, "device.battery.capacity") or 0.0)
    charge = _charge(libsumo, vid)
    w.consumed_wh = float(get(vid, "device.battery.totalEnergyConsumed") or 0.0)
    w.regenerated_wh = float(get(vid, "device.battery.totalEnergyRegenerated") or 0.0)
    w.min_charge_wh = charge if w.min_charge_wh is None else min(w.min_charge_wh, charge)
    if charge <= 0.0 and not w.energy_out:
        w.energy_out = True
        libsumo.vehicle.setSpeed(vid, 0.0)
        x, y = libsumo.vehicle.getPosition(vid)
        lon, lat = libsumo.simulation.convertGeo(x, y)
        events.append(
            {
                "kind": "energy_out",
                "t": t,
                "vehicle": vid,
                "line": w.vehicle.line,
                "lonlat": [round(lon, 6), round(lat, 6)],
            }
        )


def read_stops(path: str) -> list[dict[str, str]]:
    """Read SUMO's stop output (one entry per stop a vehicle made)."""
    try:
        root = ET.parse(path).getroot()  # noqa: S314
    except (OSError, ET.ParseError):
        return []
    return [dict(el.attrib) for el in root.iter("stopinfo")]


#: Kind of a stop in the replay's stop list: a stop along a trip, the first stop of a trip, back at the first
#: stop after the last trip (the end of the vehicle's service).
STOP_ALONG, STOP_FIRST, STOP_LAST = 0, 1, 2


def replay_stops(v: TransitVehicle, stops: Sequence[Mapping[str, str]]) -> list[int]:
    """A vehicle's planned stops with when it reached and left each, for the replay's punctuality colours.

    Four numbers per planned stop, in plan order: planned departure, arrival, departure (s after midnight;
    -1 when the vehicle did not get there) and the kind (``STOP_ALONG``, ``STOP_FIRST`` or ``STOP_LAST``).
    """
    seen: dict[str, tuple[float, float]] = {}
    for st in stops:
        if st.get("id") != v.id:
            continue
        try:
            seen[st.get("tripId", "")] = (float(st.get("started", "nan")), float(st.get("ended", "nan")))
        except ValueError:
            continue

    def sec(x: float) -> int:
        return int(round(x)) if math.isfinite(x) else -1

    out: list[int] = []
    for s in v.stops:
        key = f"{v.line}:{s.trip}:{'end' if s.kind == 'last' else s.point}"
        started, ended = seen.get(key, (math.nan, math.nan))
        kind = STOP_LAST if s.kind == "last" else STOP_FIRST if s.first else STOP_ALONG
        out.extend([int(round(s.planned_dep)), sec(started), sec(ended), kind])
    return out


def pack_replay(
    plans: Sequence[LinePlan], outcome: SimOutcome, stops: Sequence[Mapping[str, str]] = ()
) -> bytes:
    """The replay as gzipped JSON: lines, vehicles with their slots, and a track of samples per vehicle.

    Each sample is ``[lon·1e5, lat·1e5, heading °, speed km/h, charge % or -1]``; a vehicle's track starts at
    frame ``f0`` and has one sample per frame while it is in the network. ``st`` lists the vehicle's stops
    (``replay_stops``, from SUMO's stop output), so the replay can show whether it is in service and on time.
    """
    lines = [{"index": p.index, "name": p.name, "color": p.color, "mode": p.mode} for p in plans]
    vehicles = []
    for p in plans:
        for v in p.vehicles:
            w = outcome.watches[v.id]
            vehicles.append(
                {
                    "id": v.id,
                    "line": v.line,
                    "number": v.number + 1,
                    "slot_out": [round(c, 6) for c in v.slot_out] if v.slot_out else None,
                    "slot_in": [round(c, 6) for c in v.slot_in] if v.slot_in else None,
                    "f0": w.frame0,
                    "s": w.samples,
                    "st": replay_stops(v, stops),
                }
            )
    doc = {
        "version": 1,
        "begin": outcome.begin,
        "frame_s": outcome.frame_s,
        "frames": outcome.frames,
        "lines": lines,
        "vehicles": vehicles,
        "events": outcome.events,
    }
    return gzip.compress(json.dumps(doc, separators=(",", ":")).encode("utf-8"), mtime=0)
