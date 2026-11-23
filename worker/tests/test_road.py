"""Road simulation (SUMO): OSM preparation, traffic rates, vehicle planning and a whole run on a town."""

from __future__ import annotations

import gzip
import json
from pathlib import Path
from typing import Any

import pytest
from road_fixture import depot, line, tiles

from mobsim_worker.jobs.road.osm import OsmData, Way, apply_junction_setup, apply_street_setup, merge_tiles
from mobsim_worker.jobs.road.service import blocks, planned_offsets
from mobsim_worker.jobs.road.traffic import intervals, way_rate

H = 3600.0
DEFAULTS = {"trunk": 1500, "primary": 900, "secondary": 600, "tertiary": 300, "local": 50}


def test_tiles_merge_into_one_network_without_duplicates() -> None:
    data = merge_tiles(tiles())
    assert len(data.ways) == 40
    assert len(data.nodes) == 25
    assert data.ways[109].tags["name"] == "Main Street"


def _cross(signals_at: dict[int, dict[str, str]]) -> OsmData:
    """A crossroads at node 1 (lon 0, lat 0), arms about 11 m per node, and a second junction at node 13."""
    d = OsmData()
    pts = {1: (0.0, 0.0), 2: (0.0001, 0.0), 3: (0.0002, 0.0), 4: (0.0004, 0.0), 5: (-0.0001, 0.0)}
    pts |= {11: (0.0, 0.0001), 12: (0.0, -0.0001), 13: (0.0002, 0.0001), 14: (0.0002, -0.0001)}
    for n, (lon, lat) in pts.items():
        d.nodes[n] = (lon, lat, dict(signals_at.get(n, {})))
    d.ways[100] = Way(100, [5, 1, 2, 3, 4], {"highway": "primary"})
    d.ways[200] = Way(200, [11, 1, 12], {"highway": "secondary"})
    d.ways[300] = Way(300, [13, 3, 14], {"highway": "residential"})
    return d


def test_junction_setup_adds_lights_or_removes_them_with_the_approach_signals() -> None:
    sig = {"highway": "traffic_signals"}
    d = _cross({})
    assert apply_junction_setup(d, [{"nodes": [1], "signals": True}]) == (1, 0)
    assert d.nodes[1][2]["highway"] == "traffic_signals"

    d = _cross({2: sig, 3: sig, 4: sig, 5: {**sig, "crossing": "traffic_signals"}})
    assert apply_junction_setup(d, [{"nodes": [1], "signals": False}]) == (0, 1)
    assert "highway" not in d.nodes[2][2]  # approach signal 11 m out: the junction's own lights
    assert d.nodes[5][2] == {"crossing": "uncontrolled"}
    assert d.nodes[3][2] == sig  # the next junction keeps its lights
    assert d.nodes[4][2] == sig  # beyond it, and too far

    d = _cross({1: sig})
    assert apply_junction_setup(d, [{"nodes": [999], "signals": False}, {"nodes": [1]}]) == (0, 0)
    assert d.nodes[1][2] == sig


def test_street_setup_adds_a_kerb_bus_lane_each_way() -> None:
    data = merge_tiles(tiles())
    assert apply_street_setup(data, [{"way": 110, "traffic_lanes": 2, "bus_lane": True}, {"way": 9}]) == 1
    t = data.ways[110].tags
    assert t["lanes"] == "4"
    assert t["lanes:forward"] == "2" and t["lanes:backward"] == "2"
    assert t["bus:lanes:forward"] == "yes|designated"


def test_street_setup_makes_a_street_one_way_or_two_way() -> None:
    data = merge_tiles(tiles())
    data.ways[110].tags["oneway:bus"] = "no"
    assert apply_street_setup(data, [{"way": 110, "oneway": False}]) == 1
    t = data.ways[110].tags
    assert t["oneway"] == "no" and "oneway:bus" not in t
    # One-way with a bus lane: one traffic lane and the bus lane, all in the way's direction.
    assert apply_street_setup(data, [{"way": 110, "oneway": True, "traffic_lanes": 1, "bus_lane": True}]) == 1
    t = data.ways[110].tags
    assert t["oneway"] == "yes"
    assert t["lanes"] == "2" and t["bus:lanes"] == "yes|designated"
    assert "lanes:backward" not in t


