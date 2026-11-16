"""What a demand run is given: the zones, the street network, the public transport network and the values.

The web app's Demand section assembles the bundle (contracts/demand-input.schema.json) from the project: its
zones with their people, jobs and special generators, the streets of the model area (OpenStreetMap through the
street network service), the published lines with their headways per period, and the country's GDP per capita
and PPP factor. The values are the project's demand values (Project preferences); any key a run does not set
takes the assumption library's central value (``defaults.json``, exported by tools/demand/export_defaults.py).
"""

from __future__ import annotations

import json
import math
from collections.abc import Iterable
from dataclasses import dataclass, field
from importlib import resources
from typing import Any

import numpy as np
from numpy.typing import NDArray

PURPOSES = ("hbw", "hbe", "hbo", "nhb")
#: Periods that are assigned, then the night, which counts in the weekday total only.
PERIODS = ("am", "md", "pm", "ev")
ALL_PERIODS = (*PERIODS, "nt")
MODES = ("car", "transit", "walk", "cycle")
ROAD_CLASSES = ("motorway", "trunk", "primary", "secondary", "tertiary", "local")

#: Largest bundle a run accepts, in zones, street links and transit stops.
MAX_ZONES = 3000
MAX_LINKS = 400_000
MAX_STOPS = 20_000

Floats = NDArray[np.float64]


class InputError(ValueError):
    """The bundle cannot be used; the message says why, for the planner."""


def library_values() -> dict[str, float]:
    """The assumption library's central value of every demand parameter."""
    text = resources.files("mobsim_worker.demand").joinpath("defaults.json").read_text(encoding="utf-8")
    return {k: float(v) for k, v in json.loads(text)["values"].items()}


@dataclass(frozen=True)
class Values:
    """The values of a run: the project's, with the library's for every key the run does not set."""

    values: dict[str, float]

    @classmethod
    def of(cls, given: dict[str, Any] | None) -> Values:
        """Merge the run's values over the library's. Unknown keys are refused, so a typo is not ignored."""
        lib = library_values()
        out = dict(lib)
        for k, v in (given or {}).items():
            if k not in lib:
                raise InputError(f"unknown demand value {k!r}")
            if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v):
                raise InputError(f"demand value {k!r} must be a number")
            out[k] = float(v)
        return cls(out)

    def __getitem__(self, key: str) -> float:
        """One value by key."""
        return self.values[key]


@dataclass
class Zones:
    """The zones, as columns. Counts of special generators may come with the zone's own number of trips."""

    ids: list[str]
    names: list[str]
    lonlat: Floats  # (Z, 2)
    area_km2: Floats
    population: Floats
    workers: Floats
    children: Floats
    retail_jobs: Floats
    other_jobs: Floats
    #: Pupils and students the zone draws (schools and universities, with the library's sizes where unknown).
    pupils: Floats
    #: Visitor trips a weekday to the zone's hospitals, clinics and tourist attractions.
    visits: Floats
    #: Whether the planner marked the zone as centre (True/False), or None to decide from its job density.
    cbd: list[bool | None]
    #: The zone's own parking cost at a trip end, in the project currency, or NaN for the default.
    parking: Floats

    def __len__(self) -> int:
        """Number of zones."""
        return len(self.ids)


@dataclass
class Streets:
    """The street network: nodes in degrees, links with their class, speed, lanes and who may use them."""

    nodes: Floats  # (N, 2) lon, lat
    a: NDArray[np.int64]
    b: NDArray[np.int64]
    length_m: Floats
    road_class: NDArray[np.int64]  # index into ROAD_CLASSES
    speed_kmh: Floats
    lanes_fwd: Floats  # 0: not tagged
    lanes_bwd: Floats
    car_fwd: NDArray[np.bool_]
    car_bwd: NDArray[np.bool_]
    walk: NDArray[np.bool_]
    cycle: NDArray[np.bool_]


