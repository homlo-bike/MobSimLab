/// <reference lib="webworker" />
/**
 * Web worker that runs the rail capacity run (rail-sim-wasm) off the main thread, so the panel stays responsive
 * while the period is planned and run through the interlocking many times.
 * Messages: { id, op: "load", network, lines } | { id, op: "lines" | "notes" } |
 * { id, op: "run", params } | { id, op: "sweepHeadways", params, line, works } | { id, op: "sweepPoint", params, line, headway }.
 * Replies: { id, ok: true, value } or { id, ok: false, error }.
 */
import init, { CapacityRunner } from "../../wasm/rail-sim/rail_sim_wasm.js";

let runner: CapacityRunner | null = null;
let ready: Promise<unknown> | null = null;

type Msg = { id: number; op: string; [k: string]: unknown };

self.onmessage = async (e: MessageEvent<Msg>) => {
  const m = e.data;
  try {
    ready ??= init();
    await ready;
    let value: unknown;
    if (m.op === "load") {
      runner?.free();
      const lines = m.lines === "example" ? CapacityRunner.example_lines() : String(m.lines);
      runner = new CapacityRunner(String(m.network), lines);
      value = true;
    } else {
      if (!runner) throw new Error("no network loaded");
      const p = JSON.stringify(m.params ?? {});
      if (m.op === "lines") value = JSON.parse(runner.lines());
      else if (m.op === "notes") value = JSON.parse(runner.notes());
      else if (m.op === "run") value = JSON.parse(runner.run(p));
      else if (m.op === "sweepHeadways")
        value = JSON.parse(runner.sweep_headways(p, Number(m.line), Boolean(m.works)));
      else if (m.op === "sweepPoint")
        value = JSON.parse(runner.sweep_point(p, Number(m.line), Number(m.headway)));
      else throw new Error(`unknown operation ${m.op}`);
    }
    self.postMessage({ id: m.id, ok: true, value });
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
