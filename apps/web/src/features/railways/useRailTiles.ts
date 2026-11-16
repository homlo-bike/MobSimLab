import type { Map as MapLibreMap } from "maplibre-gl";
import { type MutableRefObject, useEffect, useRef, useState } from "react";
import { tNow } from "../../i18n/i18n";
import { MIN_LOAD_ZOOM, tilesFor } from "../street-lines/tiles";
import type { DelayShares, TileFetcher } from "../street-lines/types";
import type { StreetSetup } from "../street-setup/types";
import type { RailEngine } from "./types";

/**
 * Purpose: feed the railway engine what it builds on besides the drawing: streets for level crossings,
 * existing railways for joins, the GIS tab's street setups, and the project's delays and design rules.
 * Output: `streets`, a counter that changes whenever the engine got something new (so the view rebuilds),
 * its setter for other sources, and a note on why streets or railways are missing.
 * Side effects: loads tiles when the map stops moving.
 */
export function useRailTiles({
  map,
  ready,
  engine,
  fetchTile,
  fetchRails,
  existingRailways,
  streetSetups,
  delays,
  designValues,
}: {
  map: MapLibreMap | null;
  ready: boolean;
  engine: MutableRefObject<RailEngine | null>;
  fetchTile: TileFetcher;
  fetchRails: TileFetcher;
  existingRailways: boolean;
  streetSetups: readonly StreetSetup[];
  delays: DelayShares | null;
  designValues: Readonly<Record<string, number>> | null;
}) {
  // Streets for level crossings and existing railways for joins: the tiles on screen, loaded when
  // the map stops moving, the same tiles the street line tool routes on. Each batch of new tiles
  // triggers one rebuild.
  const [streets, setStreets] = useState(0);
  const [streetNote, setStreetNote] = useState<string | null>(null);
  const tiles = useRef(new Set<string>());
  // Street setups from the GIS tab override OSM for street running; a change rebuilds.
  const setupsJson = JSON.stringify(streetSetups);
  useEffect(() => {
    const e = engine.current;
    if (!ready || !e) return;
    e.setStreetSetups(JSON.parse(setupsJson) as StreetSetup[]);
    setStreets((n) => n + 1);
  }, [ready, setupsJson]);
  // The project's delays in traffic (a tram's running time in streets) and design rules per mode; a change rebuilds.
  const delaysJson = delays ? JSON.stringify(delays) : "";
  const rulesJson = designValues && Object.keys(designValues).length ? JSON.stringify(designValues) : "";
  const valuesSet = useRef(false);
  useEffect(() => {
    const e = engine.current;
    // Nothing to set, and nothing set before to clear.
    if (!ready || !e?.setValues || (!delaysJson && !rulesJson && !valuesSet.current)) return;
    valuesSet.current = true;
    const d = delaysJson ? (JSON.parse(delaysJson) as DelayShares) : null;
    e.setValues({
      ...(d
        ? { street_mixed_traffic_delay_share: d.mixed_traffic, street_bus_lane_delay_share: d.bus_lane }
        : {}),
      ...(rulesJson ? (JSON.parse(rulesJson) as Record<string, number>) : {}),
    });
    setStreets((n) => n + 1);
  }, [ready, delaysJson, rulesJson]);
  useEffect(() => {
    if (!map || !ready) return;
    // Turning existing railways off forgets them; turning them on reloads the tiles on screen.
    if (!existingRailways) {
      engine.current?.clearRails();
      setStreets((n) => n + 1);
    }
    let busy = false;
    let again = false;
    let stopped = false;
    const load = async () => {
      const e = engine.current;
      if (!e || stopped) return;
      if (busy) {
        again = true;
        return;
      }
      if (map.getZoom() < MIN_LOAD_ZOOM) {
        setStreetNote(
          existingRailways
            ? tNow("rail.zoomInRails", { zoom: MIN_LOAD_ZOOM })
            : tNow("rail.zoomInStreets", { zoom: MIN_LOAD_ZOOM }),
        );
        return;
      }
      const b = map.getBounds();
      const want = tilesFor([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
        .map(([x, y]) => `${x}/${y}`)
        .filter((k) => !tiles.current.has(k));
      if (!want.length) return;
      busy = true;
      want.forEach((k) => tiles.current.add(k));
      const fetchAll = (f: TileFetcher) =>
        Promise.allSettled(
          want.map((k) => {
            const [x, y] = k.split("/").map(Number);
            return f(x!, y!);
          }),
        );
      const [got, rails] = await Promise.all([
        fetchAll(fetchTile),
        existingRailways ? fetchAll(fetchRails) : Promise.resolve([]),
      ]);
      busy = false;
      if (stopped || engine.current !== e) {
        want.forEach((k) => tiles.current.delete(k));
        return;
      }
      let added = 0;
      let reason: string | null = null;
      let railReason: string | null = null;
      got.forEach((r, i) => {
        try {
          if (r.status === "rejected") throw r.reason;
          e.addStreetTile(r.value);
          added++;
        } catch (err) {
          tiles.current.delete(want[i]!);
          reason ??= err instanceof Error ? err.message : tNow("rail.streetsFailed");
        }
      });
      rails.forEach((r, i) => {
        try {
          if (r.status === "rejected") throw r.reason;
          e.addRailTile(r.value);
          added++;
        } catch (err) {
          tiles.current.delete(want[i]!);
          railReason ??= err instanceof Error ? err.message : tNow("rail.railsFailed");
        }
      });
      if (added) setStreets((n) => n + 1);
      const notes = [
        reason && `${reason} ${tNow("rail.crossingsWhereLoaded")}`,
        railReason && `${railReason} ${tNow("rail.joinsWhereLoaded")}`,
      ].filter(Boolean);
      setStreetNote(notes.length ? `${notes.join(" ")} ${tNow("rail.moveMap")}` : null);
      if (again) {
        again = false;
        void load();
      }
    };
    const onMove = () => void load();
    map.on("moveend", onMove);
    void load();
    return () => {
      stopped = true;
      map.off("moveend", onMove);
      tiles.current.clear();
    };
  }, [map, ready, fetchTile, fetchRails, existingRailways]);
  return { streets, setStreets, streetNote };
}