@dataclass
class Pattern:
    """One stopping pattern of a line: its stops in order, running times between them, headways by period."""

    stops: list[int]  # indices into Transit.stop_ids
    run_s: list[float]
    headway_s: dict[str, float | None]


@dataclass
class Line:
    """A line with its patterns."""

    id: str
    name: str
    mode: str
    patterns: list[Pattern]


@dataclass
class Transit:
    """The published public transport network."""

    stop_ids: list[str]
    stop_names: list[str]
    stop_lonlat: Floats  # (S, 2)
    stop_mode: list[str]
    lines: list[Line]
    #: Walk to a stop most riders accept, by mode (mode.catchment_m), m.
    catchment_m: dict[str, float]
    #: Catchment for a mode the run did not give, m.
    default_catchment_m: float = 400.0


@dataclass
class Economy:
    """Money of the project: GDP per capita in its currency and how much of it buys one US$ (PPP)."""

    currency: str
    gdp_per_capita: float
    ppp_per_usd: float


@dataclass
class Bundle:
    """Everything a demand run is given."""

    zones: Zones
    streets: Streets
    transit: Transit
    economy: Economy
    values: Values
    notes: list[str] = field(default_factory=list)


def _num(v: Any, what: str, default: float | None = None, minimum: float | None = 0.0) -> float:
    if v is None and default is not None:
        return default
    if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v):
        raise InputError(f"{what} must be a number")
    if minimum is not None and v < minimum:
        raise InputError(f"{what} must be at least {minimum}")
    return float(v)


def _lonlat(v: Any, what: str) -> tuple[float, float]:
    if not (isinstance(v, (list, tuple)) and len(v) == 2):
        raise InputError(f"{what} must be [longitude, latitude]")
    lon = _num(v[0], what, minimum=-180)
    lat = _num(v[1], what, minimum=-90)
    if lon > 180 or lat > 90:
        raise InputError(f"{what} is not a longitude and latitude")
    return lon, lat


def parse_zones(raw: Any, values: Values) -> Zones:
    """Read the zones and turn special generators into pupils and visits with the library's sizes."""
    if not isinstance(raw, list) or len(raw) < 2:
        raise InputError("the model needs at least two zones")
    if len(raw) > MAX_ZONES:
        raise InputError(f"the model has {len(raw)} zones; at most {MAX_ZONES} can be run")
    cols: dict[str, list[float]] = {
        k: []
        for k in (
            "area_km2",
            "population",
            "workers",
            "children",
            "retail_jobs",
            "other_jobs",
            "pupils",
            "visits",
            "parking",
        )
    }
    ids: list[str] = []
    names: list[str] = []
    lonlat: list[tuple[float, float]] = []
    cbd: list[bool | None] = []
    for i, z in enumerate(raw):
        if not isinstance(z, dict):
            raise InputError(f"zone {i + 1} is not an object")
        zid = str(z.get("id", ""))
        if not zid or zid in ids:
            raise InputError(f"zone {i + 1} needs its own id")
        ids.append(zid)
        names.append(str(z.get("name") or zid))
        lonlat.append(_lonlat(z.get("centroid"), f"zone {zid} centroid"))
        w = f"zone {zid}"
        cols["area_km2"].append(_num(z.get("area_km2"), f"{w} area", 0.0))
        for k in ("population", "workers", "children", "retail_jobs", "other_jobs"):
            cols[k].append(_num(z.get(k), f"{w} {k.replace('_', ' ')}", 0.0))
        schools = _num(z.get("schools"), f"{w} schools", 0.0)
        unis = _num(z.get("universities"), f"{w} universities", 0.0)
        pupils = z.get("pupils")
        cols["pupils"].append(
            _num(pupils, f"{w} pupils")
            if pupils is not None
            else schools * values["demand.attraction.school_pupils"]
            + unis * values["demand.attraction.university_students"]
        )
        visits = z.get("visits")
        cols["visits"].append(
            _num(visits, f"{w} visits")
            if visits is not None
            else _num(z.get("hospitals"), f"{w} hospitals", 0.0) * values["demand.attraction.hospital_visits"]
            + _num(z.get("clinics"), f"{w} clinics", 0.0) * values["demand.attraction.clinic_visits"]
            + _num(z.get("tourism"), f"{w} tourist attractions", 0.0)
            * values["demand.attraction.tourism_visits"]
        )
        flag = z.get("cbd")
        if flag is not None and not isinstance(flag, bool):
            raise InputError(f"{w} centre flag must be true, false or null")
        cbd.append(flag)
        park = z.get("parking_cost")
        cols["parking"].append(math.nan if park is None else _num(park, f"{w} parking cost"))
    arr = {k: np.asarray(v, dtype=np.float64) for k, v in cols.items()}
    return Zones(ids=ids, names=names, lonlat=np.asarray(lonlat, dtype=np.float64), cbd=cbd, **arr)


