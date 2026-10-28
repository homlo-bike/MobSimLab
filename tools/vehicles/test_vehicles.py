"""Tests for the vehicle catalogue conversion and check."""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import check  # noqa: E402
import convert  # noqa: E402

REPO = Path(__file__).resolve().parents[2]


@pytest.fixture()
def repo(tmp_path: Path) -> Path:
    """A copy of the catalogue, schema and source register to tamper with."""
    shutil.copytree(REPO / "vehicles", tmp_path / "vehicles", ignore=shutil.ignore_patterns("_import"))
    return tmp_path


def first(root: Path) -> Path:
    return sorted((root / "vehicles/tram").glob("*.json"))[0]


def edit(path: Path, fn) -> None:
    rec = json.loads(path.read_text(encoding="utf-8"))
    fn(rec)
    path.write_text(json.dumps(rec), encoding="utf-8")


def test_catalogue_passes() -> None:
    assert check.check(REPO) == []


def test_unknown_source_fails(repo: Path) -> None:
    edit(first(repo), lambda r: r["length"]["sources"].append("no-such-source"))
    assert any("unknown source no-such-source" in p for p in check.check(repo))


def test_assumed_core_field_fails(repo: Path) -> None:
    def assume(r):
        r["width"].update(assumed=True, basis="educated-guess", rationale="x", low=2.2, central=2.3, high=2.4)

    edit(first(repo), assume)
    assert any("core fields not sourced: width" in p for p in check.check(repo))


def test_wrong_folder_fails(repo: Path) -> None:
    edit(first(repo), lambda r: r.update(mode="metro"))
    assert any("does not match folder" in p for p in check.check(repo))


def test_bad_derived_standing_fails(repo: Path) -> None:
    f = repo / "vehicles/tram/siemens_avenio-munich-4-car.json"
    edit(f, lambda r: r["standingArea"].update(value=99.0))
    assert any("standingArea" in p for p in check.check(repo))


def test_cited_value_without_source_fails_schema(repo: Path) -> None:
    edit(first(repo), lambda r: r["length"].update(sources=[]))
    assert check.check(repo)


def test_uuid7_is_stable_and_versioned() -> None:
    a, b = convert.uuid7_for("x"), convert.uuid7_for("x")
    assert a == b and a[14] == "7" and a[19] in "89ab"


def test_supply_systems() -> None:
    assert convert.supply_systems({"supply": "overhead_wire", "supplySystems": ["dc_600"]}, "trolleybus") == [
        "trolley-600v-dc"
    ]
    assert convert.supply_systems({"supply": "third_rail", "supplySystems": ["dc_750"]}, "metro") == [
        "third-rail-750v-dc"
    ]


def test_standing_area_assumed_when_no_density() -> None:
    rec = {
        "seats": convert.quantity(40, "count", "cited", ["s"], None),
        "totalCapacityQuoted": convert.quantity(200, "count", "cited", ["s"], None),
    }
    convert.derive_capacity(rec)
    assert rec["standingQuoted"]["value"] == 160
    area = rec["standingArea"]
    assert area["assumed"] and area["central"] == 40.0 and area["low"] < area["central"] < area["high"]


def test_conversion_is_reproducible(tmp_path: Path) -> None:
    out = tmp_path / "vehicles"
    shutil.copytree(REPO / "vehicles/schema", out / "schema")
    convert.main(
        [
            "--import-dir",
            *[str(d) for d in sorted((REPO / "vehicles/_import").glob("20*/"))],
            "--additions",
            str(REPO / "vehicles/_import/additions.yaml"),
            "--out",
            str(out),
        ]
    )
    for f in out.rglob("*.json"):
        if "schema" in f.parts:
            continue
        rel = f.relative_to(out)
        assert f.read_text(encoding="utf-8") == (REPO / "vehicles" / rel).read_text(encoding="utf-8"), rel


def test_supply_system_ids_checked_against_library(repo: Path) -> None:
    (repo / "assumptions").mkdir()
    (repo / "assumptions/supply-systems.yaml").write_text("- id: ocl-750v-dc\n", encoding="utf-8")
    problems = check.check(repo)
    assert any("trolley-600v-dc is not in" in p for p in problems)
    assert not any("ocl-750v-dc is not in" in p for p in problems)


def test_assumed_seats_make_standing_assumed() -> None:
    seats = convert.quantity(50, "count", "educated-guess", ["s"], "guess")
    seats.update(low=40, central=50, high=60)
    rec = {"seats": seats, "totalCapacityQuoted": convert.quantity(200, "count", "cited", ["s"], None)}
    convert.derive_capacity(rec)
    standing = rec["standingQuoted"]
    assert standing["assumed"] and (standing["low"], standing["high"]) == (140, 160)


def test_every_generated_file_comes_from_an_import() -> None:
    imported = {p.stem for p in (REPO / "vehicles/_import").glob("20*/*/*.json")}
    for f in [*(REPO / "vehicles").glob("*/*.json"), *(REPO / "vehicles/_drafts").glob("*/*.json")]:
        if f.parent.name == "schema":
            continue
        assert json.loads(f.read_text(encoding="utf-8"))["legacyId"] in imported, f


def test_wikipedia_links_cover_known_vehicles() -> None:
    import yaml

    links = yaml.safe_load((REPO / "vehicles/_import/wikipedia.yaml").read_text(encoding="utf-8"))
    paths = [*REPO.glob("vehicles/*/*.json"), *REPO.glob("vehicles/_drafts/*/*.json")]
    legacy = {json.loads(p.read_text(encoding="utf-8")).get("legacyId") for p in paths}
    assert set(links) <= legacy


def test_non_wikipedia_link_fails(repo: Path) -> None:
    link = {"url": "https://example.com/wiki/Tram", "scope": "model", "checked_via": "search"}
    edit(first(repo), lambda r: r.update(wikipedia=link))
    assert any("wikipedia" in p for p in check.check(repo))


def test_schematic_must_exist_and_match(repo: Path) -> None:
    f = first(repo)
    svg = f"vehicles/_schematics/{f.stem}.svg"
    edit(f, lambda r: r.update(schematic={"file": svg, "author": "Homlo", "licence": "CC-BY-4.0"}))
    assert any("does not exist" in p for p in check.check(repo))
    (repo / "vehicles/_schematics").mkdir(exist_ok=True)
    (repo / svg).write_text("<svg xmlns='http://www.w3.org/2000/svg'/>", encoding="utf-8")
    assert not any("schematic" in p for p in check.check(repo))
