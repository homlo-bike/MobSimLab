"""The four-step demand model on a small synthetic town: a street grid, nine zones and one tram line."""

from __future__ import annotations

import base64
import gzip
import json
import math
from typing import Any

import numpy as np
import pytest

aeq = pytest.importorskip("aequilibrae")

from mobsim_worker.demand import steps  # noqa: E402
from mobsim_worker.demand.inputs import InputError, Values, library_values, parse_bundle  # noqa: E402
from mobsim_worker.demand.model import ATTRIBUTION, run_demand  # noqa: E402

LON0, LAT0 = 13.0, 52.0
DX = 400.0 / (111_320.0 * np.cos(np.radians(LAT0)))  # 400 m in degrees of longitude
DY = 400.0 / 110_574.0


def town(*, with_line: bool = True, headway_s: float = 300.0) -> dict[str, Any]:
    """A 7 × 7 street grid 400 m apart (2.4 km square), nine zones and, if asked, a tram along the middle."""
    n = 7
    nodes = [[LON0 + i * DX, LAT0 + j * DY] for j in range(n) for i in range(n)]
    links = []
    for j in range(n):
        for i in range(n):
            k = j * n + i
            main = j == 3 or i == 3
            cls = 2 if main else 5  # primary or local
            speed = 50 if main else 30
            if i < n - 1:
                links.append([k, k + 1, 400, cls, speed, 0, 0, 1, 1, 1, 1])
            if j < n - 1:
                links.append([k, k + n, 400, cls, speed, 0, 0, 1, 1, 1, 1])
    zones = []
    for zj in range(3):
        for zi in range(3):
            centre = zi == 1 and zj == 1
            zones.append(
                {
                    "id": f"z{zj}{zi}",
                    "name": f"Zone {zj}{zi}",
                    "centroid": [LON0 + (1 + 2 * zi) * DX, LAT0 + (1 + 2 * zj) * DY],
                    "area_km2": 0.64,
                    "population": 2000 if not centre else 800,
                    "workers": 900 if not centre else 350,
                    "children": 300 if not centre else 100,
                    "retail_jobs": 50 if not centre else 1500,
                    "other_jobs": 100 if not centre else 6000,
                    "schools": 1 if zi == 0 else 0,
                    "universities": 0,
                    "hospitals": 1 if centre else 0,
                    "clinics": 0,
                    "tourism": 0,
                    "cbd": None,
                }
            )
    stops = [
        {"id": f"s{i}", "name": f"Stop {i}", "lonlat": [LON0 + (2 * i) * DX, LAT0 + 3 * DY], "mode": "tram"}
        for i in range(4)
    ]
    transit: dict[str, Any] = {"stops": stops if with_line else [], "lines": [], "catchment_m": {"tram": 500}}
    if with_line:
        hw = {"am": headway_s, "md": headway_s * 2, "pm": headway_s, "ev": headway_s * 3}
        transit["lines"] = [
            {
                "id": "T1",
                "name": "Tram 1",
                "mode": "tram",
                "patterns": [
                    {"stops": ["s0", "s1", "s2", "s3"], "run_s": [120, 120, 120], "headway_s": hw},
                    {"stops": ["s3", "s2", "s1", "s0"], "run_s": [120, 120, 120], "headway_s": hw},
                ],
            }
        ]
    return {
        "version": 1,
        "zones": zones,
        "streets": {"nodes": nodes, "links": links},
        "transit": transit,
        "economy": {"currency": "EUR", "gdp_per_capita": 45000, "ppp_per_usd": 0.75},
    }


class Recorder:
    """Keeps every progress report; stops after ``stop_after`` reports when set."""

    def __init__(self, stop_after: int | None = None) -> None:
        self.steps: list[dict[str, Any]] = []
        self.stop_after = stop_after

    def report(self, step: dict[str, Any], result: dict[str, Any]) -> None:
        self.steps.append(step)

    def should_stop(self) -> bool:
        return self.stop_after is not None and len(self.steps) >= self.stop_after


@pytest.fixture(scope="module")
def run() -> tuple[str, dict[str, Any], list[Any]]:
    rec = Recorder()
    outcome, result, files = run_demand(json.dumps(town()), {"values": {}}, rec)
    return outcome, result, files


