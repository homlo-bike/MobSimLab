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
  /** Routes the planner turned into lines of their own; the journey planner leaves them out of the feed. */
  converted?: string[];
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
  /** Public holidays in the validity, YYYYMMDD: the `holiday` service runs instead of the day's usual one. */
  holidays?: string[];
  /**
   * The weekend as days of the week (0 Sunday to 6 Saturday): the `sunday` service runs on the main rest day and
   * the `saturday` one on the other weekend day (none in a one-day weekend); absent: Saturday and Sunday.
   */
  weekend?: { rest: number; second?: number };
}

export interface GtfsEngine {
  import(
    files: Record<string, string>,
    options: GtfsImportOptions,
  ): { timetable: Timetable; summary: GtfsSummary };
  export(timetable: Timetable, options: GtfsExportOptions): Record<string, string>;
}

export type GtfsEngineLoader = () => Promise<GtfsEngine>;
