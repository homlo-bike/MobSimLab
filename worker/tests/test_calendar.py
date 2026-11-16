import json
from typing import Any

from mobsim_worker.jobs.calendar import expand, run_calendar


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