def test_runs_all_four_steps_and_reports(run: tuple[str, dict[str, Any], list[Any]]) -> None:
    outcome, result, files = run
    assert outcome == "done"
    assert result["uncalibrated"] is True
    assert result["attribution"] == ATTRIBUTION
    t = result["totals"]
    # Trips: workers × 1.6 + children × 1.7 + people × (1.3 + 0.6), all of the weekday.
    v = library_values()
    people = 8 * 2000 + 800
    expected = (
        (8 * 900 + 350) * v["demand.trip_rate.hbw"]
        + (8 * 300 + 100) * v["demand.trip_rate.hbe"]
        + people * (v["demand.trip_rate.hbo"] + v["demand.trip_rate.nhb"])
    )
    assert t["trips"] == pytest.approx(expected, rel=1e-6)
    assert set(t["by_mode"]) == {"car", "transit", "walk", "cycle"}
    assert all(x > 0 for x in t["by_mode"].values())
    assert sum(t["by_mode"].values()) == pytest.approx(t["trips"], abs=1)
    assert set(t["by_period"]) == {"am", "md", "pm", "ev", "nt"}
    # The feedback loop ran in every period and settled.
    for per in ("am", "md", "pm", "ev"):
        rounds = result["convergence"][per]
        assert rounds and rounds[-1]["road_rgap"] < 0.01
    # The centre zone is found from its job density and draws the most work trips.
    centre = next(z for z in result["zones"] if z["id"] == "z11")
    assert centre["centre"] is True
    assert centre["attractions"]["hbw"] == max(z["attractions"]["hbw"] for z in result["zones"])


def test_loads_the_tram_and_the_roads(run: tuple[str, dict[str, Any], list[Any]]) -> None:
    _, result, _ = run
    line = result["transit"]["lines"][0]
    east = line["patterns"][0]
    # Riders board before the last stop and leave after the first; what boards also alights.
    assert east["boardings"]["day"][-1] == 0
    assert east["alightings"]["day"][0] == 0
    assert sum(east["boardings"]["day"]) == pytest.approx(sum(east["alightings"]["day"]), rel=1e-6)
    assert max(east["load"]["day"]) > 0
    stops = result["transit"]["stops"]
    assert sum(s["boardings"] for s in stops.values()) == pytest.approx(
        sum(sum(p["boardings"]["day"]) for p in line["patterns"]), rel=1e-6
    )
    assert result["transit"]["stops"]["s1"]["boardings"] > 0
    road = result["road"]
    assert road["columns"] == ["link", "direction", "cars_day", "max_vc"]
    assert road["links"] and all(r[2] > 0 for r in road["links"])
    assert result["desire_lines"]


def test_saves_the_od_matrices_as_omx(run: tuple[str, dict[str, Any], list[Any]]) -> None:
    _, result, files = run
    import openmatrix as omx

    f = files[0]
    assert f.name == "od.omx" and f.media_type == "application/x-omx"
    import tempfile
    from pathlib import Path

    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "od.omx"
        p.write_bytes(f.content)
        m = omx.open_file(str(p))
        try:
            assert "transit_am" in m.list_matrices() and "car_day" in m.list_matrices()
            assert float(np.array(m["transit_day"]).sum()) == pytest.approx(
                result["totals"]["by_mode"]["transit"], rel=1e-3
            )
            assert list(m.mapping("zone"))[0] in (b"z00", "z00")
        finally:
            m.close()


def test_a_better_tram_wins_riders() -> None:
    slow = run_demand(json.dumps(town(headway_s=1200)), {"values": {}}, Recorder())[1]
    fast = run_demand(json.dumps(town(headway_s=180)), {"values": {}}, Recorder())[1]
    assert fast["totals"]["by_mode"]["transit"] > slow["totals"]["by_mode"]["transit"]


def test_without_a_line_nobody_rides() -> None:
    outcome, result, _ = run_demand(json.dumps(town(with_line=False)), {"values": {}}, Recorder())
    assert outcome == "done"
    assert result["totals"]["by_mode"]["transit"] == 0
    assert any("public transport" in n for n in result["notes"])


def test_project_values_change_the_result() -> None:
    base = run_demand(json.dumps(town()), {"values": {}}, Recorder())[1]
    fewer_cars = run_demand(
        json.dumps(town()), {"values": {"demand.mode.car_availability": 0.2}}, Recorder()
    )[1]
    share = lambda r: r["totals"]["by_mode"]["car"] / r["totals"]["trips"]  # noqa: E731
    assert share(fewer_cars) < share(base)


def test_stops_when_asked() -> None:
    outcome, _, files = run_demand(json.dumps(town()), {"values": {}}, Recorder(stop_after=2))
    assert outcome == "stopped" and files == []