def test_a_custom_layout_sets_the_lanes_of_each_direction() -> None:
    def lane(users: list[str], d: str | None = None) -> dict[str, object]:
        return {"kind": "lane", "users": users, "dir": d, "width": 3.1}

    data = merge_tiles(tiles())
    centre_bus = [
        lane(["walk"]),
        lane(["car", "taxi"], "backward"),
        {"kind": "protection", "width": 0.5},
        lane(["bus"], "backward"),
        lane(["bus"], "forward"),
        lane(["car", "taxi"], "forward"),
        lane(["car", "taxi"], "forward"),
        lane(["walk"]),
    ]
    assert apply_street_setup(data, [{"way": 110, "sections": centre_bus}]) == 1
    t = data.ways[110].tags
    assert t["oneway"] == "no" and t["lanes"] == "5"
    assert t["lanes:forward"] == "3" and t["lanes:backward"] == "2"
    # Left to right in each direction: the bus lane is on the inside, next to the centre.
    assert t["bus:lanes:forward"] == "designated|yes|yes"
    assert t["bus:lanes:backward"] == "designated|yes"
    assert "motor_vehicle" not in t

    tram_only = [lane(["walk"]), lane(["tram"], "backward"), lane(["tram"], "forward"), lane(["walk"])]
    apply_street_setup(data, [{"way": 110, "sections": tram_only}])
    t = data.ways[110].tags
    assert t["motor_vehicle"] == "no" and t["bus"] == "no"
    assert "lanes" not in t


def test_on_the_left_the_bus_lane_is_the_leftmost() -> None:
    data = merge_tiles(tiles())
    apply_street_setup(data, [{"way": 110, "bus_lane": True}], left_hand=True)
    assert data.ways[110].tags["bus:lanes:forward"] == "designated|yes"


def test_the_run_is_cut_at_the_peaks_and_the_first_peak_is_the_morning() -> None:
    parts = intervals(6 * H, 10 * H, [(7 * H, 9 * H), (16 * H, 19 * H)])
    assert [(p.begin / H, p.end / H, p.peak) for p in parts] == [
        (6, 7, None),
        (7, 9, "morning"),
        (9, 10, None),
    ]
    assert intervals(17 * H, 18 * H, [(7 * H, 9 * H), (16 * H, 19 * H)])[0].peak == "evening"


def test_traffic_takes_the_street_peak_and_a_share_of_it_off_peak() -> None:
    main = Way(1, [1, 2], {"highway": "primary"})
    own = {"cars_morning_peak": 700, "cars_evening_peak": 1000}
    assert way_rate(main, own, DEFAULTS, "morning", 0.6) == 700
    assert way_rate(main, own, DEFAULTS, "evening", 0.6) == 1000
    assert way_rate(main, own, DEFAULTS, None, 0.6) == pytest.approx(600)
    assert way_rate(main, None, DEFAULTS, "morning", 0.6) == 900
    assert way_rate(main, None, DEFAULTS, None, 0.5) == 450
    assert way_rate(Way(2, [1, 2], {"highway": "busway"}), None, DEFAULTS, "morning", 0.6) == 0
    assert way_rate(None, None, DEFAULTS, "morning", 0.6) == 0


def test_planned_times_add_the_line_dwell_at_each_stop() -> None:
    offs, cycle = planned_offsets(line(0, "other"))
    legs = [leg["time_s"] for leg in line(0, "other")["legs"]]
    dwell = line(0, "other")["dwell_s"]
    assert offs[0] == 0
    assert offs[1] == pytest.approx(legs[0] + dwell)
    assert cycle > sum(legs)


