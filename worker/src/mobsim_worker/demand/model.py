"""The four-step demand model run (ADR-0019, 09 §2).

Generation, distribution, mode choice and assignment, with feedback of congested car times, for the morning
peak, midday, evening peak and evening; the night counts in the weekday total.

Each period loops: skims → distribution → mode choice → road assignment → congested skims, averaging the car
trips of successive rounds (method of successive averages) until they change by less than
``demand.feedback.gap`` or ``demand.feedback.max_iterations`` rounds have run. Public transport is then
assigned by Spiess–Florian optimal strategies. Without observed data every result is marked uncalibrated.
"""

from __future__ import annotations

import tempfile
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, Protocol

import numpy as np

from mobsim_worker.demand import network, roads, steps, transit
from mobsim_worker.demand.inputs import ALL_PERIODS, MODES, PERIODS, PURPOSES, Bundle, Floats, InputError

#: Shown with every result and in every export (AequilibraE's licence asks for it, ADR-0019).
ATTRIBUTION = (
    "Demand model computed with AequilibraE (https://www.aequilibrae.com), "
    "MIT licence with an attribution clause."
)


#: HDF5 compression of the OMX matrices.
ZIP = {"complib": "zlib", "complevel": 4}


def _trips(m: Floats) -> np.ndarray:
    """Trips to a hundredth (smaller cells left out) as 32-bit floats, so the OMX file compresses well."""
    return np.round(m, 2).astype(np.float32)


def r1(x: float) -> float:
    """A number to one decimal, for the result."""
    return round(float(x), 1)


class Reporter(Protocol):
    """Where the run reports to and learns that it should stop (``runner.RunReporter``)."""

    def report(self, step: dict[str, Any], result: dict[str, Any]) -> None:  # noqa: D102
        ...

    def should_stop(self) -> bool:  # noqa: D102
        ...


Outcome = Literal["done", "stopped"]


@dataclass
class RunFile:
    """A file the run saves next to its result (``simulation.run_file``)."""

    name: str
    media_type: str
    content: bytes


@dataclass
class PeriodResult:
    """Trips by mode (origin–destination, persons) and purpose of one period, and its assignments."""

    od: dict[str, Floats]
    by_purpose: dict[str, dict[str, float]]
    road: roads.RoadResult | None = None
    transit_edges: Any = None
    rounds: list[dict[str, float]] = field(default_factory=list)


def period_hours(b: Bundle) -> dict[str, float]:
    """Length of each period in hours, from the period boundaries; the night is what is left of the day."""
    v = b.values
    t = [v["demand.period.am_start_h"], v["demand.period.am_end_h"], v["demand.period.pm_start_h"]]
    t += [v["demand.period.pm_end_h"], v["demand.period.ev_end_h"]]
    if any(b2 <= a for a, b2 in zip(t, t[1:], strict=False)) or t[0] < 0 or t[-1] > 24:
        raise InputError(
            "the time periods must follow each other within the day (Project preferences → Demand)"
        )
    h = {"am": t[1] - t[0], "md": t[2] - t[1], "pm": t[3] - t[2], "ev": t[4] - t[3]}
    h["nt"] = 24.0 - sum(h.values())
    return h


def period_shares(b: Bundle) -> dict[str, dict[str, float]]:
    """Share of each purpose's daily trips in each period, the night taking what is left."""
    v = b.values
    out: dict[str, dict[str, float]] = {}
    for p in PURPOSES:
        s = {per: v[f"demand.period_share.{per}.{p}"] for per in PERIODS}
        total = sum(s.values())
        if total > 1 + 1e-9:
            raise InputError(
                f"the period shares of {p} trips add up to more than 1 (Project preferences → Demand)"
            )
        s["nt"] = max(0.0, 1.0 - total)
        out[p] = s
    return out


def from_home(b: Bundle, purpose: str, period: str) -> float:
    """Share of a period's home-based trips that leave home (the night takes the evening's)."""
    return b.values[f"demand.from_home_share.{'ev' if period == 'nt' else period}.{purpose}"]


def to_od(b: Bundle, purpose: str, period: str, pa: Floats) -> Floats:
    """Production–attraction trips to origin–destination trips."""
    if purpose == "nhb":
        return pa
    f = from_home(b, purpose, period)
    return f * pa + (1.0 - f) * pa.T


def _day(res: dict[str, PeriodResult], mode: str) -> Floats:
    """A mode's trips over the whole weekday (all periods and the night)."""
    return np.sum([res[p].od[mode] for p in ALL_PERIODS], axis=0)