def test_refuses_bad_input() -> None:
    with pytest.raises(InputError, match="unknown demand value"):
        parse_bundle(json.dumps(town()), {"demand.nonsense": 1})
    with pytest.raises(InputError, match="version 1"):
        parse_bundle(json.dumps({"version": 2}), {})
    bad = town()
    bad["zones"] = bad["zones"][:1]
    with pytest.raises(InputError, match="at least two zones"):
        parse_bundle(json.dumps(bad), {})
    bad = town()
    bad["streets"]["links"][0][1] = 10_000
    with pytest.raises(InputError, match="does not exist"):
        parse_bundle(json.dumps(bad), {})
    bad = town()
    bad["transit"]["lines"][0]["patterns"][0]["stops"][1] = "nowhere"
    with pytest.raises(InputError, match="nowhere"):
        parse_bundle(json.dumps(bad), {})
    with pytest.raises(InputError, match="time periods"):
        run_demand(json.dumps(town()), {"values": {"demand.period.am_end_h": 6.5}}, Recorder())


def test_nested_logit_shares_add_up() -> None:
    v = Values.of({})
    n = 3
    t = np.full((n, n), 10.0)
    sk = steps.Skims(
        car_min=t,
        car_km=t / 2,
        transit_perceived_min=t * 2,
        transit_available=np.ones((n, n), bool),
        transit_ivt_min=t,
        walk_min=t * 3,
        cycle_min=t,
    )
    m = steps.Money(
        vot_per_min={p: 0.2 for p in ("hbw", "hbe", "hbo", "nhb")},
        fare=2.0,
        car_cost_per_km=0.2,
        parking=np.zeros(n),
    )
    c = steps.choose("hbw", sk, m, v)
    total = sum(c.shares.values())
    assert np.allclose(total, 1.0)
    assert (c.composite_min > 0).all()
    # Without a public transport path, its share is zero.
    sk.transit_available[:] = False
    c2 = steps.choose("hbw", sk, m, v)
    assert np.allclose(c2.shares["transit"], 0.0) and np.allclose(sum(c2.shares.values()), 1.0)


def test_production_constrained_distribution_keeps_productions() -> None:
    v = Values.of({})
    prod = np.array([100.0, 0.0, 50.0])
    attr = np.array([10.0, 80.0, 60.0])
    t = np.array([[2.0, 10.0, 20.0], [10.0, 2.0, 10.0], [20.0, 10.0, 2.0]])
    for p in ("hbo", "nhb", "hbe"):
        m = steps.distribute(p, prod, attr, t, v)
        assert np.allclose(m.sum(axis=1), prod)
    m = steps.distribute("hbw", prod, attr * 150 / attr.sum(), t, v)
    assert np.allclose(m.sum(axis=1), prod, rtol=1e-3)
    assert np.allclose(m.sum(axis=0), attr * 150 / attr.sum(), rtol=1e-3)


def town_tiles() -> list[str]:
    """The test town's street grid as two overlapping OSM XML tiles, plus an island and a motorway."""
    n = 7
    nodes = "".join(
        f'<node id="{j * n + i + 1}" lon="{LON0 + i * DX:.7f}" lat="{LAT0 + j * DY:.7f}"/>'
        for j in range(n)
        for i in range(n)
    )
    ways = []
    for j in range(n):
        hw = "primary" if j == 3 else "residential"
        refs = "".join(f'<nd ref="{j * n + i + 1}"/>' for i in range(n))
        ways.append(f'<way id="{100 + j}">{refs}<tag k="highway" v="{hw}"/></way>')
    for i in range(n):
        hw = "primary" if i == 3 else "residential"
        refs = "".join(f'<nd ref="{j * n + i + 1}"/>' for j in range(n))
        tags = f'<tag k="highway" v="{hw}"/>' + ('<tag k="maxspeed" v="30 mph"/>' if i == 3 else "")
        ways.append(f'<way id="{200 + i}">{refs}{tags}</way>')
    # A one-way motorway along the bottom row, and a street island far away.
    motorway = "".join(f'<nd ref="{i + 1}"/>' for i in range(n))
    ways.append(
        f'<way id="300">{motorway}<tag k="highway" v="motorway"/><tag k="oneway" v="yes"/>'
        '<tag k="lanes" v="3"/></way>'
    )
    island = (
        f'<node id="900" lon="{LON0 + 50 * DX:.7f}" lat="{LAT0:.7f}"/>'
        f'<node id="901" lon="{LON0 + 51 * DX:.7f}" lat="{LAT0:.7f}"/>'
        '<way id="400"><nd ref="900"/><nd ref="901"/><tag k="highway" v="residential"/></way>'
    )
    half = len(ways) // 2
    return [
        f"<osm>{nodes}{''.join(ways[: half + 1])}</osm>",
        f"<osm>{nodes}{island}{''.join(ways[half:])}</osm>",
    ]


