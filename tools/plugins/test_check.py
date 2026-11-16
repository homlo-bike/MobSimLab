"""Tests of tools/plugins/check.py: the bundled plugins pass, broken copies fail with clear messages."""

from __future__ import annotations

import importlib.util
import json
import shutil
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("plugin_check", HERE / "check.py")
assert spec and spec.loader
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


@pytest.fixture
def plugins(tmp_path: Path) -> Path:
    """A copy of the bundled plugins to break."""
    dst = tmp_path / "plugins"
    shutil.copytree(check.PLUGINS, dst)
    return dst


def edit(path: Path, f) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    f(data)
    path.write_text(json.dumps(data), encoding="utf-8")


def test_bundled_plugins_pass_and_resolve_values():
    errors, reg = check.build()
    assert errors == []
    ids = [p["id"] for p in reg["plugins"]]
    assert "org.mobsimlab.aerial-lift" in ids and "org.mobsimlab.ferry" in ids
    aerial = next(p for p in reg["plugins"] if p["id"] == "org.mobsimlab.aerial-lift")
    mgd = aerial["defaults"]["cable_car"]["mgd"]
    assert mgd["ropeway.line_speed_ms"]["central"] == 6
    # Without a system entry, the global fallback applies.
    assert mgd["ropeway.sag_ratio"]["central"] == 0.04


def test_core_mode_id_is_refused(plugins: Path):
    edit(plugins / "ferry" / "modes" / "ferry.json", lambda m: m.update(id="bus"))
    edit(
        plugins / "ferry" / "mobsimlab-plugin.json",
        lambda m: m["contributes"]["modes"][0].update(id="bus"),
    )
    errors, _ = check.build(plugins)
    assert any("mode bus is a core mode" in e for e in errors)


def test_unknown_context_option_is_refused(plugins: Path):
    p = plugins / "ferry" / "assumptions" / "parameters.yaml"
    p.write_text(
        p.read_text(encoding="utf-8").replace("vessel_type: hydrofoil", "vessel_type: submarine"),
        encoding="utf-8",
    )
    errors, _ = check.build(plugins)
    assert any("submarine is not an option of vessel_type" in e for e in errors)


def test_values_for_another_plugins_vessel_type(plugins: Path):
    # The noise plugin gives small ferries their own sound power; an option the ferry plugin lacks fails.
    errors, _ = check.build(plugins)
    assert errors == []
    p = plugins / "noise" / "assumptions" / "parameters.yaml"
    p.write_text(
        p.read_text(encoding="utf-8").replace(
            "vessel_type: [monohull, catamaran, hydrofoil]", "vessel_type: [monohull, submarine]"
        ),
        encoding="utf-8",
    )
    errors, _ = check.build(plugins)
    assert any("submarine is not an option of vessel_type" in e for e in errors)


def test_installed_plugins_bring_components(plugins: Path):
    def f(m):
        m["bundled"] = False
        m["contributes"]["calculations"] = [
            {
                "id": "x",
                "label": "X",
                "runtime": "bundled-wasm",
                "module": "x",
                "inputs": ["network"],
                "outputs": ["grid"],
            }
        ]

    edit(plugins / "ferry" / "mobsimlab-plugin.json", f)
    errors, _ = check.build(plugins)
    assert any("installed plugins bring their code as runtime component" in e for e in errors)


def test_tool_must_draw_own_modes(plugins: Path):
    edit(
        plugins / "ferry" / "mobsimlab-plugin.json",
        lambda m: m["contributes"]["tools"][0].update(modes=["cable_car"]),
    )
    errors, _ = check.build(plugins)
    assert any("draws cable_car" in e for e in errors)


def test_cargo_bike_tab_is_rendered_with_its_calculations():
    errors, reg = check.build()
    assert errors == []
    cargo = next(p for p in reg["plugins"] if p["id"] == "org.mobsimlab.cargo-bike")
    assert cargo["tabs"] == [
        {
            "id": "cargo-bike",
            "label": "Cargo bike",
            "view": "cargo-bike",
            "calculations": ["cargo_bike_range", "cargo_bike_savings"],
        }
    ]


def test_tab_may_not_take_a_core_tab_or_unknown_calculation(plugins: Path):
    def f(m):
        m["contributes"]["tabs"][0]["id"] = "gis"
        m["contributes"]["tabs"][0]["calculations"] = ["nope"]

    edit(plugins / "cargo-bike" / "mobsimlab-plugin.json", f)
    errors, _ = check.build(plugins)
    assert any("tab gis is a core tab" in e for e in errors)
    assert any("shows unknown calculation nope" in e for e in errors)


def test_installed_plugins_bring_their_own_tab_pages(plugins: Path):
    edit(
        plugins / "ferry" / "mobsimlab-plugin.json",
        lambda m: m["contributes"].update(
            {"tabs": [{"id": "boats", "label": "Boats", "view": "boats", "calculations": []}]}
        ),
    )

    def g(m):
        m["bundled"] = False

    edit(plugins / "ferry" / "mobsimlab-plugin.json", g)
    errors, _ = check.build(plugins)
    assert any("installed plugins bring their own page (ui)" in e for e in errors)


EXAMPLES = check.ROOT / "examples" / "plugins"


@pytest.fixture
def example(tmp_path: Path) -> Path:
    """A copy of the example third-party plugin with code (examples/plugins/timetable-csv)."""
    dst = tmp_path / "examples"
    shutil.copytree(EXAMPLES, dst, ignore=shutil.ignore_patterns("target", "code"))
    return dst


def test_example_plugin_with_code_passes(example: Path):
    errors, reg = check.build(example)
    assert errors == []
    (p,) = reg["plugins"]
    assert p["calculations"][0]["component"] == "wasm/calculation.wasm"
    assert p["tabs"][0]["ui"] == "tab/index.html"


def test_component_rules(example: Path):
    def f(m):
        m["tiers"] = ["ui"]
        m["permissions"] = []
        m["contributes"]["calculations"][0]["where"] = ["street-line-tool"]
        m["contributes"]["calculations"][0]["component"] = "wasm/missing.wasm"
        m["contributes"]["tabs"][0]["ui"] = "tab/index.htm"

    edit(example / "timetable-csv" / "mobsimlab-plugin.json", f)
    errors, _ = check.build(example)
    text = "\n".join(errors)
    assert "must list the compute tier" in text
    assert "reads timetable, which needs the read:timetable permission" in text
    assert "cannot appear in street-line-tool" in text
    assert "wasm/missing.wasm does not exist" in text
    assert "importer csv_import adds to the project, which needs the write:scenario permission" in text
    assert "tab/index.htm must be a .html file" in text


def test_bundled_plugins_use_core_code(plugins: Path):
    edit(
        plugins / "noise" / "mobsimlab-plugin.json",
        lambda m: (
            m["contributes"]["calculations"][0].update(runtime="component", component="x.wasm"),
            m["contributes"]["calculations"][0].pop("module"),
        ),
    )
    errors, _ = check.build(plugins)
    assert any("bundled plugins use runtime bundled-wasm" in e for e in errors)
