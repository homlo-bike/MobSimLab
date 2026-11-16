"""Calendar runs (ADR-0020): many years, one date, or a row of dates, from representative day types.

Simulating every day of several years in detail is too slow, so a calendar run simulates one
representative day per day type (weekday, Saturday, Sunday, public holiday) and expands it with the
calendar:

* ``years``: a year's figures are each day type's day figures times the number of days of that type in
  the year (from the project calendar: weekdays, weekends and the public holidays it counts), plus the
  year's fixed operating cost (upkeep and the overheads on it).
* ``date``: one date, simulated as its day type.
* ``days``: every date from a first to a last one, each as its day type. Each day starts from the depot
  as planned; the kernel does not carry trains, delays or charge from one day to the next.

The rail service of each day type is run in the rail capacity kernel over that day type's service day
(first to last departure), once per distinct service day and service: its verdict, trains and punctuality
tell whether that day works. A day type whose lines run their own times (Saturday, Sunday or holiday
headways and first and last departures) brings its own service lines, and runs on a kernel with them.
The day figures (vehicle-km, vehicle-hours, passengers, energy, operating cost) come with the run, worked
out by the web app from the same models as the Tables tab, so the run and the tables agree.

Weather (the project's monthly climate) splits each day type into variants: ``weekday`` (an ordinary day),
``weekday.hot``, ``weekday.very_hot`` and ``weekday.cold``, with expected (fractional) day counts from the
web app. A hot variant runs the rail service again over the hours of heat speed restrictions with every
running section capped at the restriction speed (buckling risk on welded track) and, on a very hot day,
the sections under overhead line capped at the sag speed. A cold variant without switch heating runs the
day again with more and longer primary delays (frozen switches); with switch heating it runs as an ordinary
day. The extra energy of the weather (heating and air conditioning on board, switch heating) comes per
period from the web app and is added to the period's energy.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

from mobsim_worker.jobs.capacity import CapacityKernel, Outcome, Reporter
from mobsim_worker.jobs.sweep import VERDICTS

#: Day types of the project calendar (apps/web/src/workspace/calendar.ts ``DAY_TYPES``).
DAY_TYPES = ("weekday", "saturday", "sunday", "holiday")

#: Figures of a day, summed over a period.
FIGURES = ("vehicle_km", "vehicle_hours", "passengers", "energy_kwh", "operating_cost")

#: Weather variants of a day type (``<day type>.<variant>`` in the day counts).
VARIANTS = ("hot", "very_hot", "cold")

#: Builds the kernel for a network (the topology export as JSON text, or the example's name) and, when given,
#: service lines of its own (JSON text); without them the run's lines.
KernelFactory = Callable[..., CapacityKernel]


def base_of(key: str) -> str:
    """The day type of a day count key (``weekday.hot`` → ``weekday``)."""
    return key.split(".", 1)[0]


def variant_of(key: str) -> str | None:
    """The weather variant of a day count key, or None for an ordinary day."""
    return key.split(".", 1)[1] if "." in key else None


def capped_network(network: str, speed_cap_kmh: float | None, overhead_cap_kmh: float | None) -> str | None:
    """The network with every running section's speed limits capped (heat speed restrictions).

    Args:
        network: The railway editor's topology export (contracts/rail-topology.schema.json), JSON text.
        speed_cap_kmh: Cap on every running section (buckling risk on welded track), or None.
        overhead_cap_kmh: Cap on the running sections under overhead line (sag), or None.

    Returns:
        The capped network as JSON text, or None when the network is not a topology export (the example).
        Sections without speed ranges keep the kernel's default.
    """
    try:
        doc = json.loads(network)
    except ValueError:
        return None
    if not isinstance(doc, dict):
        return None
    for s in doc.get("sections", []):
        if s.get("use") != "running":
            continue
        caps = [c for c in (speed_cap_kmh,) if c is not None]
        if overhead_cap_kmh is not None and (s.get("power") or {}).get("kind") == "overhead":
            caps.append(overhead_cap_kmh)
        if not caps:
            continue
        cap = min(caps)
        for r in s.get("speed_kmh", []):
            r["value"] = min(float(r["value"]), cap)
    return json.dumps(doc)


def _worst(verdicts: list[str]) -> str | None:
    known = [v for v in verdicts if v in VERDICTS]
    return max(known, key=VERDICTS.index) if known else None


def _day_summary(run: dict[str, Any]) -> dict[str, Any]:
    """What a calendar run keeps of a representative day's capacity run."""
    fleet = run.get("fleet") or {}
    lines = []
    for lr in run.get("lines", []):
        p = lr.get("planned") or {}
        lines.append(
            {
                "line": lr.get("line"),
                "name": lr.get("name"),
                "verdict": p.get("verdict"),
                "punctuality": p.get("punctuality"),
                "disturbed_punctuality": p.get("disturbed_punctuality"),
                "consumption": p.get("consumption"),
                "unplaced": p.get("unplaced"),
            }
        )
    return {
        "verdict": run.get("verdict"),
        "trips": fleet.get("trips"),
        "vehicles": fleet.get("vehicles"),
        "peak_out": fleet.get("peak_out"),
        "lines": lines,
    }


