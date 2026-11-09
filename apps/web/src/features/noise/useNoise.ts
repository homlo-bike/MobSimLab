import { tNow } from "../../i18n/i18n";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { loadWasmNoise } from "./engine";
import { drawNoise, removeNoise } from "./mapLayer";
import type { Indicator, NoiseEngine, NoiseEngineLoader, NoiseInput, NoiseView } from "./types";

/** Wait after the last edit before recomputing, ms. */
const DEBOUNCE_MS = 200;
/** Opacity of coloured pixels; the layer's own opacity applies on top. */
const ALPHA = 255;

/**
 * Purpose: run the noise plugin's estimate for the drawn lines while `enabled`, and keep the noise
 * band picture on the map. Recomputes shortly after each change of `input`.
 * Inputs: the map, whether the Noise toggle is on, the lines as noise sources, the indicator shown,
 * the engine loader (tests inject one) and the editor layer to draw below.
 * Output: the latest result and any error. Side effects: loads the engine on first use; adds and
 * removes the map layer.
 */
export function useNoise(
  map: MapLibreMap | null,
  enabled: boolean,
  input: NoiseInput | null,
  indicator: Indicator,
  loadEngine: NoiseEngineLoader = loadWasmNoise,
  beforeId?: string,
): { view: NoiseView | null; error: string | null } {
  const engine = useRef<NoiseEngine | null>(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<NoiseView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || engine.current) return;
    let alive = true;
    loadEngine()
      .then((e) => {
        if (!alive) return e.dispose();
        engine.current = e;
        setReady(true);
      })
      .catch((err) =>
        setError(tNow("noise.engineFailed", { error: err instanceof Error ? err.message : String(err) })),
      );
    return () => {
      alive = false;
    };
  }, [enabled, loadEngine]);

  useEffect(
    () => () => {
      engine.current?.dispose();
      engine.current = null;
    },
    [],
  );

  const json = input ? JSON.stringify(input) : null;
  useEffect(() => {
    if (!enabled || !ready || !json) {
      setView(null);
      return;
    }
    const t = setTimeout(() => {
      try {
        setView(engine.current!.estimate(JSON.parse(json) as NoiseInput));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [enabled, ready, json]);

  useEffect(() => {
    if (!map) return;
    const e = engine.current;
    if (!enabled || !view?.image || !e) {
      removeNoise(map);
      return;
    }
    const from = indicator === "lnight" ? view.lnight.threshold_db : view.lden.threshold_db;
    drawNoise(
      map,
      {
        pixels: e.image(indicator, from, ALPHA),
        width: view.image.width,
        height: view.image.height,
        coordinates: view.image.coordinates,
      },
      beforeId,
    );
  }, [map, enabled, view, indicator, beforeId]);

  useEffect(() => () => void (map && removeNoise(map)), [map]);

  return { view: enabled ? view : null, error: enabled ? error : null };
}
