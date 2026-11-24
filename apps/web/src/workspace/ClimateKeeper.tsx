import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/i18n";
import { usePublishJob } from "../shell/jobs";
import {
  type ClimateFetcher,
  climateFrom,
  fetchClimate,
  needsClimate,
  withClimate,
  withFetchedClimate,
} from "./climate";
import type { PreferencesDoc } from "./preferences";

type Bbox = readonly [number, number, number, number];

/**
 * Purpose: keep the project's climate (Project preferences → Climate) in the project as soon as it opens with a
 * place, so calendar runs have it without Preferences being opened first; the API looked it up when the area was
 * saved. Fetched again when the kept climate lies outside a moved area; the planner's own values stay. Shows in
 * the bar at the bottom of the project while it is fetched. Renders nothing itself.
 * Side effects: fetches the climate (once per place a session) and saves it in the project's preferences.
 */
export function ClimateKeeper({
  place,
  bbox,
  preferences,
  onPreferences,
  fetcher = fetchClimate,
}: {
  /** Where the climate is asked for (`climatePlace`), or null without an area or drawing. */
  place: readonly [number, number] | null;
  bbox: Bbox | null | undefined;
  preferences: PreferencesDoc | null;
  /** Saves the preferences; absent while they load or for a reader, who cannot keep the climate. */
  onPreferences?: (doc: PreferencesDoc) => void;
  fetcher?: ClimateFetcher;
}) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  usePublishJob(loading ? { label: t("climate.title"), step: t("climate.loading"), overall: null } : null);
  const latest = useRef({ preferences, onPreferences, bbox });
  latest.current = { preferences, onPreferences, bbox };
  const want = !!onPreferences && place !== null && needsClimate(climateFrom(preferences), bbox);
  useEffect(() => {
    if (!want || !place) return;
    let stop = false;
    setLoading(true);
    fetcher(place[1], place[0])
      .then(
        (got) => {
          const cur = latest.current;
          // Twelve months, or nothing to keep.
          if (stop || !Array.isArray(got?.months) || got.months.length !== 12) return;
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
  return null;
}