class DemandModel:
    """One run of the model over a bundle."""

    def __init__(self, bundle: Bundle, reporter: Reporter, clock: Callable[[], float] | None = None) -> None:
        """Prepare the networks and the period settings."""
        self.b = bundle
        self.r = reporter
        self.notes = list(bundle.notes)
        self.hours = period_hours(bundle)
        self.shares = period_shares(bundle)
        pts = [bundle.zones.lonlat, bundle.streets.nodes]
        if len(bundle.transit.stop_ids):
            pts.append(bundle.transit.stop_lonlat)
        self.proj = network.Projection(np.vstack(pts))
        self.done_steps: list[str] = []

    def _progress(self, step: str, detail: dict[str, Any] | None = None) -> bool:
        """Report the step; True when the run should stop."""
        self.r.report({"step": step, **(detail or {})}, {"steps_done": list(self.done_steps)})
        return self.r.should_stop()

    def run(self) -> tuple[Outcome, dict[str, Any], list[RunFile]]:
        """Run the model; the outcome, the result and the files (OD matrices in OMX)."""
        b, v = self.b, self.b.values
        if self._progress("skims", {"what": "walking and cycling"}):
            return "stopped", {}, []
        walk_min, cycle_min, walk_dist = network.walk_cycle_skims(b, self.proj)
        car_net = network.car_network(b, self.proj)
        if self._progress("skims", {"what": "car, free flow"}):
            return "stopped", {}, []
        ff_min, ff_km = roads.free_flow(car_net)
        share = v["demand.intrazonal_share"]
        ff_min, ff_km = network.with_intrazonal(ff_min, share), network.with_intrazonal(ff_km, share)
        ends, notes = steps.generate(b)
        self.notes += notes
        money = steps.money(b, ends.cbd)
        self.done_steps.append("generation")
        graphs: dict[str, transit.TransitGraph] = {}
        tsk: dict[str, transit.TransitSkims] = {}
        for per in PERIODS:
            if self._progress("skims", {"what": "public transport", "period": per}):
                return "stopped", {}, []
            graphs[per] = transit.build_graph(b, walk_dist, per)
            tsk[per] = transit.skims(b, graphs[per])
        if not any(t.available.any() for t in tsk.values()):
            self.notes.append("no zone reaches another by public transport; is the network published?")
        results: dict[str, PeriodResult] = {}
        for per in PERIODS:
            pr = self._period(per, car_net, tsk[per], walk_min, cycle_min, ff_min, ff_km, ends, money)
            if pr is None:
                return "stopped", {}, []
            if self._progress("transit assignment", {"period": per}):
                return "stopped", {}, []
            pr.transit_edges = transit.assign(graphs[per], pr.od["transit"])
            results[per] = pr
            self.done_steps.append(per)
        # The night: free-flow roads and the evening's timetable; counted in the weekday total only.
        sk = steps.Skims(
            car_min=ff_min,
            car_km=ff_km,
            transit_perceived_min=tsk["ev"].perceived_min,
            transit_available=tsk["ev"].available,
            transit_ivt_min=tsk["ev"].ivt_min,
            walk_min=walk_min,
            cycle_min=cycle_min,
        )
        night = self._choose_all("nt", sk, ends, money)
        night.transit_edges = transit.assign(graphs["ev"], night.od["transit"])
        results["nt"] = night
        result = self._result(
            results, ends, car_net, graphs, sk_by={"ff_km": ff_km, "walk": walk_min, "cycle": cycle_min}
        )
        files = [self._omx(results)]
        return "done", result, files

    def _choose_all(self, per: str, sk: steps.Skims, ends: steps.Ends, money: steps.Money) -> PeriodResult:
        """Distribution and mode choice of every purpose in one period."""
        b = self.b
        nz = len(b.zones)
        od = {m: np.zeros((nz, nz)) for m in MODES}
        by_purpose: dict[str, dict[str, float]] = {}
        for p in PURPOSES:
            s = self.shares[p][per]
            ch = steps.choose(p, sk, money, b.values)
            pa = steps.distribute(
                p, ends.productions[p] * s, ends.attractions[p] * s, ch.composite_min, b.values
            )
            by_purpose[p] = {}
            for m in MODES:
                trips = to_od(b, p, per, pa * ch.shares[m])
                od[m] += trips
                by_purpose[p][m] = float(trips.sum())
        return PeriodResult(od=od, by_purpose=by_purpose)

    def _period(
        self,
        per: str,
        car_net: network.CarNetwork,
        ts: transit.TransitSkims,
        walk_min: Floats,
        cycle_min: Floats,
        ff_min: Floats,
        ff_km: Floats,
        ends: steps.Ends,
        money: steps.Money,
    ) -> PeriodResult | None:
        v = self.b.values
        share = v["demand.intrazonal_share"]
        car_min, car_km = ff_min, ff_km
        avg: Floats | None = None
        rounds: list[dict[str, float]] = []
        last: PeriodResult | None = None
        road: roads.RoadResult | None = None
        occ = max(v["demand.car_occupancy"], 1e-6)
        hours = max(self.hours[per], 1e-6)
        for k in range(1, int(v["demand.feedback.max_iterations"]) + 1):
            if self._progress("feedback", {"period": per, "round": k, "rounds": rounds}):
                return None
            sk = steps.Skims(
                car_min=car_min,
                car_km=car_km,
                transit_perceived_min=ts.perceived_min,
                transit_available=ts.available,
                transit_ivt_min=ts.ivt_min,
                walk_min=walk_min,
                cycle_min=cycle_min,
            )
            last = self._choose_all(per, sk, ends, money)
            new = last.od["car"]
            if avg is None:
                avg, gap = new.copy(), float("inf")
            else:
                gap = float(np.abs(new - avg).sum() / max(new.sum(), 1e-9))
                avg = avg + (new - avg) / k
            road = roads.assign(car_net, avg / occ / hours, v)
            car_min = network.with_intrazonal(road.car_min, share)
            car_km = network.with_intrazonal(road.car_km, share)
            rounds.append({"round": k, "gap": gap if np.isfinite(gap) else -1.0, "road_rgap": road.rgap})
            if k > 1 and gap < v["demand.feedback.gap"]:
                break
        else:
            if rounds and rounds[-1]["gap"] >= v["demand.feedback.gap"]:
                self.notes.append(
                    f"{per}: the feedback loop stopped after {len(rounds)} rounds with a change of "
                    f"{rounds[-1]['gap']:.1%} in car trips"
                )
        if last is None:
            raise InputError("demand.feedback.max_iterations must be at least 1")
        last.road = road
        last.rounds = rounds
        return last

    # ------------------------------------------------------------------------------------------------------
    # Results

    def _result(
        self,
        res: dict[str, PeriodResult],
        ends: steps.Ends,
        car_net: network.CarNetwork,
        graphs: dict[str, transit.TransitGraph],
        sk_by: dict[str, Floats],
    ) -> dict[str, Any]:
        b = self.b
        z = b.zones
        day = {m: _day(res, m) for m in MODES}
        total = float(sum(d.sum() for d in day.values()))
        by_period = {p: {m: round(float(res[p].od[m].sum()), 1) for m in MODES} for p in ALL_PERIODS}
        by_purpose = {
            pu: {m: round(sum(res[p].by_purpose[pu][m] for p in ALL_PERIODS), 1) for m in MODES}
            for pu in PURPOSES
        }
        zones = []
        for i, zid in enumerate(z.ids):
            zones.append(
                {
                    "id": zid,
                    "centre": bool(ends.cbd[i]),
                    "productions": {p: r1(ends.productions[p][i]) for p in PURPOSES},
                    "attractions": {p: r1(ends.attractions[p][i]) for p in PURPOSES},
                    "origins": {m: r1(day[m][i, :].sum()) for m in MODES},
                    "destinations": {m: r1(day[m][:, i].sum()) for m in MODES},
                }
            )
        # Busiest public transport pairs between different zones (desire lines).
        tr = day["transit"].copy()
        np.fill_diagonal(tr, 0.0)
        flat = np.argsort(tr, axis=None)[::-1][:300]
        desire = []
        for f in flat:
            i, j = divmod(int(f), len(z))
            if tr[i, j] < 1:
                break
            desire.append({"from": z.ids[i], "to": z.ids[j], **{m: r1(day[m][i, j]) for m in MODES}})

        # Mean trip lengths: road distance for car, walk and cycle network times.
        def mean(m: Floats, w: Floats) -> float | None:
            ok = (m < network.UNREACHABLE) & (w > 0)
            return round(float((m[ok] * w[ok]).sum() / w[ok].sum()), 2) if w[ok].sum() > 0 else None

        return {
            "version": 1,
            "uncalibrated": True,
            "attribution": ATTRIBUTION,
            "currency": b.economy.currency,
            "notes": self.notes,
            "zones_count": len(z),
            "period_hours": {p: round(h, 2) for p, h in self.hours.items()},
            "totals": {
                "trips": round(total, 1),
                "by_mode": {m: r1(day[m].sum()) for m in MODES},
                "by_period": by_period,
                "by_purpose": by_purpose,
                "car_km": mean(sk_by["ff_km"], day["car"]),
                "walk_min": mean(sk_by["walk"], day["walk"]),
                "cycle_min": mean(sk_by["cycle"], day["cycle"]),
            },
            "convergence": {p: res[p].rounds for p in PERIODS},
            "zones": zones,
            "desire_lines": desire,
            "road": self._road(res, car_net),
            "transit": self._transit(res),
            "files": ["od.omx"],
        }

    def _road(self, res: dict[str, PeriodResult], car_net: network.CarNetwork) -> dict[str, Any]:
        """Cars a weekday (assigned periods) and highest volume/capacity per street link and direction."""
        n = len(car_net.table)
        daily = np.zeros(n)
        vc = np.zeros(n)
        peak = {}
        for p in PERIODS:
            rr = res[p].road
            if rr is None:
                continue
            daily += rr.flow * self.hours[p]
            vc = np.maximum(vc, rr.vc)
            peak[p] = rr
        keep = (car_net.street_link >= 0) & (daily > 0.5)
        links = [
            [
                int(car_net.street_link[i]),
                int(car_net.street_dir[i]),
                round(float(daily[i])),
                round(float(vc[i]), 3),
            ]
            for i in np.flatnonzero(keep)
        ]
        return {
            "columns": ["link", "direction", "cars_day", "max_vc"],
            "links": links,
            "rgap": {p: round(r.rgap, 6) for p, r in peak.items()},
        }

    def _transit(self, res: dict[str, PeriodResult]) -> dict[str, Any]:
        """Boardings, alightings and loads per line, pattern and stop, by period and for the weekday."""
        t = self.b.transit
        lines: list[dict[str, Any]] = []
        stop_on = np.zeros(len(t.stop_ids))
        stop_off = np.zeros(len(t.stop_ids))
        for li, line in enumerate(t.lines):
            pats = []
            for pi, pat in enumerate(line.patterns):
                n = len(pat.stops)
                out: dict[str, Any] = {"stops": [t.stop_ids[s] for s in pat.stops]}
                for key in ("boardings", "alightings", "load"):
                    out[key] = {}
                day_on, day_off, day_load = np.zeros(n), np.zeros(n), np.zeros(max(n - 1, 0))
                for per in ALL_PERIODS:
                    e = res[per].transit_edges
                    on, off, load = np.zeros(n), np.zeros(n), np.zeros(max(n - 1, 0))
                    if e is not None and len(e):
                        mine = e[(e["line"] == li) & (e["pattern"] == pi)]
                        for kind, arr in (("boarding", on), ("alighting", off), ("on-board", load)):
                            sel = mine[mine["link_type"] == kind]
                            np.add.at(arr, sel["pos"].to_numpy(dtype=np.int64), sel["volume"].to_numpy())
                    day_on += on
                    day_off += off
                    day_load += load
                    if per != "nt":
                        out["boardings"][per] = [round(float(x), 1) for x in on]
                        out["alightings"][per] = [round(float(x), 1) for x in off]
                        out["load"][per] = [round(float(x), 1) for x in load]
                out["boardings"]["day"] = [round(float(x), 1) for x in day_on]
                out["alightings"]["day"] = [round(float(x), 1) for x in day_off]
                out["load"]["day"] = [round(float(x), 1) for x in day_load]
                np.add.at(stop_on, pat.stops, day_on)
                np.add.at(stop_off, pat.stops, day_off)
                pats.append(out)
            lines.append({"id": line.id, "name": line.name, "mode": line.mode, "patterns": pats})
        stops = {
            sid: {
                "name": t.stop_names[i],
                "boardings": round(float(stop_on[i]), 1),
                "alightings": round(float(stop_off[i]), 1),
            }
            for i, sid in enumerate(t.stop_ids)
        }
        return {"lines": lines, "stops": stops}

    def _omx(self, res: dict[str, PeriodResult]) -> RunFile:
        """Origin–destination trips (persons) per mode and period, and for the weekday, as OMX."""
        import openmatrix as omx  # noqa: PLC0415

        z = self.b.zones
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "od.omx"
            f = omx.open_file(str(path), "w")
            try:
                for m in MODES:
                    for p in ALL_PERIODS:
                        f.create_matrix(f"{m}_{p}", obj=_trips(res[p].od[m]), filters=ZIP)
                    f.create_matrix(f"{m}_day", obj=_trips(_day(res, m)), filters=ZIP)
                f.create_mapping("zone", np.array(z.ids, dtype="S"))
                f.attrs["ATTRIBUTION"] = ATTRIBUTION
            finally:
                f.close()
            data = path.read_bytes()
        return RunFile(name="od.omx", media_type="application/x-omx", content=data)


def run_demand(
    network_text: str, settings: dict[str, Any], reporter: Reporter
) -> tuple[Outcome, dict[str, Any], list[RunFile]]:
    """Read a run's bundle and values and run the model.

    Args:
        network_text: The bundle (contracts/demand-input.schema.json) as JSON text.
        settings: The run's settings: ``{"values": {key: number}}`` (the project's demand values).
        reporter: Where progress goes.

    Raises:
        InputError: The bundle or values cannot be used.
    """
    from mobsim_worker.demand.inputs import parse_bundle  # noqa: PLC0415

    bundle = parse_bundle(network_text, settings.get("values"))
    return DemandModel(bundle, reporter).run()