def parse_streets(raw: Any, n_zones: int) -> Streets:
    """Read the street network: ``{"nodes": [[lon, lat]], "links": [[a, b, length_m, class, speed_kmh,
    lanes_fwd, lanes_bwd, car_fwd, car_bwd, walk, cycle]]}``.
    """  # noqa: D205
    if not isinstance(raw, dict):
        raise InputError("the street network is missing")
    nodes = raw.get("nodes")
    links = raw.get("links")
    if not isinstance(nodes, list) or not isinstance(links, list) or not nodes or not links:
        raise InputError("the street network has no streets; load the streets of the model area first")
    if len(links) > MAX_LINKS:
        raise InputError(f"the street network has {len(links)} links; at most {MAX_LINKS} can be run")
    try:
        nd = np.asarray(nodes, dtype=np.float64)
        lk = np.asarray(links, dtype=np.float64)
    except (TypeError, ValueError) as e:
        raise InputError("the street network is not in the expected form") from e
    if nd.ndim != 2 or lk.ndim != 2 or tuple(nd.shape)[1:] != (2,) or tuple(lk.shape)[1:] != (11,):
        raise InputError("the street network is not in the expected form")
    if not np.isfinite(nd).all() or not np.isfinite(lk).all():
        raise InputError("the street network has missing numbers")
    a = lk[:, 0].astype(np.int64)
    b = lk[:, 1].astype(np.int64)
    if a.min() < 0 or b.min() < 0 or max(a.max(), b.max()) >= len(nd):
        raise InputError("a street link names a node that does not exist")
    cls = lk[:, 3].astype(np.int64)
    if cls.min() < 0 or cls.max() >= len(ROAD_CLASSES):
        raise InputError("a street link has an unknown road class")
    del n_zones
    return Streets(
        nodes=nd,
        a=a,
        b=b,
        length_m=np.maximum(lk[:, 2], 1.0),
        road_class=cls,
        speed_kmh=np.clip(lk[:, 4], 5.0, 150.0),
        lanes_fwd=np.maximum(lk[:, 5], 0.0),
        lanes_bwd=np.maximum(lk[:, 6], 0.0),
        car_fwd=lk[:, 7] > 0,
        car_bwd=lk[:, 8] > 0,
        walk=lk[:, 9] > 0,
        cycle=lk[:, 10] > 0,
    )