def test_builds_the_streets_from_openstreetmap_tiles() -> None:
    from mobsim_worker.demand.osm import maxspeed_kmh, streets_from_tiles

    s = streets_from_tiles(town_tiles(), library_values())
    # 7 × 7 grid: 84 links between junctions, plus 6 motorway links; the island is dropped.
    assert len(s["nodes"]) == 49
    assert len(s["links"]) == 90
    moto = [lk for lk in s["links"] if lk[3] == 0]
    assert len(moto) == 6
    assert all(lk[5] == 3 and lk[6] == 0 and lk[7] == 1 and lk[8] == 0 and lk[9] == 0 for lk in moto)
    main = [lk for lk in s["links"] if lk[3] == 2]
    assert sorted({lk[4] for lk in main}) == [48.3, 50.0]  # 30 mph tagged on the north–south main street
    local = [lk for lk in s["links"] if lk[3] == 5]
    assert {lk[4] for lk in local} == {30.0}
    assert all(lk[2] == pytest.approx(400, rel=0.01) for lk in local)
    assert maxspeed_kmh("DE:urban") is None and maxspeed_kmh("50") == 50.0


def test_runs_on_streets_from_tiles() -> None:
    from mobsim_worker.jobs.demand import run_demand_job

    bundle = town()
    del bundle["streets"]
    packed = base64.b64encode(gzip.compress(json.dumps(town_tiles()).encode())).decode()
    outcome, result, files = run_demand_job(
        json.dumps({"tiles_gz": packed}), json.dumps(bundle), {"values": {}}, Recorder()
    )
    assert outcome == "done"
    assert result["totals"]["by_mode"]["transit"] > 0
    assert result["road"]["links"]
    assert [f.name for f in files] == ["od.omx"]


def test_reads_the_street_tiles_in_either_form() -> None:
    from mobsim_worker.jobs.demand import street_tiles

    tiles = ["<osm/>", "<osm></osm>"]
    packed = base64.b64encode(gzip.compress(json.dumps(tiles).encode())).decode()
    assert street_tiles(json.dumps({"tiles_gz": packed})) == tiles
    assert street_tiles(json.dumps({"tiles": tiles})) == tiles
    assert street_tiles("") == []
    with pytest.raises(ValueError, match="cannot be read"):
        street_tiles(json.dumps({"tiles_gz": "not base64 gzip"}))


# ----------------------------------------------------------------------------------------------------
# Catchment effects: cycle facilities, pedestrian streets, step-free stops, bike and ride, shared bikes


def catchment_run(bundle: dict[str, Any], values: dict[str, float] | None = None) -> dict[str, Any]:
    outcome, result, _ = run_demand(json.dumps(bundle), {"values": values or {}}, Recorder())
    assert outcome == "done"
    return result


def with_columns(bundle: dict[str, Any], facility: Any = 0, pedestrian: Any = 0) -> dict[str, Any]:
    """The town with the two catchment columns; ``facility`` and ``pedestrian`` may be functions of a link."""
    f = facility if callable(facility) else (lambda _lk: facility)
    p = pedestrian if callable(pedestrian) else (lambda _lk: pedestrian)
    bundle["streets"]["links"] = [[*lk, f(lk), p(lk)] for lk in bundle["streets"]["links"]]
    return bundle


def test_cycle_tracks_on_the_main_roads_win_cyclists(run: tuple[str, dict[str, Any], list[Any]]) -> None:
    plain = run[1]["totals"]["by_mode"]["cycle"]
    tracks = catchment_run(with_columns(town(), facility=lambda lk: 2 if lk[3] == 2 else 0))
    assert tracks["totals"]["by_mode"]["cycle"] > plain * 1.02
    assert tracks["catchment"]["cycle_track_km"] == pytest.approx(24 * 0.4, rel=0.01)
    # Without tracks, a main road without a bike lane puts cyclists off.
    busy = catchment_run(town(), {"demand.cycle.factor.busy_road": 2.0})
    assert busy["totals"]["by_mode"]["cycle"] < plain


