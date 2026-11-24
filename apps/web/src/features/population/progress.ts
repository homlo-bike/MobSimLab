/**
 * How a population layer's import is shown while it runs: in the Population panel and in the bar at the bottom of
 * the project (the import the project area starts runs without the panel open).
 */
import { formatInt, type Translate } from "../../i18n/i18n";
import type { PopulationLayer } from "./api";

/** Purpose: the bottom bar's key for a layer's import, so the panel and the project's watcher show it once. */
export function layerJobKey(id: string): string {
  return `population:${id}`;
}

/** Purpose: the import's step: 1 downloads, 2 stores. */
export function layerStepIndex(l: PopulationLayer): number {
  return l.progress?.step === "store" ? 2 : 1;
}

/** Purpose: how far the download is, 0 to 1, when the size is known; null otherwise or while storing. */
export function layerFraction(l: PopulationLayer): number | null {
  const p = l.progress;
  return p?.step !== "store" && p?.receivedBytes !== undefined && p.totalBytes
    ? Math.min(1, p.receivedBytes / p.totalBytes)
    : null;
}

/** Purpose: what the import is doing now, in words. */
export function layerStepText(l: PopulationLayer, t: Translate): string {
  const p = l.progress;
  const mb = (b: number) => formatInt(Math.round(b / 1e6));
  if (p?.step === "download" && p.receivedBytes !== undefined)
    return p.totalBytes
      ? t("pop.status.download", { got: mb(p.receivedBytes), total: mb(p.totalBytes) })
      : t("pop.status.downloadOpen", { got: mb(p.receivedBytes) });
  if (p?.step === "store") return t("pop.status.store");
  return t("pop.status.importing");
}
