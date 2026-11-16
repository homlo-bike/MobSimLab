import json
from typing import Any

from mobsim_worker.jobs.calendar import capped_network, expand, run_calendar


class FakeKernel:
    """A kernel that records the periods it runs; the Sunday service day does not fit."""

    def __init__(self) -> None:
        self.periods: list[tuple[float, float]] = []

    def notes(self) -> str:
        return json.dumps(["a note"])

    def run(self, params_json: str) -> str:
        p = json.loads(params_json)
        self.periods.append((p["from_s"], p["to_s"]))
        verdict = "near_limit" if p["from_s"] == 7 * 3600 else "works"
        return json.dumps(
            {
                "verdict": verdict,
                "fleet": {"trips": 300, "vehicles": 12, "peak_out": 10},
                "lines": [
                    {"line": "1", "name": "U1", "planned": {"verdict": verdict, "punctuality": 0.98}},
                ],
            }
        )


class Reporter:
    def __init__(self) -> None:
        self.steps: list[dict[str, Any]] = []
        self.stop_after: int | None = None

    def report(self, step: dict[str, Any], result: dict[str, Any]) -> None:
        self.steps.append(step)

    def should_stop(self) -> bool:
        return self.stop_after is not None and len(self.steps) >= self.stop_after


def day(from_h: float, km: float, riders: float | None) -> dict[str, Any]:
    return {
        "from_s": from_h * 3600,
        "to_s": 24 * 3600,
        "per_day": {
            "vehicle_km": km,
            "vehicle_hours": km / 20,
            "passengers": riders,
            "energy_kwh": km * 2,
            "operating_cost": km * 10,
        },
    }


def plan(periods: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "plan": {
            "mode": "years",
            "day_types": {
                "weekday": day(5, 1000, 50000),
                "saturday": day(5, 800, 30000),
                "sunday": day(7, 600, 20000),
                "holiday": day(7, 600, None),
            },
            "periods": periods,
            "fixed_per_year": {"operating_cost": 1_000_000},
        },
        "params": {"stability_runs": 2, "from_s": 1},
    }


def test_expands_day_figures_by_day_counts() -> None:
    s = plan(
        [
            {"label": "2027", "counts": {"weekday": 255, "saturday": 51, "sunday": 51, "holiday": 8}},
            {"label": "2028", "counts": {"weekday": 256, "saturday": 52, "sunday": 52, "holiday": 6}},
        ]
    )
    rows = expand(s["plan"], s["plan"]["day_types"])
    assert rows[0]["days"] == 365
    assert rows[0]["vehicle_km"] == 255 * 1000 + 51 * 800 + 51 * 600 + 8 * 600
    assert rows[0]["operating_cost"] == rows[0]["vehicle_km"] * 10 + 1_000_000
    # A figure unknown for a day type that occurs is unknown for the period.
    assert rows[0]["passengers"] is None
    only_weekdays = expand(
        {**s["plan"], "periods": [{"label": "x", "counts": {"weekday": 2}, "share_of_year": 2 / 365}]},
        s["plan"]["day_types"],
    )
    assert only_weekdays[0]["passengers"] == 100000
    assert abs(only_weekdays[0]["operating_cost"] - (20000 + 1_000_000 * 2 / 365)) < 1e-6


def test_runs_each_service_day_once_and_keeps_the_worst_verdict() -> None:
    kernel = FakeKernel()
    reporter = Reporter()
    s = plan([{"label": "2027", "counts": {"weekday": 255, "saturday": 51, "sunday": 51, "holiday": 8}}])
    outcome, result = run_calendar(kernel, s, reporter)
    assert outcome == "done"
    # Weekday and Saturday share 05:00–24:00, Sunday and holiday 07:00–24:00; the settings' period
    # is ignored.
    assert kernel.periods == [(5 * 3600, 24 * 3600), (7 * 3600, 24 * 3600)]
    assert result["run"]["verdict"] == "near_limit"
    assert result["day_types"]["sunday"]["rail"]["vehicles"] == 12
    assert result["day_types"]["weekday"]["days"] == 255
    assert result["notes"] == ["a note"]
    assert result["periods"][0]["label"] == "2027"


def test_skips_day_types_without_days_and_runs_without_rail() -> None:
    s = plan([{"label": "2027-05-01", "counts": {"saturday": 1}, "share_of_year": 1 / 365}])
    s["plan"]["mode"] = "date"
    outcome, result = run_calendar(None, s, Reporter())
    assert outcome == "done"
    assert list(result["day_types"]) == ["saturday"]
    assert result["run"]["verdict"] is None
    assert result["periods"][0]["vehicle_km"] == 800