def test_pedestrian_streets_in_the_centre_put_cars_off() -> None:
    def in_centre(lk: list[float]) -> int:
        # Links between nodes of columns and rows 2 to 4: the centre zone's streets.
        a, b = int(lk[0]), int(lk[1])
        return int(all(2 <= k % 7 <= 4 and 2 <= k // 7 <= 4 for k in (a, b)))

    def to_centre(r: dict[str, Any]) -> float:
        return next(z for z in r["zones"] if z["id"] == "z11")["destinations"]["car"]

    plain = catchment_run(with_columns(town()))
    ped = catchment_run(with_columns(town(), pedestrian=in_centre))
    assert to_centre(ped) < to_centre(plain)
    assert ped["catchment"]["pedestrian_km"] > 0


def test_stops_with_steps_lose_riders() -> None:
    plain = catchment_run(town())
    b = town()
    for s in b["transit"]["stops"]:
        s["step_free"] = s["id"] != "s1"
    steps_ = catchment_run(b, {"demand.step_free.share": 0.5})
    assert steps_["transit"]["stops"]["s1"]["boardings"] < plain["transit"]["stops"]["s1"]["boardings"]
    assert steps_["catchment"]["stops_with_steps"] == 1
    assert steps_["catchment"]["stops_step_free"] == 3


def test_bike_parking_at_the_stops_brings_bike_and_ride() -> None:
    b = town()
    b["bikes"] = {"parking": [s["lonlat"] for s in b["transit"]["stops"]], "rental": []}
    r = catchment_run(b)
    c = r["catchment"]
    assert c["bike_parkings"] == 4
    assert c["bike_and_ride"] > 0
    assert c["transit_by_bike_owners"] > 0
    assert r["totals"]["by_mode"]["transit"] >= catchment_run(town())["totals"]["by_mode"]["transit"]


def test_shared_bikes_let_people_without_a_bicycle_cycle() -> None:
    plain = catchment_run(town())
    b = town()
    stations = [z["centroid"] for z in b["zones"]] + [s["lonlat"] for s in b["transit"]["stops"]]
    b["bikes"] = {"parking": [], "rental": stations}
    r = catchment_run(b)
    c = r["catchment"]
    assert c["shared_bike_stations"] == 13
    assert c["shared_bike_trips"] > 0
    assert r["totals"]["by_mode"]["cycle"] > plain["totals"]["by_mode"]["cycle"]
    assert c["shared_bike_to_transit"] >= 0


def test_reads_cycle_facilities_and_street_setups_from_openstreetmap() -> None:
    from mobsim_worker.demand.osm import cycle_facility, streets_from_tiles

    assert cycle_facility({"cycleway:right": "track"}) == 2
    assert cycle_facility({"cycleway": "lane"}) == 1
    assert cycle_facility({"bicycle_road": "yes"}) == 1
    assert cycle_facility({"cycleway": "no"}) == 0
    tiles = town_tiles()
    setups = [
        {"way": 103, "bike_lane": True, "separated": True},  # east–west main street: a track
        {"way": 203, "bike_lane": True},  # north–south main street: a lane
        {"way": 203, "traffic_lanes": 2, "bus_lane": True},
    ]
    s = streets_from_tiles(tiles, library_values(), setups)
    assert all(len(lk) == 13 for lk in s["links"])
    main = [lk for lk in s["links"] if lk[3] == 2]
    assert {lk[11] for lk in main} == {1, 2}
    # The bus lane is not a car lane: one car lane each way remains of 2 traffic lanes plus 2 bus lanes.
    ns = [lk for lk in main if lk[11] == 1]
    assert all(lk[5] == 1 and lk[6] == 1 for lk in ns)
    plain = streets_from_tiles(tiles, library_values())
    assert all(lk[11] == 0 and lk[12] == 0 for lk in plain["links"])


def test_reads_the_bike_points_the_api_stored() -> None:
    from mobsim_worker.jobs.demand import street_bikes

    assert street_bikes(json.dumps({"tiles": [], "bikes": {"parking": [[13, 52]], "rental": []}})) == {
        "parking": [[13, 52]],
        "rental": [],
    }
    assert street_bikes(json.dumps({"tiles": []})) is None
    with pytest.raises(InputError, match="shared-bike"):
        parse_bundle(json.dumps({**town(), "bikes": {"rental": [[500, 1]]}}), {})


def test_notes_about_bike_points_reach_the_result() -> None:
    b = town()
    b["bikes"] = {"parking": [], "rental": [], "notes": ["the GBFS feed answered 404"]}
    assert "the GBFS feed answered 404" in catchment_run(b)["notes"]


# ----------------------------------------------------------------------------------------------------
# Calibration to observed data


def test_calibrates_the_mode_constants_to_observed_shares(run: tuple[str, dict[str, Any], list[Any]]) -> None:
    before = run[1]["totals"]
    total = before["trips"]
    # Percentages this town can reach: few of its zones are near the tram.
    observed = {"car": 35, "transit": 1, "walk": 52, "cycle": 12}
    outcome, r, _ = run_demand(
        json.dumps(town()),
        {"values": {"demand.calibration.max_iterations": 8}, "observed": {"mode_shares": observed}},
        Recorder(),
    )
    assert outcome == "done"
    cal = r["calibration"]
    assert r["uncalibrated"] is False
    shares = {m: r["totals"]["by_mode"][m] / r["totals"]["trips"] for m in observed}
    # Closer to what was observed than before calibration, within a couple of points.
    for m, pct in observed.items():
        assert abs(shares[m] - pct / 100) < 0.03
        assert abs(shares[m] - pct / 100) <= abs(before["by_mode"][m] / total - pct / 100) + 1e-9
    assert set(cal["fitted"]) >= {"demand.mode.asc.transit"}
    assert cal["rounds"][0]["round"] == 1 and len(cal["rounds"]) <= 8
    assert cal["mode_shares"]["transit"]["observed"] == pytest.approx(0.01)


def test_compares_counts_and_fits_the_transit_constant_to_them(
    run: tuple[str, dict[str, Any], list[Any]],
) -> None:
    modelled = sum(sum(p["boardings"]["day"]) for p in run[1]["transit"]["lines"][0]["patterns"])
    counts = [
        {"kind": "line", "id": "Tram 1", "value": round(modelled * 1.5)},
        {"kind": "stop", "id": "s1", "value": run[1]["transit"]["stops"]["s1"]["boardings"] * 1.5},
        {"kind": "stop", "id": "nowhere", "value": 10},
    ]
    _, r, _ = run_demand(
        json.dumps(town()),
        {"values": {"demand.calibration.max_iterations": 6}, "observed": {"counts": counts}},
        Recorder(),
    )
    cal = r["calibration"]
    assert cal["matched"] == 2
    line = cal["counts"][0]
    assert line["modelled"] == pytest.approx(line["observed"], rel=0.1)
    assert cal["counts"][2]["modelled"] is None
    assert cal["rmse_pct"] is not None and cal["rmse_pct"] < 15
    assert cal["geh_under_5_share"] == 1.0
    assert cal["fitted"]["demand.mode.asc.transit"] > library_values()["demand.mode.asc.transit"]


def test_fits_the_deterrence_to_the_mean_car_trip(run: tuple[str, dict[str, Any], list[Any]]) -> None:
    km = run[1]["totals"]["car_km"]
    _, r, _ = run_demand(
        json.dumps(town()),
        {"values": {"demand.calibration.max_iterations": 6}, "observed": {"mean_car_km": km * 0.85}},
        Recorder(),
    )
    cal = r["calibration"]
    assert r["totals"]["car_km"] < km
    assert "demand.deterrence.hbw.exponential" in cal["fitted"]
    # Only the trip length was observed: the result is still uncalibrated as to mode shares and counts.
    assert r["uncalibrated"] is True


def test_reads_the_observed_data() -> None:
    from mobsim_worker.demand.calibrate import geh, parse_observed

    o = parse_observed(
        {"mode_shares": {"car": 50, "transit": 50}, "counts": [{"kind": "line", "id": "A", "value": 3}]}
    )
    assert o is not None and o.mode_shares == {"car": 0.5, "transit": 0.5, "walk": 0.0, "cycle": 0.0}
    assert parse_observed({}) is None and parse_observed(None) is None
    for bad in (
        {"mode_shares": {"boat": 1}},
        {"mode_shares": {"car": 0}},
        {"mean_car_km": -1},
        {"counts": [{"kind": "road", "value": 1}]},
        {"counts": [{"kind": "stop", "id": "x", "value": "many"}]},
    ):
        with pytest.raises(InputError):
            parse_observed(bad)
    assert geh(100, 100) == 0 and geh(150, 100) == pytest.approx(math.sqrt(2 * 50**2 / 250))