def test_each_departure_goes_to_the_vehicle_back_first() -> None:
    assert blocks([0, 600, 1200, 1800], 1000) == [[0, 1200], [600, 1800]]
    assert blocks([0, 600], 300) == [[0, 600]]


SCENARIO: dict[str, Any] = {
    "driving_side": "right",
    "streets": [{"way": 110, "bus_lane": True, "cars_morning_peak": 900}],
    "traffic": {
        "defaults": DEFAULTS,
        "off_peak_share": 0.6,
        "peaks": [[7 * H, 9 * H], [16 * H, 19 * H]],
    },
    "trolley_charge_kw": 120,
}


class Recorder:
    def __init__(self) -> None:
        self.steps: list[str] = []

    def report(self, step: dict[str, Any], result: dict[str, Any]) -> None:
        self.steps.append(str(step.get("step")))

    def should_stop(self) -> bool:
        return False


def _run(tmp: Path, energy: str = "battery") -> tuple[str, dict[str, Any], bytes | None, Recorder]:
    pytest.importorskip("libsumo")
    from mobsim_worker.jobs.road.job import run_road  # noqa: PLC0415 (needs SUMO)

    scenario = {**SCENARIO, "lines": [line(0, energy)], "depots": [depot()]}
    settings = {"params": {"from_s": 7 * H, "to_s": 7.5 * H, "warmup_s": 600, "seed": 1}}
    rec = Recorder()
    tmp.mkdir(parents=True, exist_ok=True)
    outcome, result, replay = run_road(settings, scenario, tiles(), rec, str(tmp))
    return outcome, result, replay, rec


def test_a_line_runs_out_of_its_depot_and_back_in_traffic(tmp_path: Path) -> None:
    outcome, result, replay, rec = _run(tmp_path / "a")
    assert outcome == "done"
    assert rec.steps[:3] == ["network", "planning", "traffic"]
    run = result["run"]
    assert run["teleports"] == 0
    assert run["background_inserted"] > 0
    assert run["vehicles"] >= 1 and run["back_in_depot"] == run["vehicles"]
    ln = result["lines"][0]
    assert ln["problem"] is None
    assert ln["trips_run"] == ln["trips"] > 0
    assert 0 <= ln["punctuality"] <= 1
    assert ln["energy_use"]["kwh"] > 0 and ln["energy_use"]["ran_out"] == 0
    assert replay is not None
    doc = json.loads(gzip.decompress(replay))
    assert doc["version"] == 1 and doc["vehicles"] and doc["frames"] > 1
    assert all(v["slot_out"] is not None for v in doc["vehicles"])
    # Each vehicle's stops: planned departure, arrival, departure, kind; it served them all and came back.
    for v in doc["vehicles"]:
        st = v["st"]
        assert st and len(st) % 4 == 0
        assert st[3] == 1 and st[-1] == 2
        assert all(st[i + 1] >= 0 and st[i + 2] >= st[i + 1] for i in range(0, len(st) - 4, 4))


def test_the_same_seed_gives_the_same_run(tmp_path: Path) -> None:
    _, a, ra, _ = _run(tmp_path / "a", "other")
    _, b, rb, _ = _run(tmp_path / "b", "other")
    strip = lambda r: {k: v for k, v in r["run"].items() if k not in ("wall_s", "speedup")}  # noqa: E731
    assert strip(a) == strip(b)
    assert a["lines"] == b["lines"]
    assert ra == rb


