import type { AnalysisService } from "./analysis.service";
import { NetworkError } from "./network.service";
import type { ScenarioDoc } from "./scenario";
import { gtfs } from "./wasm";
import { writeZip } from "./zip";

/** Largest feed the tool returns, bytes of zip (agent scenarios stay far below it). */
export const MAX_FEED_BYTES = 5 * 1024 * 1024;

export interface GtfsExportOptions {
  agencyName: string;
  agencyUrl: string;
  timezone: string;
  lang: string;
  startDate: string;
  endDate: string;
}

/**
 * Purpose: a scenario as a GTFS Schedule feed (ADR-0035 `export_gtfs`): the same published timetable the journey
 * planner rides, written by the GTFS plugin's exporter (crates/gtfs) as a weekday feed, zipped.
 * Output: the zip, and per file its row count.
 */
export function exportGtfs(doc: ScenarioDoc, analysis: AnalysisService, o: GtfsExportOptions) {
  const timetable = analysis.timetable(doc);
  if (timetable.frequency_patterns.length === 0)
    throw new NetworkError("The scenario has no routed line with service to export.");
  const files = JSON.parse(
    gtfs().export_gtfs(
      JSON.stringify({
        timetable,
        agency_name: o.agencyName,
        agency_url: o.agencyUrl,
        agency_timezone: o.timezone,
        lang: o.lang,
        start_date: o.startDate,
        end_date: o.endDate,
        route_types: {},
        feed_version: new Date().toISOString(),
      }),
    ),
  ) as Record<string, string>;
  const zip = writeZip(files);
  if (zip.length > MAX_FEED_BYTES)
    throw new NetworkError(
      `The feed is ${Math.round(zip.length / 1024)} KB; at most ${MAX_FEED_BYTES / 1024} KB are returned.`,
    );
  const rows = Object.fromEntries(
    Object.entries(files).map(([name, text]) => [name, Math.max(0, text.trimEnd().split("\n").length - 1)]),
  );
  return { files, rows, zip };
}
