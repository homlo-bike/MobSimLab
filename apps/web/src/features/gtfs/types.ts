import type { Timetable } from "../journey-planner/types";

/** What a feed brought in (`gtfs::ImportSummary`). */
export interface GtfsSummary {
  agencies: string[];
  /** The service day read, YYYYMMDD. */
  date: string;
  routes: number;
  stops: number;
  trips: number;
  patterns: number;
  /** Trips of the day left out because they do not stop inside the map view. */
  outside: number;
  warnings: string[];
}

/** One imported feed as the project keeps it (drawing `gtfs-network`). */
export interface GtfsFeed {
  id: string;
  /** The file name it came from. */
  name: string;
  importedAt: string;
  summary: GtfsSummary;
  timetable: Timetable;
}

/** The project's existing network from GTFS feeds. */
export interface GtfsNetworkDoc {
  feeds: GtfsFeed[];
}

export interface GtfsImportOptions {
  /** YYYYMMDD; the busiest Wednesday when absent. */
  date?: string;
  /** [west, south, east, north]. */
  bbox?: [number, number, number, number];
}

export interface GtfsExportOptions {
  agency_name: string;
  agency_url: string;
  agency_timezone: string;
  lang: string;
  start_date: string;
  end_date: string;
  /** GTFS route type of plugin modes. */
  route_types: Record<string, number>;
  feed_version: string;
}

export interface GtfsEngine {
  import(
    files: Record<string, string>,
    options: GtfsImportOptions,
  ): { timetable: Timetable; summary: GtfsSummary };
  export(timetable: Timetable, options: GtfsExportOptions): Record<string, string>;
}

export type GtfsEngineLoader = () => Promise<GtfsEngine>;
