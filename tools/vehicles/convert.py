"""Convert an imported vehicle catalogue into MobSimLab catalogue files.

Reads the flat import format (one JSON file per vehicle under ``<import>/<mode>/``, with
per-group ``sources[].fields`` and ``quality`` blocks), applies looked-up additions from
``vehicles/_import/additions.yaml``, and writes:

- ``vehicles/<mode-folder>/<manufacturer>_<model>.json`` for vehicles whose core fields are
  sourced (ADR-0026), or ``vehicles/_drafts/<mode-folder>/…`` for the rest;
- ``vehicles/_sources/sources.yaml``, the source register the files point at.

Every value becomes a quantity ``{value, unit, assumed, basis, sources, rationale}`` (04 §2.3,
ADR-0018). The conversion is deterministic: the same input gives byte-identical output, so the
import and this script stay the record of how each file was made.

Usage:
    python tools/vehicles/convert.py [--import-dir vehicles/_import/2026-10-26] [--out vehicles]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path
from typing import Any

import yaml

sys.path.insert(0, str(Path(__file__).parent))
from catalogue import CORE_FIELDS, MODE_FOLDERS, core_gaps  # noqa: E402

SCHEMA_VERSION = "1.0.0"
TRADEMARK = (
    "Manufacturer, model and operator names are trademarks of their owners and are used for "
    "identification only."
)
# UUIDv7 timestamp for imported vehicles: the import's access date, 2026-10-26T00:00:00Z.
IMPORT_EPOCH_MS = 1_793_059_200_000

# Lead builder, matched against the start of the import's free-text ``producer``.
MANUFACTURERS: list[tuple[str, str, str]] = [
    (r"Alexander Dennis", "Alexander Dennis", "alexander-dennis"),
    (r"Alstom", "Alstom", "alstom"),
    (r"Bombardier", "Bombardier", "bombardier"),
    (r"BYD", "BYD", "byd"),
    (r"CAF", "CAF", "caf"),
    (r"CRRC", "CRRC", "crrc"),
    (r"Higer", "Higer", "higer"),
    (r"Hitachi", "Hitachi", "hitachi"),
    (r"Hyundai Rotem", "Hyundai Rotem", "hyundai-rotem"),
    (r"Irizar", "Irizar", "irizar"),
    (r"Iveco", "Iveco", "iveco"),
    (r"Karsan", "Karsan", "karsan"),
    (r"Kawasaki", "Kawasaki", "kawasaki"),
    (r"King Long", "King Long", "king-long"),
    (r"Kinki Sharyo", "Kinki Sharyo", "kinki-sharyo"),
    (r"MAN", "MAN", "man"),
    (r"Mercedes-Benz", "Mercedes-Benz", "mercedes-benz"),
    (r"Motor Coach Industries", "MCI", "mci"),
    (r"Otokar", "Otokar", "otokar"),
    (r"PESA", "PESA", "pesa"),
    (r"Scania", "Scania", "scania"),
    (r"Setra", "Setra", "setra"),
    (r"Siemens", "Siemens", "siemens"),
    (r"Škoda", "Škoda", "skoda"),
    (r"Solaris", "Solaris", "solaris"),
    (r"SOR", "SOR", "sor"),
    (r"Stadler", "Stadler", "stadler"),
    (r"Talgo", "Talgo", "talgo"),
    (r"Van Hool", "Van Hool", "van-hool"),
    (r"Yutong", "Yutong", "yutong"),
]

# Import mode -> MobSimLab mode id; some vehicles move by the service they run (08 §1).
MODE_IDS = {m: m for m in MODE_FOLDERS}
COMMUTER = {
    "siemens-class-717",  # Great Northern suburban
    "siemens-mireo-rhine-neckar-3-car",  # S-Bahn Rhein-Neckar
    "stadler-flirt-ns-4-car",  # NS Sprinter
    "crrc-crh6f-8-car",  # commuter variant of CRH6
}

# Import leaf -> (MobSimLab field, unit). Fields under ``consist`` stay grouped.
LEAVES: dict[str, tuple[str, str | None]] = {
    "dimensions.lengthM": ("length", "m"),
    "dimensions.widthM": ("width", "m"),
    "dimensions.heightM": ("height", "m"),
    "dimensions.emptyWeightT": ("weightEmpty", "t"),
    "dimensions.grossWeightT": ("weightLoaded", "t"),
    "dimensions.floorHeightMm": ("floorHeight", "mm"),
    "dimensions.turningCircleM": ("turningCircle", "m"),
    "dimensions.minCurveRadiusM": ("minRadiusHorizontal", "m"),
    "dimensions.axleLoadT": ("axleLoadMax", "t"),
    "consist.cars": ("consist.cars", "count"),
    "consist.articulations": ("consist.articulations", "count"),
    "consist.suspendedModules": ("consist.suspendedModules", "count"),
    "consist.carLengthsM": ("consist.carLengths", "m"),
    "consist.axlePositionsM": ("consist.axlePositions", "m"),
    "consist.bidirectional": ("consist.bidirectional", None),
    "consist.gangway": ("consist.gangway", None),
    "doors.doorsPerSide": ("doorsPerSide", "count"),
    "doors.doorWidthMm": ("doorClearWidth", "mm"),
    "doors.wheelchairSpaces": ("wheelchairSpaces", "count"),
    "doors.bicycleSpaces": ("bicycleSpaces", "count"),
    "capacity.seated": ("seats", "count"),
    "capacity.standing": ("standingQuoted", "count"),
    "capacity.total": ("totalCapacityQuoted", "count"),
    "capacity.standingDensityPersM2": ("standingDensityQuoted", "pers/m2"),
    "performance.maxSpeedKmh": ("topSpeed", "km/h"),
    "performance.tractionPowerKw": ("power", "kW"),
    "performance.accelerationMs2": ("maxAcceleration", "m/s2"),
    "performance.decelerationMs2": ("serviceDeceleration", "m/s2"),
    "energy.batteryKwh": ("batteryCapacity", "kWh"),
    "energy.rangeKm": ("range", "km"),
    "energy.rechargeTimeMin": ("rechargeTime", "min"),
    "energy.fuelL": ("fuelCapacity", "L"),
    "energy.regenerativeBraking": ("regenerativeBraking", None),
    "infrastructure.gaugeMm": ("trackGauge", "mm"),
    "infrastructure.platformHeightsMm": ("platformHeightCompatible", "mm"),
    "operation.automationGrade": ("automationGrade", None),
}

# Output key order: identity, dimensions, capacity, performance, energy, infrastructure, rest.
FIELD_ORDER = [
    "$schema",
    "schemaVersion",
    "id",
    "legacyId",
    "name",
    "manufacturer",
    "builder",
    "model",
    "variant",
    "family",
    "manufacturerCountry",
    "type",
    "mode",
    "yearIntroduced",
    "yearDiscontinued",
    "operators",
    "length",
    "width",
    "height",
    "weightEmpty",
    "weightLoaded",
    "floorHeight",
    "consist",
    "minRadiusHorizontal",
    "turningCircle",
    "axleLoadMax",
    "doorsPerSide",
    "doorClearWidth",
    "seats",
    "standingQuoted",
    "standingDensityQuoted",
    "standingArea",
    "totalCapacityQuoted",
    "wheelchairSpaces",
    "bicycleSpaces",
    "topSpeed",
    "power",
    "maxAcceleration",
    "serviceDeceleration",
    "energySource",
    "supplySystems",
    "onboardEnergy",
    "batteryCapacity",
    "fuelCapacity",
    "range",
    "rechargeTime",
    "regenerativeBraking",
    "trackGauge",
    "platformHeightCompatible",
    "automationGrade",
    "costRecords",
    "livery",
    "notes",
    "draftReason",
    "trademarkNotice",
]

# Import voltage -> EN 50163 nominal voltage token of a supply-system id.
VOLTAGES = {
    "dc_600": "600v-dc",
    "dc_750": "750v-dc",
    "dc_1500": "1500v-dc",
    "dc_3000": "3000v-dc",
    "ac_15k_16_7": "15kv-16-7hz",
    "ac_25k_50": "25kv-50hz",
}

PUBLISHER_PREFIX = {
    "Wikipedia": "wp",
    "Wikipedia (German)": "wp-de",
    "Wikipedia (Hungarian)": "wp-hu",
    "Wikipédia (fr)": "wp-fr",
    "Chinese Wikipedia": "wp-zh",
}

# Planning standing density range used when a source states none (pers/m2): the assumption
# library default (mode.standing_density_ppm2) with the spread of densities manufacturers quote.
DENSITY_ASSUMED = (6.0, 4.0, 3.0)  # gives area low, central, high


def slug(text: str, limit: int = 60) -> str:
    """Return a lowercase ASCII kebab-case slug of ``text``, at most ``limit`` characters."""
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")
    return s[:limit].rstrip("-")


def uuid7_for(key: str) -> str:
    """Return a stable UUIDv7 for ``key``: fixed import timestamp, random bits from SHA-256."""
    h = int.from_bytes(hashlib.sha256(key.encode()).digest()[:10], "big")
    rand_a = h >> 68 & 0xFFF
    rand_b = h & ((1 << 62) - 1)
    n = IMPORT_EPOCH_MS << 80 | 0x7 << 76 | rand_a << 64 | 0b10 << 62 | rand_b
    s = f"{n:032x}"
    return f"{s[:8]}-{s[8:12]}-{s[12:16]}-{s[16:20]}-{s[20:]}"


def manufacturer_of(producer: str) -> tuple[str, str]:
    """Map the import's free-text producer to the lead builder's (name, slug)."""
    for pattern, name, mslug in MANUFACTURERS:
        if re.match(pattern, producer):
            return name, mslug
    raise ValueError(f"unknown producer {producer!r}; add it to MANUFACTURERS")


def licence_of(publisher: str) -> str:
    """Return the licence note for a source; only facts are taken from any source."""
    if "wikip" in publisher.lower():
        return "CC BY-SA 4.0 (text); facts cited only"
    return "Publisher's terms; facts cited only"


class Register:
    """Source register, deduplicated by URL, with stable short ids."""

    def __init__(self) -> None:
        """Start an empty register."""
        self.by_url: dict[str, dict[str, Any]] = {}
        self.ids: set[str] = set()

    def add(self, src: dict[str, Any], checked_via: str = "none", note: str | None = None) -> str:
        """Add ``src`` (import source shape) if its URL is new and return its register id."""
        url = src["url"]
        if url in self.by_url:
            return str(self.by_url[url]["id"])
        publisher = src.get("publisher") or re.sub(r"^https?://(www\.)?([^/]+).*$", r"\2", url)
        prefix = PUBLISHER_PREFIX.get(publisher) or slug(publisher.split("(")[0], 20)
        title = src.get("title") or url
        base = f"{prefix}-{slug(title, 40)}"
        sid, n = base, 2
        while sid in self.ids:
            sid, n = f"{base}-{n}", n + 1
        entry: dict[str, Any] = {
            "id": sid,
            "title": title,
            "publisher": publisher,
            "url": url,
            "licence": licence_of(publisher),
            "access": "free",
            "retrieved": src.get("accessed"),
            "checked_via": checked_via,
            "kind": src.get("kind") or "secondary",
        }
        if src.get("date"):
            entry["date"] = str(src["date"])
        entry["note"] = note or "Imported with the 2026-10-26 catalogue; not re-read in this repository."
        self.by_url[url] = entry
        self.ids.add(sid)
        return sid

    def entries(self) -> list[dict[str, Any]]:
        """Return the register sorted by id."""
        return sorted(self.by_url.values(), key=lambda e: e["id"])


def leaves(d: dict[str, Any], prefix: str = "") -> dict[str, Any]:
    """Flatten nested dicts into ``group.leaf`` paths, dropping nulls."""
    out: dict[str, Any] = {}
    for k, v in d.items():
        if isinstance(v, dict):
            out.update(leaves(v, f"{prefix}{k}."))
        elif v is not None:
            out[f"{prefix}{k}"] = v
    return out


def quantity(value: Any, unit: str | None, basis: str, sources: list[str], rationale: str | None) -> dict:
    """Build an assumed-value record (04 §2.3)."""
    q: dict[str, Any] = {"value": value}
    if unit:
        q["unit"] = unit
    q["assumed"] = basis == "educated-guess"
    q["basis"] = basis
    q["sources"] = sources
    if rationale:
        q["rationale"] = rationale
    return q


def attribute(
    path: str, raw: dict[str, Any], src_ids: list[tuple[dict, str]]
) -> tuple[str, list[str], str | None]:
    """Decide basis, source ids and rationale for one import leaf.

    A source listing the leaf itself makes it ``cited``. A source listing only its group makes it
    ``cited`` when the group's quality is ``published`` and ``documented`` (derived, see notes)
    otherwise. A leaf no source lists is ``documented`` against all of the file's sources.
    """
    group = path.split(".")[0]
    exact = [sid for s, sid in src_ids if path in s["fields"]]
    if exact:
        return "cited", exact, None
    grouped = [sid for s, sid in src_ids if group in s["fields"]]
    kind = (raw.get("quality") or {}).get(group, {}).get("kind")
    if grouped:
        if kind == "derived":
            return "documented", grouped, "Derived from the cited source; see notes."
        return "cited", grouped, None
    return (
        "documented",
        [sid for _, sid in src_ids],
        "Not attributed to one source in the import; see notes.",
    )


def energy_source(energy: dict[str, Any], legacy: str) -> str:
    """Map the import's supply/supplySystems/onboard to the schema's energySource enum."""
    supply = energy.get("supply")
    systems = energy.get("supplySystems") or []
    onboard = energy.get("onboard")
    if supply == "overhead_wire":
        if onboard in ("battery", "diesel"):
            return "dual"
        kinds = {s[:2] for s in systems}
        if kinds == {"ac"}:
            return "overhead-ac"
        if kinds == {"dc"}:
            return "overhead-dc"
        return "overhead-multisystem" if kinds else "overhead"
    return {
        "third_rail": "third-rail",
        "battery": "battery",
        "diesel": "diesel",
        "hydrogen": "hydrogen",
        "gas": "cng",
        "hybrid": "diesel-hybrid",
    }.get(str(supply), "unknown")


def supply_systems(energy: dict[str, Any], mode: str) -> list[str]:
    """Return the supply-system ids (``<collection>-<voltage>``) a vehicle can take power from.

    Collection: ``trolley`` (twin-wire trolleybus line), ``ocl`` (single overhead contact line with
    rail return) or ``third-rail``.
    """
    if energy.get("supply") == "third_rail":
        collection = "third-rail"
    elif mode == "trolleybus":
        collection = "trolley"
    else:
        collection = "ocl"
    return [f"{collection}-{VOLTAGES[v]}" for v in energy["supplySystems"]]


def convert(raw: dict[str, Any], reg: Register, additions: dict[str, Any]) -> tuple[str, str, dict]:
    """Convert one import record; return (mode folder, file name, catalogue record)."""
    legacy = raw["id"]
    mname, mslug = manufacturer_of(raw["producer"])
    model_slug = legacy[len(mslug) + 1 :] if legacy.startswith(mslug + "-") else legacy
    mode = raw["mode"]
    if legacy in COMMUTER:
        mode = "commuter_rail"
    elif raw.get("category") == "high_speed_train":
        mode = "high_speed_rail"

    src_ids = [(s, reg.add(s)) for s in raw.get("sources", [])]
    rec: dict[str, Any] = {
        "$schema": "../../schema/vehicle.schema.json",
        "schemaVersion": SCHEMA_VERSION,
        "id": uuid7_for(legacy),
        "legacyId": legacy,
        "name": f"{mname} {raw['name']}" + (f" ({raw['variant']})" if raw.get("variant") else ""),
        "manufacturer": mname,
        "builder": raw["producer"],
        "model": raw["name"],
    }
    for key in ("variant", "family", "manufacturerCountry"):
        if raw.get(key):
            rec[key] = raw[key]
    rec["type"] = raw["category"].replace("_", "-")
    rec["mode"] = MODE_IDS[mode]
    for key in ("yearIntroduced", "yearDiscontinued"):
        if raw.get(key) is not None:
            rec[key] = raw[key]
    if raw.get("operators"):
        rec["operators"] = raw["operators"]

    flat = leaves(
        {
            k: raw.get(k) or {}
            for k in (
                "dimensions",
                "consist",
                "doors",
                "capacity",
                "performance",
                "energy",
                "infrastructure",
                "operation",
            )
        }
    )
    consist: dict[str, Any] = {}
    for path, value in sorted(flat.items()):
        if path not in LEAVES:
            continue
        field, unit = LEAVES[path]
        basis, sids, why = attribute(path, raw, src_ids)
        if path == "capacity.standing" and why and {"capacity.seated", "capacity.total"} <= flat.keys():
            continue  # unattributed total − seats; derive_capacity rebuilds it with its working
        if (
            path == "capacity.total"
            and why
            and {"capacity.seated", "capacity.standing"} <= flat.keys()
            and flat["capacity.seated"] + flat["capacity.standing"] == value
        ):
            why = f"{flat['capacity.seated']} seats plus {flat['capacity.standing']} standing places."
        q = quantity(value, unit, basis, sids, why)
        if field.startswith("consist."):
            consist[field.split(".", 1)[1]] = q
        else:
            rec[field] = q

    energy = raw.get("energy") or {}
    basis, sids, why = attribute("energy.supply", raw, src_ids)
    if why and energy.get("supplySystems"):
        basis, sids, why = attribute("energy.supplySystems", raw, src_ids)
    rec["energySource"] = quantity(energy_source(energy, legacy), None, basis, sids, why)
    if energy.get("supplySystems"):
        basis, sids, why = attribute("energy.supplySystems", raw, src_ids)
        rec["supplySystems"] = quantity(supply_systems(energy, mode), None, basis, sids, why)
    if energy.get("onboard") and energy["onboard"] != "none":
        basis, sids, why = attribute("energy.onboard", raw, src_ids)
        rec["onboardEnergy"] = quantity(energy["onboard"], None, basis, sids, why)
    if consist:
        rec["consist"] = consist

    apply_additions(rec, additions.get(legacy, []), reg)
    derive_capacity(rec)

    costs = []
    for c in raw.get("costs") or []:
        sid = reg.add({"url": c["url"], "title": c.get("item"), "accessed": None, "kind": "secondary"})
        costs.append(
            {
                "item": c["item"],
                "value": c["amount"],
                "currency": c["currency"],
                "priceBaseYear": c["year"],
                "region": c.get("region"),
                "note": c.get("note"),
                "sources": [sid],
            }
        )
    if costs:
        rec["costRecords"] = costs
    if raw.get("livery"):
        lv = raw["livery"]
        sids = []
        if lv.get("sourceUrl"):
            sids = [reg.add({"url": lv["sourceUrl"], "title": lv.get("operator"), "kind": "secondary"})]
        rec["livery"] = {
            k: lv[k] for k in ("operator", "primary", "secondary", "windows") if lv.get(k) is not None
        } | {
            "assumed": True,
            "basis": "educated-guess",
            "sources": sids,
            "rationale": lv.get("description") or "Colours approximated from photographs.",
        }
    if raw.get("notes"):
        rec["notes"] = raw["notes"]
    rec["trademarkNotice"] = TRADEMARK
    rec = {k: rec[k] for k in sorted(rec, key=lambda k: FIELD_ORDER.index(k) if k in FIELD_ORDER else 999)}
    folder = MODE_FOLDERS[rec["mode"]]
    return folder, f"{mslug}_{model_slug}.json", rec


def apply_additions(rec: dict[str, Any], adds: list[dict[str, Any]], reg: Register) -> None:
    """Apply looked-up values from additions.yaml; they replace imported values of the same field."""
    for a in adds:
        sid = reg.add(
            a["source"],
            checked_via=a["source"].get("checked_via", "direct"),
            note=a["source"].get("note", "Looked up for the catalogue import, 2026-10-27."),
        )
        q = quantity(a["value"], a.get("unit"), a.get("basis", "cited"), [sid], a.get("rationale"))
        if a["field"].startswith("consist."):
            rec.setdefault("consist", {})[a["field"].split(".", 1)[1]] = q
        else:
            rec[a["field"]] = q


def derive_capacity(rec: dict[str, Any]) -> None:
    """Derive standing places and standing area (08 §3 rule 4).

    Standing places quoted = total − seats when only those are given. Standing area = standing ÷
    quoted density; with no quoted density, the area is an assumption over 3–6 pers/m².
    """
    seats, total = rec.get("seats"), rec.get("totalCapacityQuoted")
    if "standingQuoted" not in rec and seats and total:
        rec["standingQuoted"] = quantity(
            total["value"] - seats["value"],
            "count",
            "documented",
            sorted(set(seats["sources"]) | set(total["sources"])),
            f"Total {total['value']} minus {seats['value']} seats.",
        )
    standing = rec.get("standingQuoted")
    if not standing:
        return
    density = rec.get("standingDensityQuoted")
    if density:
        area = round(standing["value"] / density["value"], 1)
        rec["standingArea"] = quantity(
            area,
            "m2",
            "documented",
            sorted(set(standing["sources"]) | set(density["sources"])),
            f"{standing['value']} standing places at the quoted {density['value']} pers/m2.",
        )
        return
    low, central, high = (round(standing["value"] / d, 1) for d in DENSITY_ASSUMED)
    q = quantity(
        central,
        "m2",
        "educated-guess",
        standing["sources"],
        f"{standing['value']} standing places; the source states no density, so 4 pers/m2 is assumed "
        "(range 3-6 pers/m2, the spread of densities manufacturers quote).",
    )
    q.update(low=low, central=central, high=high, distribution="triangular")
    rec["standingArea"] = q


def main(argv: list[str] | None = None) -> int:
    """Run the conversion; return 0 on success."""
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--import-dir", type=Path, default=Path("vehicles/_import/2026-10-26"))
    ap.add_argument("--additions", type=Path, default=Path("vehicles/_import/additions.yaml"))
    ap.add_argument("--out", type=Path, default=Path("vehicles"))
    args = ap.parse_args(argv)

    additions: dict[str, Any] = {}
    if args.additions.exists():
        additions = yaml.safe_load(args.additions.read_text(encoding="utf-8")) or {}
    reg = Register()
    # Remove only files generated from this import, so hand-written vehicles survive a rebuild.
    imported = {p.stem for p in args.import_dir.glob("*/*.json")}
    for folder in set(MODE_FOLDERS.values()):
        for old in [*(args.out / folder).glob("*.json"), *(args.out / "_drafts" / folder).glob("*.json")]:
            if json.loads(old.read_text(encoding="utf-8")).get("legacyId") in imported:
                old.unlink()

    written = drafts = 0
    for path in sorted(args.import_dir.glob("*/*.json")):
        raw = json.loads(path.read_text(encoding="utf-8"))
        folder, name, rec = convert(raw, reg, additions)
        gaps = core_gaps(rec)
        base = args.out / "_drafts" if gaps else args.out
        if gaps:
            rec["$schema"] = "../" + rec["$schema"]
            rec["draftReason"] = "Core fields not sourced: " + ", ".join(gaps)
            drafts += 1
        else:
            written += 1
        target = base / folder / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(rec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    reg_path = args.out / "_sources" / "sources.yaml"
    reg_path.parent.mkdir(parents=True, exist_ok=True)
    header = (
        "# Source register for the vehicle catalogue (CC BY 4.0). Generated by tools/vehicles/convert.py.\n"
        "# Same entry shape as assumptions/sources.yaml. Only facts are taken from these sources.\n"
    )
    reg_path.write_text(
        header + yaml.safe_dump(reg.entries(), allow_unicode=True, sort_keys=False, width=110),
        encoding="utf-8",
    )
    print(f"{written} catalogue files, {drafts} drafts, {len(reg.entries())} sources; core = {CORE_FIELDS}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
