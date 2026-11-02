#!/usr/bin/env bash
# Build the street-routing and journey-planner WebAssembly modules for the API (Node, CommonJS) into
# apps/api/wasm. The agent tools (ADR-0035) run the same walk analysis, street routing and journey planner
# code as the browser and the worker.
# Needs: rustup target wasm32-unknown-unknown and wasm-bindgen-cli matching the wasm-bindgen crate version.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
want="$(grep -E '^wasm-bindgen = ' crates/street-routing-wasm/Cargo.toml | sed -E 's/.*"=?([0-9.]+)".*/\1/')"
have="$(wasm-bindgen --version 2>/dev/null | awk '{print $2}' || true)"
if [ "$have" != "$want" ]; then
  echo "wasm-bindgen-cli $want is required (found: ${have:-none}). Install it with:" >&2
  echo "  cargo install wasm-bindgen-cli --version $want --locked" >&2
  exit 1
fi
cargo build --release --locked --target wasm32-unknown-unknown -p street-routing-wasm -p journey-planner-wasm
wasm-bindgen --target nodejs --out-dir apps/api/wasm/street-routing \
  target/wasm32-unknown-unknown/release/street_routing_wasm.wasm
wasm-bindgen --target nodejs --out-dir apps/api/wasm/journey-planner \
  target/wasm32-unknown-unknown/release/journey_planner_wasm.wasm
echo "Built apps/api/wasm"
