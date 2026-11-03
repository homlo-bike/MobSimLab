#!/usr/bin/env bash
# Build the rail-sim WebAssembly module for the simulator tab's capacity run (apps/web/src/wasm/rail-sim).
# Needs: rustup target wasm32-unknown-unknown and wasm-bindgen-cli matching the wasm-bindgen crate
# version pinned in crates/rail-sim-wasm/Cargo.toml.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
want="$(grep -E '^wasm-bindgen = ' crates/rail-sim-wasm/Cargo.toml | sed -E 's/.*"=?([0-9.]+)".*/\1/')"
have="$(wasm-bindgen --version 2>/dev/null | awk '{print $2}' || true)"
if [ "$have" != "$want" ]; then
  echo "wasm-bindgen-cli $want is required (found: ${have:-none}). Install it with:" >&2
  echo "  cargo install wasm-bindgen-cli --version $want --locked" >&2
  exit 1
fi
cargo build --release --locked --target wasm32-unknown-unknown -p rail-sim-wasm
wasm-bindgen --target web --out-dir apps/web/src/wasm/rail-sim \
  target/wasm32-unknown-unknown/release/rail_sim_wasm.wasm
echo "Built apps/web/src/wasm/rail-sim"