def test_stops_between_days() -> None:
    reporter = Reporter()
    reporter.stop_after = 1
    s = plan([{"label": "2027", "counts": {"weekday": 1, "sunday": 1}}])
    outcome, result = run_calendar(FakeKernel(), s, reporter)
    assert outcome == "stopped"
    assert result["periods"] == []


NETWORK = json.dumps(
    {
        "sections": [
            {
                "id": "a",
                "use": "running",
                "power": {"kind": "overhead", "system": None},
                "speed_kmh": [{"from_m": 0, "to_m": 500, "value": 120}],
            },
            {
                "id": "b",
                "use": "running",
                "power": {"kind": "third_rail", "system": None},
                "speed_kmh": [
                    {"from_m": 0, "to_m": 500, "value": 100},
                    {"from_m": 500, "to_m": 900, "value": 50},
                ],
            },
            {
                "id": "c",
                "use": "storage",
                "power": {"kind": "overhead", "system": None},
                "speed_kmh": [{"from_m": 0, "to_m": 100, "value": 25}],
            },
        ]
    }
)


def speeds(network: str) -> dict[str, list[float]]:
    return {s["id"]: [r["value"] for r in s["speed_kmh"]] for s in json.loads(network)["sections"]}


def test_caps_running_sections_in_heat() -> None:
    hot = capped_network(NETWORK, 60, None)
    assert hot is not None
    assert speeds(hot) == {"a": [60], "b": [60, 50], "c": [25]}
    very_hot = capped_network(NETWORK, 90, 70)
    assert very_hot is not None
    # Only the section under overhead line sags.
    assert speeds(very_hot) == {"a": [70], "b": [90, 50], "c": [25]}
    assert capped_network("example:metro", 60, None) is None


class Factory:
    """Builds fake kernels and remembers the networks they got."""

    def __init__(self) -> None:
        self.networks: list[str] = []
        self.kernels: list[FakeKernel] = []
        self.params: list[dict[str, Any]] = []

    def __call__(self, network: str) -> FakeKernel:
        self.networks.append(network)
        k = FakeKernel()
        outer = self
        original = k.run

        def run(params_json: str) -> str:
            outer.params.append(json.loads(params_json))
            return original(params_json)

        k.run = run  # type: ignore[method-assign]
        self.kernels.append(k)
        return k


def test_runs_weather_variants_and_adds_their_energy() -> None:
    s = plan(
        [
            {
                "label": "2027",
                "counts": {"weekday": 240.5, "weekday.hot": 10, "weekday.very_hot": 2.5, "weekday.cold": 2},
                "share_of_year": 1,
                "extra": {"hvac_kwh": 5000, "switch_heating_kwh": 800},
            }
        ]
    )
    s["plan"]["weather"] = {
        "hot": {"from_s": 12 * 3600, "to_s": 20 * 3600, "speed_cap_kmh": 60, "overhead_cap_kmh": None},
        "very_hot": {"from_s": 12 * 3600, "to_s": 20 * 3600, "speed_cap_kmh": 60, "overhead_cap_kmh": 80},
        "cold": {"delayed_share": 0.4, "primary_delay_mean_s": 300, "primary_delay_max_s": 1800},
    }
    factory = Factory()
    outcome, result = run_calendar(factory, s, Reporter(), NETWORK)
    assert outcome == "done"
    # The project's network, then one capped network per heat variant.
    assert len(factory.networks) == 3
    assert factory.networks[0] == NETWORK
    assert speeds(factory.networks[1])["a"] == [60]
    weekday = result["day_types"]["weekday"]
    assert weekday["days"] == 255
    assert weekday["weather"]["hot"]["days"] == 10
    # Heat restrictions run over their hours only; the cold day runs the whole day with frozen switches.
    assert (weekday["weather"]["hot"]["rail"]["from_s"], weekday["weather"]["hot"]["rail"]["to_s"]) == (
        12 * 3600,
        20 * 3600,
    )
    cold = [p for p in factory.params if p.get("delayed_share") == 0.4]
    assert cold and cold[0]["from_s"] == 5 * 3600 and cold[0]["primary_delay_mean_s"] == 300
    row = result["periods"][0]
    assert row["counts"]["weekday"] == 255
    assert row["weather"] == {"hot": 10, "very_hot": 2.5, "cold": 2}
    assert row["energy_kwh"] == 255 * 2000 + 5800
    assert row["extra"] == {"hvac_kwh": 5000, "switch_heating_kwh": 800}


def test_cold_with_switch_heating_runs_as_an_ordinary_day() -> None:
    s = plan([{"label": "2027", "counts": {"weekday": 250, "weekday.cold": 5}}])
    s["plan"]["weather"] = {"cold": None}
    factory = Factory()
    run_calendar(factory, s, Reporter(), NETWORK)
    assert len(factory.params) == 1
