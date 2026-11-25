import { useEffect, useMemo, useRef, useState } from "react";
import type { AreaPolygon } from "../features/area/api";
import { useI18n } from "../i18n/i18n";
import { usePublishJob } from "../shell/jobs";
import {
  type ClimateFetcher,
  type FetchedClimate,
  climateFrom,
  fetchClimate,
  needsClimate,
  withClimate,
  withFetchedClimate,
  type ZoneClimate,
} from "./climate";
import { climateZones, sameZones, withZonePlaces } from "./climateZones";

/** Purpose: whether an answer holds the twelve months a climate needs. */
const twelve = (c: FetchedClimate | undefined): c is FetchedClimate =>
  Array.isArray(c?.months) && c.months.length === 12;
import type { PreferencesDoc } from "./preferences";

type Bbox = readonly [number, number, number, number];

/**
 * Purpose: keep the project's climate (Project preferences → Climate) in the project as soon as it opens with a
 * place, so calendar runs have it without Preferences being opened first; the API looked it up when the area was
 * saved. Fetched again when the kept climate lies outside a moved area; the planner's own values stay. Shows in
 * the bar at the bottom of the project while it is fetched. A large area also gets a climate per zone
 * (climateZones.ts), each fetched once. Renders nothing itself.
 * Side effects: fetches the climate (once per place a session) and saves it in the project's preferences.
 */
export function ClimateKeeper({
  place,
  bbox,
  polygons,
  preferences,
  onPreferences,
  fetcher = fetchClimate,
}: {
  /** Where the climate is asked for (`climatePlace`), or null without an area or drawing. */
  place: readonly [number, number] | null;
  bbox: Bbox | null | undefined;
  /** The project area's polygons: a large area gets a climate per zone; undefined while the area loads. */
  polygons?: readonly AreaPolygon[];
  preferences: PreferencesDoc | null;
  /** Saves the preferences; absent while they load or for a reader, who cannot keep the climate. */
  onPreferences?: (doc: PreferencesDoc) => void;
  fetcher?: ClimateFetcher;
}) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [zonesDone, setZonesDone] = useState<{ done: number; of: number } | null>(null);
  usePublishJob(
    zonesDone
      ? {
          label: t("climate.title"),
          step: t("climate.loadingZones", { done: zonesDone.done, n: zonesDone.of }),
          overall: zonesDone.of ? zonesDone.done / zonesDone.of : null,
        }
      : loading
        ? { label: t("climate.title"), step: t("climate.loading"), overall: null }
        : null,
  );
  const latest = useRef({ preferences, onPreferences, bbox });
  latest.current = { preferences, onPreferences, bbox };
  const climate = climateFrom(preferences);
  const want = !!onPreferences && place !== null && needsClimate(climate, bbox);
  useEffect(() => {
    if (!want || !place) return;
    let stop = false;
    setLoading(true);
    fetcher(place[1], place[0])
      .then(
        (got) => {
          const cur = latest.current;
          if (stop || !twelve(got)) return;
          if (!cur.onPreferences || !needsClimate(climateFrom(cur.preferences), cur.bbox)) return;
          cur.onPreferences(
            withClimate(cur.preferences, withFetchedClimate(climateFrom(cur.preferences), got)),
          );
        },
        // Preferences → Climate shows the error and a retry.
        () => undefined,
      )
      .finally(() => {
        if (!stop) setLoading(false);
      });
    return () => {
      stop = true;
      setLoading(false);
    };
  }, [want, place?.[0], place?.[1]]);

  // A large area: one climate per zone. The zones follow the area's polygons; their climates are fetched in turn.
  const places = useMemo(() => climateZones(polygons ?? []), [polygons]);
  const zonesChanged = !!onPreferences && polygons !== undefined && !sameZones(climate, places);
  useEffect(() => {
    const cur = latest.current;
    if (!zonesChanged || !cur.onPreferences) return;
    cur.onPreferences(withClimate(cur.preferences, withZonePlaces(climateFrom(cur.preferences), places)));
  }, [zonesChanged, places]);
  // Follows the zones while any lacks its climate (not each one fetched, which would start over each time).
  const zoneList = climate.zones ?? [];
  const zonesKey =
    onPreferences && zoneList.some((z) => !z.fetched)
      ? zoneList.map((z) => `${z.at[0]},${z.at[1]}`).join(";")
      : "";
  useEffect(() => {
    if (!zonesKey) return;
    const lacking = () =>
      new Set(
        (climateFrom(latest.current.preferences).zones ?? [])
          .filter((z) => !z.fetched)
          .map((z) => `${z.at[0]},${z.at[1]}`),
      );
    const want = [...lacking()].map((k) => k.split(",").map(Number) as [number, number]);
    let stop = false;
    // Every climate got so far, put in again with each save, so a save made before the page caught up with the
    // last one does not lose it.
    const got = new Map<string, FetchedClimate>();
    const save = () => {
      const cur = latest.current;
      if (stop || !cur.onPreferences) return;
      const c = climateFrom(cur.preferences);
      if (!c.zones?.some((z) => !z.fetched && got.has(`${z.at[0]},${z.at[1]}`))) return;
      const zones = c.zones.map((z) => {
        const f = got.get(`${z.at[0]},${z.at[1]}`);
        return !z.fetched && f ? withFetchedClimate(z, f) : z;
      }) as ZoneClimate[];
      cur.onPreferences(withClimate(cur.preferences, { ...c, zones }));
    };
    void (async () => {
      setZonesDone({ done: 0, of: want.length });
      for (const [i, [lon, lat]] of want.entries()) {
        if (stop) return;
        if (!lacking().has(`${lon},${lat}`)) continue;
        try {
          const f = await fetcher(lat, lon);
          if (twelve(f)) got.set(`${lon},${lat}`, f);
          save();
        } catch {
          // Left without a climate: Preferences → Climate shows the zone empty, and opening the project asks again.
        }
        if (!stop) setZonesDone({ done: i + 1, of: want.length });
      }
      if (!stop) setZonesDone(null);
    })();
    return () => {
      stop = true;
      setZonesDone(null);
    };
  }, [zonesKey]);
  return null;
}
