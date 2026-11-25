/// <reference lib="webworker" />
/**
 * The rail timetable planner in a Web Worker: plans and publishes the service lines of one day type on a
 * topology (see `publishInWorker` in engine.ts), so the page stays responsive while it plans. One message,
 * one answer: the publication as JSON text, or the error with its engine message.
 */
import init, { RailDesigner } from "../../wasm/rail-design/rail_design_wasm.js";

self.onmessage = async (
  e: MessageEvent<{ topology: string; lines: string; serviceId: string; options: string }>,
) => {
  try {
    await init();
    const { topology, lines, serviceId, options } = e.data;
    self.postMessage({ out: RailDesigner.publish_on_topology(topology, lines, serviceId, options) });
  } catch (err) {
    // An engine error carries its message (engine_msg::js_error), so the page can show it in its language.
    const msg = err instanceof Error ? (err as Error & { msg?: unknown }).msg : undefined;
    self.postMessage({ error: err instanceof Error ? err.message : String(err), msg });
  }
};