def parse_transit(raw: Any) -> Transit:
    """Read the published lines: stops, patterns with running times and headways by period."""
    if not isinstance(raw, dict):
        raw = {}
    stops = raw.get("stops") or []
    if not isinstance(stops, list) or len(stops) > MAX_STOPS:
        raise InputError(f"the public transport network has too many stops (at most {MAX_STOPS})")
    ids: list[str] = []
    names: list[str] = []
    lonlat: list[tuple[float, float]] = []
    modes: list[str] = []
    index: dict[str, int] = {}
    for i, s in enumerate(stops):
        if not isinstance(s, dict):
            raise InputError(f"stop {i + 1} is not an object")
        sid = str(s.get("id", ""))
        if not sid or sid in index:
            raise InputError(f"stop {i + 1} needs its own id")
        index[sid] = len(ids)
        ids.append(sid)
        names.append(str(s.get("name") or sid))
        lonlat.append(_lonlat(s.get("lonlat"), f"stop {sid}"))
        modes.append(str(s.get("mode") or "bus"))
    lines: list[Line] = []
    for i, ln in enumerate(raw.get("lines") or []):
        if not isinstance(ln, dict):
            raise InputError(f"line {i + 1} is not an object")
        lid = str(ln.get("id") or f"line-{i + 1}")
        pats: list[Pattern] = []
        for j, p in enumerate(ln.get("patterns") or []):
            where = f"line {lid} pattern {j + 1}"
            st = p.get("stops") if isinstance(p, dict) else None
            run = p.get("run_s") if isinstance(p, dict) else None
            if (
                not isinstance(st, list)
                or not isinstance(run, list)
                or len(st) < 2
                or len(run) != len(st) - 1
            ):
                raise InputError(f"{where} needs at least two stops and a running time between each pair")
            try:
                si = [index[str(x)] for x in st]
            except KeyError as e:
                raise InputError(f"{where} names stop {e.args[0]!r}, which is not in the stop list") from e
            rs = [_num(x, f"{where} running time", minimum=0.0) for x in run]
            hw_raw = p.get("headway_s") or {}
            if not isinstance(hw_raw, dict):
                raise InputError(f"{where} headways must be given by period")
            hw: dict[str, float | None] = {}
            for per in PERIODS:
                v = hw_raw.get(per)
                hw[per] = None if v is None else _num(v, f"{where} headway ({per})", minimum=30.0)
            pats.append(Pattern(stops=si, run_s=rs, headway_s=hw))
        lines.append(
            Line(id=lid, name=str(ln.get("name") or lid), mode=str(ln.get("mode") or "bus"), patterns=pats)
        )
    catch_raw = raw.get("catchment_m") or {}
    catch = {str(k): _num(v, f"catchment of {k}", minimum=50.0) for k, v in catch_raw.items()}
    return Transit(
        stop_ids=ids,
        stop_names=names,
        stop_lonlat=np.asarray(lonlat, dtype=np.float64).reshape(-1, 2),
        stop_mode=modes,
        lines=lines,
        catchment_m=catch,
        default_catchment_m=catch.get("*", 400.0),
    )


def parse_economy(raw: Any) -> Economy:
    """Read the project's currency, GDP per capita and PPP factor."""
    if not isinstance(raw, dict):
        raise InputError("the country figures (GDP per capita and PPP factor) are missing")
    return Economy(
        currency=str(raw.get("currency") or ""),
        gdp_per_capita=_num(raw.get("gdp_per_capita"), "GDP per capita", minimum=1e-9),
        ppp_per_usd=_num(raw.get("ppp_per_usd"), "PPP factor", minimum=1e-9),
    )


def parse_bundle(
    text: str, given_values: dict[str, Any] | None, tiles: Iterable[str] | None = None
) -> Bundle:
    """Read and check a run's bundle (JSON text) and values.

    A bundle without ``streets`` takes them from ``tiles``, the OpenStreetMap street tiles of the model area
    that the API stored with the run (``demand.osm``).

    Raises:
        InputError: Something is missing or not in the expected form; the message says what.
    """
    try:
        raw = json.loads(text)
    except json.JSONDecodeError as e:
        raise InputError("the demand model input is not JSON") from e
    if not isinstance(raw, dict) or raw.get("version") != 1:
        raise InputError("the demand model input is not version 1 of contracts/demand-input.schema.json")
    values = Values.of(given_values)
    zones = parse_zones(raw.get("zones"), values)
    streets = raw.get("streets")
    if streets is None and tiles is not None:
        from mobsim_worker.demand.osm import streets_from_tiles  # noqa: PLC0415

        streets = streets_from_tiles(tiles, values)
    return Bundle(
        zones=zones,
        streets=parse_streets(streets, len(zones)),
        transit=parse_transit(raw.get("transit")),
        economy=parse_economy(raw.get("economy")),
        values=values,
    )
