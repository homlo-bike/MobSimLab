import { createRoot } from "react-dom/client";
import "./src/index.css";
import net from "./_shot_net.json";
import { loadRailEngine } from "./src/features/railways/engine";
import { NetworkTables } from "./src/features/tables/NetworkTables";
import { Scenarios } from "./src/features/tables/Scenarios";
import type { Network } from "./src/features/railways/types";
const s = (window as unknown as { STREET: unknown }).STREET;
const loadRail = async () => {
  const e = await loadRailEngine();
  return { ...e, build: (d: Network, x: number | null) => { const v = e.build(d, x); for (const sw of d.switches) sw.element = v.params.default_turnout; return e.build(d, x); },
    publishLines: () => ({ timetable: {}, notes: [], lines: [{ id: "M1", trips: 370, outbound_s: 470, return_s: 470, trains: 6, issues: [] }] }), dispose: () => e.dispose(), missingTerrainTiles: () => e.missingTerrainTiles!(), terrainTilePoints: (x: number, y: number) => e.terrainTilePoints!(x, y), addTerrainTile: (x: number, y: number, h: (number | null)[]) => e.addTerrainTile!(x, y, h) };
};
createRoot(document.getElementById("root")!).render(
  <div className="min-h-screen bg-slate-50"><section aria-label="Tables" className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-10">
    <h1 className="text-2xl font-semibold tracking-tight">Tables</h1>
    <NetworkTables railway={net as unknown as Network} streetLines={s as never} preferences={null} loadRail={loadRail as never} fetchHeights={async (p) => p.map(([lo]) => (lo - 4.9) * 300)} />
    <Scenarios railway={net as unknown as Network} streetLines={s as never} preferences={null} loadRail={loadRail as never} onChange={() => {}}
      doc={{ scenarios: [{ id: "a", name: "Tunnel only", savedAt: "2026-11-09T10:00:00Z", railway: { ...(net as unknown as Network), tracks: [(net as unknown as Network).tracks[0]!], stations: (net as unknown as Network).stations.slice(0, 2), switches: [(net as unknown as Network).switches[0]!], lines: [{ ...(net as unknown as Network).lines![0]!, stations: [1, 2] }] }, streetLines: s as never }] }} />
  </section></div>,
);