def test_the_replay_lists_each_stop_with_its_plan_and_when_it_was_served() -> None:
    from mobsim_worker.jobs.road.service import PlannedStop, TransitVehicle  # noqa: PLC0415
    from mobsim_worker.jobs.road.sim import replay_stops  # noqa: PLC0415

    def stop(trip: int, point: int, kind: str, dep: float, first: bool) -> PlannedStop:
        return PlannedStop(trip, point, "S", kind, dep, first, "e_0", 10.0)

    v = TransitVehicle(
        id="v0",
        line=3,
        number=0,
        depart=25000.0,
        trips=[25200.0],
        stops=[
            stop(0, 0, "end_stop", 25200.0, True),
            stop(0, 2, "stop", 25500.0, False),
            stop(0, 0, "last", 26000.0, False),
        ],
        route=[],
        depart_lane="",
        depart_pos=0.0,
        arrival_pos=None,
        slot_out=None,
        slot_in=None,
        depot=None,
    )
    out = [
        {"id": "v0", "tripId": "3:0:0", "started": "25100.00", "ended": "25200.00"},
        {"id": "v0", "tripId": "3:0:2", "started": "25580.40", "ended": "25600.60"},
        {"id": "v1", "tripId": "3:0:end", "started": "1", "ended": "2"},
    ]
    assert replay_stops(v, out) == [25200, 25100, 25200, 1, 25500, 25580, 25601, 0, 26000, -1, -1, 2]


def _town_net(tmp: Path) -> Any:
    pytest.importorskip("libsumo")
    from mobsim_worker.jobs.road import osm  # noqa: PLC0415
    from mobsim_worker.jobs.road.network import RoadNet, netconvert  # noqa: PLC0415

    tmp.mkdir(parents=True, exist_ok=True)
    data = osm.merge_tiles(tiles())
    osm.write(data, str(tmp / "streets.osm"))
    netconvert(str(tmp / "streets.osm"), str(tmp / "net.net.xml"), str(tmp), False)
    return RoadNet(str(tmp / "net.net.xml"))


def test_a_break_in_a_matched_route_is_closed_with_a_bus_path(tmp_path: Path) -> None:
    from road_fixture import lonlat  # noqa: PLC0415

    net = _town_net(tmp_path)
    east = net.match([lonlat(0, 2), lonlat(1, 2), lonlat(2, 2)])
    west = net.match([lonlat(2, 2), lonlat(1, 2), lonlat(0, 2)])
    # No U-turn at the crossing: as SUMO would read it, this route has no connection there (bug 29).
    assert not net.follows(east[-1], west[0])
    route = net.connect(east + west)
    assert route[: len(east)] == east and route[-len(west) :] == west
    assert all(net.follows(a, b) for a, b in zip(route, route[1:], strict=False))


def test_a_route_with_no_bus_path_names_the_streets_and_the_nearest_stop() -> None:
    from mobsim_worker.jobs.road.network import NoBusLink  # noqa: PLC0415
    from mobsim_worker.jobs.road.service import match_circuit  # noqa: PLC0415

    ln = line()

    class Net:
        def match(self, coords: Any) -> list[str]:
            at = tuple(ln["points"][1]["lonlat"])
            raise NoBusLink("-29270329#0", "1242688065", "Main Street", "Col 2", at)

    problem = match_circuit(Net(), ln)  # type: ignore[arg-type]
    assert isinstance(problem, str)
    assert problem.startswith("no way for a bus from Main Street onto Col 2, near Middle (0 m away)")
    assert "29270329" not in problem


def test_background_cars_stuck_for_minutes_are_taken_out_but_buses_never() -> None:
    from mobsim_worker.jobs.road import sim  # noqa: PLC0415

    class Vehicle:
        waiting = {"bg1": 200.0, "bg2": 20.0, "L0v0": 900.0}
        removed: list[str] = []

        def getIDList(self) -> list[str]:  # noqa: N802 (libsumo's names)
            return list(self.waiting)

        def getWaitingTime(self, vid: str) -> float:  # noqa: N802
            return self.waiting[vid]

        def remove(self, vid: str) -> None:
            self.removed.append(vid)

    class Libsumo:
        vehicle = Vehicle()

    watches = {"L0v0": object()}
    assert sim._clear_stuck_cars(Libsumo(), watches) == 1  # type: ignore[arg-type]
    assert Libsumo.vehicle.removed == ["bg1"]
