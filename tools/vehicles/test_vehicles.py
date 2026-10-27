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
            str(REPO / "vehicles/_import/2026-10-26"),
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
