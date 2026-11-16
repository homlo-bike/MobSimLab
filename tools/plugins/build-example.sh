#!/usr/bin/env bash
# Builds the example third-party plugin's code (examples/plugins/timetable-csv) into three WebAssembly
# components, one per world of contracts/wit/plugin.wit.
# Needs: Rust with the wasm32-unknown-unknown target, and wasm-tools (cargo install wasm-tools).
# The components are committed, so tests and CI do not need the Rust toolchain for wasm32.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
plugin="$root/examples/plugins/timetable-csv"
mkdir -p "$plugin/wasm"
for world in calculation importer exporter; do
  cargo build --manifest-path "$plugin/code/Cargo.toml" --release --target wasm32-unknown-unknown \
    --no-default-features --features "$world"
  wasm-tools component new "$plugin/code/target/wasm32-unknown-unknown/release/timetable_csv_plugin.wasm" \
    -o "$plugin/wasm/$world.wasm"
  wasm-tools validate --features component-model "$plugin/wasm/$world.wasm"
done
echo "built $plugin/wasm/{calculation,importer,exporter}.wasm"
