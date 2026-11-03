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


def test_calculations_only_in_bundled_plugins(plugins: Path):
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
    assert any("only bundled plugins may contribute calculations" in e for e in errors)


def test_tool_must_draw_own_modes(plugins: Path):
    edit(
        plugins / "ferry" / "mobsimlab-plugin.json",
        lambda m: m["contributes"]["tools"][0].update(modes=["cable_car"]),
    )
    errors, _ = check.build(plugins)
    assert any("draws cable_car" in e for e in errors)
