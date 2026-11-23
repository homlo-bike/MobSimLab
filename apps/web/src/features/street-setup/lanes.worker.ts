/// <reference lib="webworker" />
/**
 * Lane and junction shapes (ADR-0047) in a Web Worker, so building them never holds up the map. The page
 * sends each street tile once (`tile`) and asks for the shapes of the tiles on screen with the setups
 * applied (`build`); the answer carries the same `id`.
 */
import init, { StreetGeometry } from "../../wasm/street-geometry/street_geometry_wasm.js";
import type { LaneWorkerReply, LaneWorkerRequest } from "./lanes";

const tiles = new Map<string, string>();
let ready: Promise<unknown> | null = null;

self.onmessage = async (e: MessageEvent<LaneWorkerRequest>) => {
  const req = e.data;
  if (req.kind === "tile") {
    tiles.set(req.key, req.xml);
    return;
  }
  const reply = (r: LaneWorkerReply) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(r);
  try {
    ready ??= init();
    await ready;
    const g = new StreetGeometry();
    try {
      for (const key of req.keys) {
        const xml = tiles.get(key);
        if (xml) g.add_osm(xml);
      }
      reply({ id: req.id, json: g.ready() ? g.build(JSON.stringify(req.setups), req.side) : null });
    } finally {
      g.free();
    }
  } catch (err) {
    reply({ id: req.id, error: err instanceof Error ? err.message : String(err) });
  }
};
