"""Trip generation, distribution and mode choice (09 §2.1), with transparent formulas.

Generation: productions and attractions per zone and purpose (cross-classification rates per worker, child and
person; attraction weights per job, resident and special generator; a centre uplift), attractions scaled to
the productions. Distribution: gravity model with the gamma deterrence ``f = t^b · e^(c·t)`` on the mode
choice logsum in minutes of in-vehicle time; doubly constrained for home–work trips (AequilibraE
``GravityApplication``, which balances with IPF), production-constrained for the others. Mode choice: nested
logit with car and public transport in one nest and walking and cycling in the other, for four groups of
people (car and bicycle available or not). People without a bicycle may cycle on a shared bike between zones
near a station; people with one also see public transport with bike and ride. A car trip into a zone with
pedestrian streets takes ``demand.pedestrian_zone.car_min`` times the zone's pedestrian share longer.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, replace

import numpy as np
import pandas as pd
from aequilibrae.distribution import GravityApplication, SyntheticGravityModel
from aequilibrae.matrix import AequilibraeMatrix

from mobsim_worker.demand.inputs import MODES, PURPOSES, Bundle, Floats, Values
from mobsim_worker.demand.network import UNREACHABLE

#: Utility given to a mode that cannot make the trip.
NO_WAY = -1e3


@dataclass
class Ends:
    """Daily productions and attractions per purpose, and which zones count as centre."""

    productions: dict[str, Floats]
    attractions: dict[str, Floats]
    cbd: np.ndarray


def centre_zones(bundle: Bundle) -> np.ndarray:
    """Centre zones: marked by the planner, else jobs per km² of at least ``demand.cbd_job_density_km2``."""
    z, v = bundle.zones, bundle.values
    jobs = z.retail_jobs + z.other_jobs
    dense = (
        np.where(z.area_km2 > 0, jobs / np.maximum(z.area_km2, 1e-9), 0.0) >= v["demand.cbd_job_density_km2"]
    )
    return np.array([dense[i] if f is None else f for i, f in enumerate(z.cbd)], dtype=bool)


def generate(bundle: Bundle) -> tuple[Ends, list[str]]:
    """Daily trip ends per zone and purpose; notes for anything the planner should know."""
    z, v = bundle.zones, bundle.values
    notes: list[str] = []
    cbd = centre_zones(bundle)
    uplift = np.where(cbd, v["demand.attraction.cbd_factor"], 1.0)
    jobs = z.retail_jobs + z.other_jobs
    prod = {
        "hbw": z.workers * v["demand.trip_rate.hbw"],
        "hbe": z.children * v["demand.trip_rate.hbe"],
        "hbo": z.population * v["demand.trip_rate.hbo"],
    }
    attr = {
        "hbw": jobs * uplift,
        "hbe": z.pupils.copy(),
        "hbo": (
            z.retail_jobs * v["demand.attraction.per_retail_job"]
            + z.other_jobs * v["demand.attraction.per_other_job"]
            + z.population * v["demand.attraction.per_resident"]
            + z.visits
        )
        * uplift,
    }
    nhb_w = (
        z.retail_jobs * v["demand.attraction.nhb_per_retail_job"]
        + z.other_jobs * v["demand.attraction.nhb_per_other_job"]
        + z.population * v["demand.attraction.nhb_per_resident"]
    ) * uplift
    nhb_total = float(z.population.sum()) * v["demand.trip_rate.nhb"]
    fallback = {
        "hbw": "no zone has jobs, so home–work trips go where people live",
        "hbe": "no zone has a school or university, so education trips go where children live",
        "hbo": "no zone draws home–other trips, so they go where people live",
    }
    for p, msg in fallback.items():
        if attr[p].sum() <= 0 and prod[p].sum() > 0:
            attr[p] = z.population.copy()
            notes.append(msg)
        total = prod[p].sum()
        attr[p] = attr[p] * (total / attr[p].sum()) if attr[p].sum() > 0 else attr[p]
    if nhb_w.sum() <= 0:
        nhb_w = z.population.copy()
    nhb = nhb_w / nhb_w.sum() * nhb_total if nhb_w.sum() > 0 else np.zeros(len(z))
    prod["nhb"] = nhb
    attr["nhb"] = nhb.copy()
    return Ends(productions=prod, attractions=attr, cbd=cbd), notes


@dataclass
class Skims:
    """Skims of one period (minutes; car distance in km); ``UNREACHABLE`` where a mode has no path."""

    car_min: Floats
    car_km: Floats
    transit_perceived_min: Floats
    transit_available: np.ndarray
    transit_ivt_min: Floats
    walk_min: Floats
    cycle_min: Floats
    #: Public transport for people with a bicycle (bike and ride); None when it is the same as without.
    transit_bike_perceived_min: Floats | None = None
    transit_bike_available: np.ndarray | None = None
    #: Shared bike between zones: walks to and from the stations (min), and where it can be used.
    shared_walk_min: Floats | None = None
    shared_available: np.ndarray | None = None


@dataclass
class Money:
    """Values of time and costs in the project currency."""

    vot_per_min: dict[str, float]
    fare: float
    car_cost_per_km: float
    parking: Floats  # per zone, at a trip end
    #: Price of a shared-bike ride.
    shared_fare: float = 0.0
    #: Extra minutes of a car trip ending in each zone (pedestrian streets).
    car_extra_min: Floats | None = None


def money(bundle: Bundle, cbd: np.ndarray, pedestrian: Floats | None = None) -> Money:
    """Value of time from GDP per capita; fares and car costs from 2023 US$ PPP with the PPP factor.

    ``pedestrian`` is each zone's pedestrian share of street length (``network.pedestrian_share``).
    """
    v, e, z = bundle.values, bundle.economy, bundle.zones
    per_hour = e.gdp_per_capita / v["demand.vot.income_hours"]
    vot = {
        p: per_hour * v["demand.vot.share.hbw" if p == "hbw" else "demand.vot.share.other"] / 60.0
        for p in PURPOSES
    }
    usd = e.ppp_per_usd
    parking = np.where(cbd, v["demand.mode.parking_cost_usd"] * usd, 0.0)
    parking = np.where(np.isnan(z.parking), parking, z.parking)
    return Money(
        vot_per_min=vot,
        fare=v["demand.mode.fare_usd"] * usd,
        car_cost_per_km=v["demand.mode.car_cost_per_km_usd"] * usd,
        parking=parking,
        shared_fare=v["demand.shared_bike.fare_usd"] * usd,
        car_extra_min=None if pedestrian is None else pedestrian * v["demand.pedestrian_zone.car_min"],
    )


@dataclass
class Choice:
    """Mode shares of one purpose and period (per OD pair, each mode) and the logsum in minutes."""

    shares: dict[str, Floats]
    composite_min: Floats
    #: Part of the trips (of all modes) that are cycling on a shared bike, and public transport by people with
    #: a bicycle (assigned to the bike-and-ride graph).
    shared_share: Floats | None = None
    transit_bike_share: Floats | None = None
    #: Expected utility of the trip over the modes (logsum, utility units), for the appraisal.
    logsum: Floats | None = None


def utilities(purpose: str, sk: Skims, m: Money, v: Values) -> dict[str, Floats]:
    """Utilities of the four modes for one purpose (``NO_WAY`` where a mode cannot make the trip)."""
    b = v[f"demand.mode.ivt.{purpose}"]
    b_cost = b / m.vot_per_min[purpose] if m.vot_per_min[purpose] > 0 else 0.0
    car_ok = sk.car_min < UNREACHABLE
    extra = 0.0 if m.car_extra_min is None else m.car_extra_min[None, :]
    car = b * (sk.car_min + v["demand.mode.car_terminal_min"] + extra) + b_cost * (
        m.car_cost_per_km * sk.car_km + 0.5 * m.parking[None, :]
    )
    penalty = v["demand.mode.transfer_penalty_min"]
    # The perceived time counts the change penalty at every boarding; the first boarding is not a change.
    transit = v["demand.mode.asc.transit"] + b * (sk.transit_perceived_min - penalty) + b_cost * m.fare
    walk_ok = sk.walk_min < UNREACHABLE
    walk = v["demand.mode.asc.walk"] + b * v["demand.mode.walk_mode_weight"] * sk.walk_min
    cyc_ok = sk.cycle_min < UNREACHABLE
    cycle = v["demand.mode.asc.cycle"] + b * v["demand.mode.cycle_mode_weight"] * sk.cycle_min
    out = {
        "car": np.where(car_ok, car, NO_WAY),
        "transit": np.where(sk.transit_available, transit, NO_WAY),
        "walk": np.where(walk_ok, walk, NO_WAY),
        "cycle": np.where(cyc_ok, cycle, NO_WAY),
    }
    if sk.transit_bike_perceived_min is not None and sk.transit_bike_available is not None:
        tb = v["demand.mode.asc.transit"] + b * (sk.transit_bike_perceived_min - penalty) + b_cost * m.fare
        out["transit_bike"] = np.where(sk.transit_bike_available, tb, NO_WAY)
    if sk.shared_walk_min is not None and sk.shared_available is not None:
        shared = (
            cycle
            + b
            * (v["demand.mode.walk_mode_weight"] * sk.shared_walk_min + v["demand.shared_bike.unlock_min"])
            + b_cost * m.shared_fare
        )
        out["shared"] = np.where(sk.shared_available & cyc_ok, shared, NO_WAY)
    return out


def _nested(u: dict[str, Floats], avail: dict[str, bool], theta: float) -> tuple[dict[str, Floats], Floats]:
    """Nested logit shares and logsum for one group of people (``avail`` drops car or bicycle)."""
    nests = (("car", "transit"), ("walk", "cycle"))
    shares = {k: np.zeros_like(next(iter(u.values()))) for k in MODES}
    nest_ls: list[Floats | None] = []
    for nest in nests:
        members = [k for k in nest if avail[k]]
        if not members:
            nest_ls.append(None)
            continue
        scaled = np.stack([u[k] / theta for k in members])
        top = scaled.max(axis=0)
        ex = np.exp(scaled - top)
        tot = ex.sum(axis=0)
        for k, e in zip(members, ex, strict=True):
            shares[k] = e / tot
        nest_ls.append(theta * (top + np.log(tot)))
    ls_list = [x for x in nest_ls if x is not None]
    stacked = np.stack(ls_list)
    top = stacked.max(axis=0)
    ex = np.exp(stacked - top)
    tot = ex.sum(axis=0)
    logsum = top + np.log(tot)
    j = 0
    for nest, ls in zip(nests, nest_ls, strict=True):
        if ls is None:
            continue
        p_nest = ex[j] / tot
        j += 1
        for k in nest:
            shares[k] = shares[k] * p_nest
    return shares, logsum


def choose(purpose: str, sk: Skims, m: Money, v: Values) -> Choice:
    """Mode shares over the four groups of people and the composite time for distribution (minutes)."""
    u = utilities(purpose, sk, m, v)
    theta = min(max(v["demand.mode.nest_scale"], 0.05), 1.0)
    car_av = v["demand.mode.car_availability"]
    cyc_av = v["demand.mode.cycle_availability"]
    groups = [
        (car_av * cyc_av, True, True),
        (car_av * (1 - cyc_av), True, False),
        ((1 - car_av) * cyc_av, False, True),
        ((1 - car_av) * (1 - cyc_av), False, False),
    ]
    shares = {k: np.zeros_like(u["car"]) for k in MODES}
    shared_share = np.zeros_like(u["car"])
    transit_bike = np.zeros_like(u["car"])
    exp_ls = np.zeros_like(u["car"])
    for weight, car, cyc in groups:
        if weight <= 0:
            continue
        ug = dict(u)
        if cyc and "transit_bike" in u:
            ug["transit"] = u["transit_bike"]
        shared = not cyc and "shared" in u
        if shared:
            ug["cycle"] = u["shared"]
        s, ls = _nested(ug, {"car": car, "transit": True, "walk": True, "cycle": cyc or shared}, theta)
        for k in MODES:
            shares[k] += weight * s[k]
        if shared:
            shared_share += weight * s["cycle"]
        if cyc and "transit_bike" in u:
            transit_bike += weight * s["transit"]
        exp_ls += weight * np.exp(np.minimum(ls, 50.0))
    logsum = np.log(np.maximum(exp_ls, 1e-300))
    b = v[f"demand.mode.ivt.{purpose}"]
    composite = np.maximum(logsum / b, 0.5) if b < 0 else np.full_like(logsum, 0.5)
    return Choice(
        shares=shares,
        composite_min=composite,
        shared_share=shared_share if "shared" in u else None,
        transit_bike_share=transit_bike if "transit_bike" in u else None,
        logsum=logsum,
    )


def without_transit(sk: Skims) -> Skims:
    """The same skims with no public transport at all (the appraisal's reference case)."""
    return replace(
        sk,
        transit_available=np.zeros_like(sk.transit_available, dtype=bool),
        transit_bike_perceived_min=None,
        transit_bike_available=None,
    )


@dataclass
class Gain:
    """What public transport is worth to the trips of one purpose and period (09 §3.3, ADR-0045).

    ``money`` is the change in consumer surplus (logsum change ÷ the time coefficient × value of time, in the
    project currency) of the trips that have another way to travel; ``no_alternative`` counts the trips that
    have none without public transport, which are left out. ``car_trips`` and ``car_km`` are the person trips
    and person-km by car without public transport less those with it.
    """

    money: float
    minutes: float
    no_alternative: float
    car_trips: float
    car_km: float


def gain(purpose: str, sk: Skims, m: Money, v: Values, ch: Choice, trips: Callable[[Floats], Floats]) -> Gain:
    """The appraisal's user benefit of one purpose: the same trips chosen again without public transport.

    ``trips`` turns a share of the purpose's production–attraction matrix into origin–destination trips.
    """
    b = v[f"demand.mode.ivt.{purpose}"]
    zero = Gain(0.0, 0.0, 0.0, 0.0, 0.0)
    if b >= 0 or ch.logsum is None:
        return zero
    ref = choose(purpose, without_transit(sk), m, v)
    if ref.logsum is None:
        return zero
    ok = ref.logsum > NO_WAY / 2
    per_trip_min = np.where(ok, (ch.logsum - ref.logsum) / -b, 0.0)
    minutes = float(trips(per_trip_min).sum())
    lost = float(trips(np.where(ok, 0.0, 1.0)).sum())
    car_with = trips(ch.shares["car"])
    car_without = trips(np.where(ok, ref.shares["car"], ch.shares["car"]))
    km = np.where(sk.car_km < UNREACHABLE, sk.car_km, 0.0)
    return Gain(
        money=minutes * m.vot_per_min[purpose],
        minutes=minutes,
        no_alternative=lost,
        car_trips=float((car_without - car_with).sum()),
        car_km=float(((car_without - car_with) * km).sum()),
    )


def deterrence(purpose: str, t: Floats, v: Values) -> Floats:
    """The gamma deterrence ``t^b · e^(c·t)`` for one purpose."""
    b = v[f"demand.deterrence.{purpose}.power"]
    c = v[f"demand.deterrence.{purpose}.exponential"]
    return np.power(t, b) * np.exp(c * t)


def distribute(purpose: str, prod: Floats, attr: Floats, t: Floats, v: Values) -> Floats:
    """Trips between zones of one purpose: doubly constrained (home–work) or production-constrained."""
    if prod.sum() <= 0:
        return np.zeros_like(t)
    if purpose == "hbw" and attr.sum() > 0:
        return _gravity_doubly(prod, attr * prod.sum() / attr.sum(), t, v)
    w = attr[None, :] * deterrence(purpose, t, v)
    rows = w.sum(axis=1, keepdims=True)
    share = np.divide(w, rows, out=np.zeros_like(w), where=rows > 0)
    return prod[:, None] * share


def _gravity_doubly(prod: Floats, attr: Floats, t: Floats, v: Values) -> Floats:
    """AequilibraE's gamma gravity model, balanced by IPF to the productions and attractions."""
    n = len(prod)
    imp = AequilibraeMatrix()
    imp.create_empty(zones=n, matrix_names=["time"], memory_only=True)
    imp.index[:] = np.arange(1, n + 1)
    imp.matrices[:, :, 0] = t
    imp.computational_view(["time"])
    model = SyntheticGravityModel()
    model.function = "GAMMA"
    model.alpha = v["demand.deterrence.hbw.power"]
    model.beta = -v["demand.deterrence.hbw.exponential"]
    vectors = pd.DataFrame({"p": prod, "a": attr}, index=np.arange(1, n + 1))
    params = {
        "max trip length": -1,
        "max error": 1e-4,
        "max iterations": 200,
        "balancing tolerance": 1e-3 * max(1.0, float(prod.sum())),
        "convergence level": 1e-4,
    }
    g = GravityApplication(
        model=model,
        impedance=imp,
        vectors=vectors,
        row_field="p",
        column_field="a",
        parameters=params,
        nan_as_zero=True,
    )
    g.apply()
    return np.array(g.output.matrix_view, dtype=np.float64).reshape(n, n)