def expand(plan: dict[str, Any], days: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Each period's day counts and figures: day figures times day counts, plus the fixed operating cost.

    Args:
        plan: The run's plan: ``periods`` (``label``, ``counts`` per day type and weather variant, expected
            days that may be fractional, ``share_of_year`` of the fixed cost, ``extra`` energy of the
            weather), ``fixed_per_year`` (``operating_cost``).
        days: Per day type, ``per_day`` figures (a figure may be null when it is unknown). A weather variant
            has its day type's figures.

    Returns:
        One row per period: ``label``, ``counts`` (per day type, all its variants), ``weather`` (days per
        variant), ``days``, each figure's total (null when any day type that occurs has it unknown) and
        ``extra`` (the weather's energy, kWh, included in ``energy_kwh``).
    """
    fixed = (plan.get("fixed_per_year") or {}).get("operating_cost")
    out = []
    for period in plan["periods"]:
        raw = {k: float(v) for k, v in period["counts"].items() if float(v) > 0}
        counts = {dt: sum(n for k, n in raw.items() if base_of(k) == dt) for dt in DAY_TYPES}
        weather = {v: sum(n for k, n in raw.items() if variant_of(k) == v) for v in VARIANTS}
        totals: dict[str, float | None] = {}
        for f in FIGURES:
            total: float | None = 0.0
            for dt, n in counts.items():
                if n == 0:
                    continue
                v = (days.get(dt) or {}).get("per_day", {}).get(f)
                if v is None:
                    total = None
                    break
                total += float(v) * n  # type: ignore[operator]
            totals[f] = total
        if totals["operating_cost"] is not None and fixed is not None:
            totals["operating_cost"] += float(fixed) * float(period.get("share_of_year", 1.0))
        extra = {k: float(v) for k, v in (period.get("extra") or {}).items()}
        if totals["energy_kwh"] is not None:
            totals["energy_kwh"] += sum(extra.values())
        out.append(
            {
                "label": period["label"],
                "counts": counts,
                "weather": weather,
                "days": sum(counts.values()),
                **totals,
                "extra": extra,
            }
        )
    return out


def _overlap(a: tuple[float, float], b: tuple[float, float]) -> tuple[float, float] | None:
    lo, hi = max(a[0], b[0]), min(a[1], b[1])
    return (lo, hi) if hi > lo else None


def run_calendar(
    kernel: CapacityKernel | KernelFactory | None,
    settings: dict[str, Any],
    reporter: Reporter,
    network: str | None = None,
) -> tuple[Outcome, dict[str, Any]]:
    """Run each day type's representative day and its weather variants, and expand over the periods.

    Args:
        kernel: The rail network and its lines, or a factory that builds the kernel for a network (needed
            for the heat variants, which run on a capped network), or None when the project has no rail
            service to run.
        settings: The stored input: ``params`` (``CapacityParams`` other than the period) and ``plan``:
            ``mode`` (years, date or days), ``day_types`` (per day type: ``from_s``, ``to_s``, ``per_day``
            and, when its lines run their own times, ``lines``: its service lines as JSON text),
            ``periods``, ``fixed_per_year`` and ``weather`` (``hot``, ``very_hot``: the restriction
            hours ``from_s``, ``to_s`` and the caps ``speed_cap_kmh``, ``overhead_cap_kmh``; ``cold``: the
            stability test's ``delayed_share``, ``primary_delay_mean_s``, ``primary_delay_max_s`` without
            switch heating, or null with it).
        reporter: Gets the progress after every step and says when to stop.
        network: The project's network (JSON text), which a factory builds and the heat variants cap.

    Returns:
        ``"done"`` or ``"stopped"``, with ``{"mode", "notes", "run": {"verdict"}, "day_types", "periods"}``.
        Each day type has ``days`` and ``rail`` (an ordinary day) and, per weather variant that occurs,
        ``weather[variant]``: ``days`` and ``rail`` (the variant's run, or the ordinary day's when the
        weather does not change the rail service).
    """
    plan = settings["plan"]
    weather_plan: dict[str, Any] = plan.get("weather") or {}
    params = {k: v for k, v in dict(settings.get("params") or {}).items() if k not in ("from_s", "to_s")}
    keys = {k for p in plan["periods"] for k, n in p["counts"].items() if float(n) > 0}
    used = [dt for dt in DAY_TYPES if any(base_of(k) == dt for k in keys)]

    def days_of(key: str) -> float:
        return sum(float(p["counts"].get(key, 0)) for p in plan["periods"])

    day_types: dict[str, dict[str, Any]] = {}
    for dt in used:
        entry: dict[str, Any] = {
            **{k: v for k, v in plan["day_types"][dt].items() if k != "lines"},
            "days": sum(days_of(k) for k in keys if base_of(k) == dt),
        }
        variants = {v: {"days": days_of(f"{dt}.{v}")} for v in VARIANTS if f"{dt}.{v}" in keys}
        if variants:
            entry["weather"] = variants
        day_types[dt] = entry
    factory: KernelFactory | None = None
    base_kernel: CapacityKernel | None = None
    if callable(kernel) and not hasattr(kernel, "run"):
        if network is not None:
            factory = kernel
            base_kernel = factory(network)
    elif kernel is not None:
        base_kernel = kernel  # type: ignore[assignment]
    result: dict[str, Any] = {
        "mode": plan["mode"],
        "notes": json.loads(base_kernel.notes()) if base_kernel is not None else [],
        "run": {"verdict": None},
        "day_types": day_types,
        "periods": [],
    }
    if base_kernel is not None:
        steps: list[tuple[str, str | None]] = []
        for dt in used:
            steps.append((dt, None))
            steps += [(dt, v) for v in day_types[dt].get("weather", {})]
        done: dict[tuple[Any, ...], dict[str, Any]] = {}
        kernels: dict[tuple[str, str | None], CapacityKernel] = {}
        if factory is not None and network is not None:
            kernels[("ordinary", None)] = base_kernel

        def kernel_for(label: str, net: str, own: str | None) -> CapacityKernel:
            """The kernel of a network (the project's, or a heat variant's capped one) with own lines."""
            if (label, own) not in kernels:
                kernels[(label, own)] = factory(net, own) if own is not None else factory(net)  # type: ignore[misc]
            return kernels[(label, own)]

        day_kernels: dict[str, CapacityKernel] = {}
        for dt in used:
            own = plan["day_types"][dt].get("lines")
            ready = own and factory is not None and network is not None
            day_kernels[dt] = kernel_for("ordinary", network, own) if ready else base_kernel  # type: ignore[arg-type]
        verdicts: list[str] = []
        for n, (dt, variant) in enumerate(steps, start=1):
            if reporter.should_stop():
                return "stopped", result
            reporter.report(
                {"step": "day", "day_type": dt, "variant": variant, "n": n, "total": len(steps)}, result
            )
            window = (float(day_types[dt]["from_s"]), float(day_types[dt]["to_s"]))
            own = plan["day_types"][dt].get("lines") if day_kernels[dt] is not base_kernel else None
            run_kernel, run_params, key = day_kernels[dt], params, ("ordinary", window, own)
            w = weather_plan.get(variant) if variant else None
            if variant in ("hot", "very_hot") and w and factory is not None:
                hours = _overlap(window, (float(w["from_s"]), float(w["to_s"])))
                caps = (w.get("speed_cap_kmh"), w.get("overhead_cap_kmh"))
                capped = capped_network(network, *caps) if network is not None else None
                if hours is not None and caps != (None, None) and capped is not None:
                    run_kernel, window, key = kernel_for(variant, capped, own), hours, (variant, hours, own)
            elif variant == "cold" and w:
                frost = ("delayed_share", "primary_delay_mean_s", "primary_delay_max_s")
                run_params = {**params, **{k: w[k] for k in frost if k in w}}
                key = ("cold", window, own)
            if key not in done:
                raw = run_kernel.run(json.dumps({**run_params, "from_s": window[0], "to_s": window[1]}))
                done[key] = {**_day_summary(json.loads(raw)), "from_s": window[0], "to_s": window[1]}
            summary = done[key]
            verdicts.append(summary["verdict"])
            if variant is None:
                day_types[dt]["rail"] = summary
            else:
                day_types[dt]["weather"][variant]["rail"] = summary
        result["run"]["verdict"] = _worst(verdicts)
    reporter.report({"step": "expanding"}, result)
    result["periods"] = expand(plan, day_types)
    return "done", result
