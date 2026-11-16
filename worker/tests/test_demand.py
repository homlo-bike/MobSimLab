"""The four-step demand model on a small synthetic town: a street grid, nine zones and one tram line."""

from __future__ import annotations

import base64
import gzip
import json
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
