#!/usr/bin/env python3
"""Validate the bundled plugins (ADR-0036) and render the web app's plugin registry.

Usage:
  python3 tools/plugins/check.py                   # validate only
  python3 tools/plugins/check.py --render          # validate and write the registry
  python3 tools/plugins/check.py --check-rendered  # fail if the registry is stale

Each folder in plugins/ with a mobsimlab-plugin.json is a plugin. The check validates the manifest against
contracts/plugin-manifest.schema.json and each mode against contracts/plugin-mode.schema.json, checks that
every referenced file exists, that mode ids are unique across the core and all plugins, that the tools
draw the plugin's own modes with the mode's kit, and validates the plugin's parameters and sources with
the assumption library's rules (ADR-0018), extended by the plugin's modes and context keys.

--render writes apps/web/src/plugins/bundled.generated.json: per plugin its manifest summary, modes,
contexts, tools, tabs, parameter labels and the resolved values per mode and context option
(low, central, high). A plugin without modes of its own (a calculation such as the energy estimate) gets its
values per core mode. It also writes apps/api/src/plugins/core.generated.json, which the API uses to check
plugins an Admin uploads: the manifest and mode schemas, the core mode ids, parameter keys and source ids,
and the bundled plugins.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

import jsonschema
import yaml

ROOT = Path(__file__).resolve().parents[2]
PLUGINS = ROOT / "plugins"
CONTRACTS = ROOT / "contracts"
OUT = ROOT / "apps" / "web" / "src" / "plugins" / "bundled.generated.json"
# What the API needs to check uploaded plugins (ADR-0036 §9): contracts, core ids, bundled plugins.
API_OUT = ROOT / "apps" / "api" / "src" / "plugins" / "core.generated.json"
MANIFEST = "mobsimlab-plugin.json"
# Core mode ids that plugins may not reuse: the assumption library's modes plus the railway tool's.
EXTRA_CORE_MODES = ["funicular"]
# The web app's own project tabs (apps/web/src/shell/route.ts); plugin tabs come after them.
CORE_TABS = ["simulator", "create", "schematic", "gis", "tables", "preferences"]


def load_assumption_check():
    """Import tools/assumptions/check.py as a module, to reuse its rules."""
    path = ROOT / "tools" / "assumptions" / "check.py"
    spec = importlib.util.spec_from_file_location("assumption_check", path)
    if not (spec and spec.loader):
        raise ImportError(path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def read_json(path: Path):
    """Parse a JSON file."""
    return json.loads(path.read_text(encoding="utf-8"))


def read_yaml(path: Path):
    """Parse a YAML file (an empty file is an empty list)."""
    return yaml.safe_load(path.read_text(encoding="utf-8")) or []


def discover(root: Path = PLUGINS) -> list[Path]:
    """Plugin folders under `root`, sorted."""
    return sorted(p.parent for p in root.glob(f"*/{MANIFEST}"))


def as_list(v) -> list:
    """A context value as a list."""
    return v if isinstance(v, list) else [v]


def matches(ctx: dict, mode: str, key: str | None, option: str | None) -> int | None:
    """Specificity of a value entry for (mode, key=option), or None when it does not apply."""
    score = 0
    modes = as_list(ctx.get("mode", "*"))
    if "*" not in modes:
        if mode not in modes:
            return None
        score += 1
    for k, v in ctx.items():
        if k == "mode":
            continue
        if k != key or option not in as_list(v):
            return None
        score += 1
    return score


def resolve(param: dict, mode: str, key: str | None, option: str | None) -> dict:
    """Most specific entry for a mode and context option; the first of equally specific ones."""
    best, best_score = None, -1
    for v in param["values"]:
        s = matches(v.get("context") or {}, mode, key, option)
        if s is not None and s > best_score:
            best, best_score = v, s
    if best is None:
        raise ValueError(f"{param['key']}: no entry for {mode}")
    return best


def check_plugin(
    folder: Path,
    chk,
    core_sources: dict,
    core_keys: set[str],
    seen_modes: dict[str, str],
    seen_tabs: dict[str, str] | None = None,
):
    """Validate one plugin. Output: (errors, registry entry)."""
    errors: list[str] = []
    where = folder.name
    manifest = read_json(folder / MANIFEST)
    schema = read_json(CONTRACTS / "plugin-manifest.schema.json")
    mode_schema = read_json(CONTRACTS / "plugin-mode.schema.json")
    for e in jsonschema.Draft202012Validator(schema).iter_errors(manifest):
        errors.append(f"{where}/{MANIFEST}: {'/'.join(map(str, e.path))}: {e.message}")
    if errors:
        return errors, None
    pid = manifest["id"]
    c = manifest["contributes"]
    seen_tabs = {} if seen_tabs is None else seen_tabs

    def path_of(item: dict, field: str = "file") -> Path | None:
        p = folder / item[field]
        if not p.exists():
            errors.append(f"{pid}: {item[field]} does not exist")
            return None
        return p

    contexts = {x["key"]: x for x in c.get("contexts", [])}
    modes = []
    for item in c.get("modes", []):
        p = path_of(item)
        if not p:
            continue
        m = read_json(p)
        for e in jsonschema.Draft202012Validator(mode_schema).iter_errors(m):
            errors.append(f"{pid}: {item['file']}: {'/'.join(map(str, e.path))}: {e.message}")
            continue
        if m.get("id") != item["id"]:
            errors.append(f"{pid}: {item['file']} has id {m.get('id')!r}, manifest says {item['id']!r}")
        mid = item["id"]
        if mid in chk.MODES or mid in EXTRA_CORE_MODES:
            errors.append(f"{pid}: mode {mid} is a core mode")
        if mid in seen_modes:
            errors.append(f"{pid}: mode {mid} is also contributed by {seen_modes[mid]}")
        seen_modes[mid] = pid
        key = m.get("contextKey")
        if key:
            opts = {o["id"] for o in contexts.get(key, {}).get("options", [])}
            if key not in contexts:
                errors.append(f"{pid}: mode {mid} uses context key {key}, which the plugin does not declare")
            for o in m.get("contexts", []):
                if o not in opts:
                    errors.append(f"{pid}: mode {mid}: context option {o} is not an option of {key}")
            if m.get("defaultContext") not in m.get("contexts", []):
                errors.append(f"{pid}: mode {mid}: defaultContext must be one of its contexts")
        modes.append(m)
    mode_ids = {m["id"] for m in modes}
    kits = {m["id"]: m["kit"] for m in modes}
    for t in c.get("tools", []):
        for mid in t["modes"]:
            if mid not in mode_ids:
                errors.append(f"{pid}: tool {t['id']} draws {mid}, which the plugin does not contribute")
            elif kits[mid] != t["kit"]:
                errors.append(f"{pid}: tool {t['id']} uses kit {t['kit']}, mode {mid} needs {kits[mid]}")

    calc_ids = {x["id"] for x in c.get("calculations", [])}
    if calc_ids and not manifest.get("bundled"):
        errors.append(f"{pid}: only bundled plugins may contribute calculations until the plugin host exists")
    converters = c.get("importers", []) + c.get("exporters", [])
    if converters and not manifest.get("bundled"):
        errors.append(
            f"{pid}: only bundled plugins may contribute importers and exporters until the plugin host exists"
        )
    conv_ids = [x["id"] for x in converters]
    for cid in sorted({x for x in conv_ids if conv_ids.count(x) > 1}):
        errors.append(f"{pid}: importer or exporter id {cid} is used twice")
    for tab in c.get("tabs", []):
        if not manifest.get("bundled"):
            errors.append(f"{pid}: only bundled plugins may contribute tabs until the UI tier exists")
        if tab["id"] in CORE_TABS:
            errors.append(f"{pid}: tab {tab['id']} is a core tab")
        if tab["id"] in seen_tabs:
            errors.append(f"{pid}: tab {tab['id']} is also contributed by {seen_tabs[tab['id']]}")
        seen_tabs[tab["id"]] = pid
        for calc in tab.get("calculations", []):
            if calc not in calc_ids:
                errors.append(f"{pid}: tab {tab['id']} shows unknown calculation {calc}")
    layers = []
    for layer in c.get("mapLayers", []):
        if layer["calculation"] not in calc_ids:
            errors.append(f"{pid}: map layer {layer['id']} uses unknown calculation {layer['calculation']}")
        p = path_of(layer, "style")
        if p:
            layers.append({**layer, "style": read_json(p)})

    # Sources and parameters, with the assumption library's rules.
    sources: dict[str, dict] = {}
    for item in c.get("sources", []):
        p = path_of(item)
        if p:
            for s in read_yaml(p):
                if s["id"] in core_sources or s["id"] in sources:
                    errors.append(f"{pid}: source {s['id']} is defined twice")
                sources[s["id"]] = {k: v for k, v in s.items() if k != "id"}
    params: list[dict] = []
    for item in c.get("parameters", []):
        p = path_of(item)
        if p:
            for x in read_yaml(p):
                x["_file"] = str(p)
                params.append(x)
    saved = chk.MODES
    chk.MODES = list(saved) + sorted(mode_ids)
    used: set[str] = set()
    try:
        errors += [f"{pid}: {e}" for e in chk.validate({**core_sources, **sources}, params, used)]
    finally:
        chk.MODES = saved
    allowed = {"mode", "traction"} | set(contexts)
    for prm in params:
        if prm.get("key") in core_keys:
            errors.append(f"{pid}: {prm['key']} is a core parameter")
        for v in prm.get("values", []):
            for k, val in (v.get("context") or {}).items():
                if k not in allowed:
                    errors.append(f"{pid}: {prm['key']}: unknown context key {k}")
                elif k in contexts:
                    opts = {o["id"] for o in contexts[k]["options"]}
                    for o in as_list(val):
                        if o not in opts:
                            errors.append(f"{pid}: {prm['key']}: {o} is not an option of {k}")
    for sid in sorted(set(sources) - used):
        errors.append(f"{pid}: source {sid} defined but never used")
    if errors:
        return errors, None

    # Registry entry for the web app.
    defaults: dict[str, dict] = {}
    for m in modes:
        key = m.get("contextKey")
        per: dict[str, dict] = {}
        for o in m.get("contexts", [None]):
            per[o or "*"] = {
                prm["key"]: {f: resolve(prm, m["id"], key, o)[f] for f in ("low", "central", "high")}
                for prm in params
            }
        defaults[m["id"]] = per
    if not modes and params:
        # A plugin without modes of its own (a calculation) gives values per core mode, so the app can
        # resolve them for each line of the project.
        for mid in sorted(set(chk.MODES) | set(EXTRA_CORE_MODES)):
            defaults[mid] = {
                "*": {
                    prm["key"]: {f: resolve(prm, mid, None, None)[f] for f in ("low", "central", "high")}
                    for prm in params
                }
            }
    entry = {
        "id": pid,
        "name": manifest["name"],
        "description": manifest.get("description", ""),
        "version": manifest["version"],
        "publisher": manifest["publisher"],
        "license": manifest["license"],
        "dataLicense": manifest["dataLicense"],
        "bundled": manifest.get("bundled", False),
        "tiers": manifest["tiers"],
        "permissions": manifest["permissions"],
        "modes": modes,
        "contexts": list(contexts.values()),
        "tools": c.get("tools", []),
        "calculations": c.get("calculations", []),
        "importers": c.get("importers", []),
        "exporters": c.get("exporters", []),
        "mapLayers": layers,
        "tabs": c.get("tabs", []),
        "parameters": {prm["key"]: {"label": prm["label"], "unit": prm["unit"]} for prm in params},
        "defaults": defaults,
    }
    return errors, entry


def build(root: Path = PLUGINS) -> tuple[list[str], dict]:
    """Validate every plugin under `root`. Output: (errors, registry)."""
    chk = load_assumption_check()
    core_sources = chk.load_sources()
    core_keys = {p["key"] for p in chk.load_parameters()}
    seen: dict[str, str] = {}
    seen_tabs: dict[str, str] = {}
    errors: list[str] = []
    plugins = []
    ids: set[str] = set()
    for folder in discover(root):
        errs, entry = check_plugin(folder, chk, core_sources, core_keys, seen, seen_tabs)
        errors += errs
        if entry:
            if entry["id"] in ids:
                errors.append(f"{entry['id']}: two plugins with the same id")
            ids.add(entry["id"])
            plugins.append(entry)
    return errors, {"pluginApi": "1", "plugins": plugins}


def render(registry: dict) -> str:
    """The registry as the JSON text the web app imports."""
    return json.dumps(registry, indent=2, ensure_ascii=False) + "\n"


def core_for_api(registry: dict) -> dict:
    """What the API's plugin install check needs: contracts, core ids and the bundled plugins."""
    chk = load_assumption_check()
    return {
        "pluginApi": "1",
        "manifestSchema": read_json(CONTRACTS / "plugin-manifest.schema.json"),
        "modeSchema": read_json(CONTRACTS / "plugin-mode.schema.json"),
        "coreModes": sorted(set(chk.MODES) | set(EXTRA_CORE_MODES)),
        "tractions": list(chk.TRACTIONS),
        "coreParameterKeys": sorted(p["key"] for p in chk.load_parameters()),
        "coreSourceIds": sorted(chk.load_sources()),
        "bundled": registry["plugins"],
    }


def main() -> int:
    """Validate; render or check the registry. Output: the exit code."""
    ap = argparse.ArgumentParser()
    ap.add_argument("--render", action="store_true")
    ap.add_argument("--check-rendered", action="store_true")
    args = ap.parse_args()
    errors, registry = build()
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    outputs = {OUT: render(registry), API_OUT: render(core_for_api(registry))}
    for path, text in outputs.items():
        if args.render:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
        if args.check_rendered and (not path.exists() or path.read_text(encoding="utf-8") != text):
            print(f"{path.relative_to(ROOT)} is stale; run with --render", file=sys.stderr)
            return 1
    n_modes = sum(len(p["modes"]) for p in registry["plugins"])
    print(f"OK: {len(registry['plugins'])} plugins, {n_modes} modes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
