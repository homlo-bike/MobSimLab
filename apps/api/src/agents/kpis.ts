/**
 * The KPI catalogue (ADR-0035 §7): every benchmark figure with its unit, formula, direction and source, so a
 * benchmark means the same thing to an agent, the UI and a report. Versioned with the API.
 */
export const KPI_CATALOGUE_VERSION = "2026-11-02";

export const KPIS = [
  {
    id: "stops",
    name: "Stops and stations",
    unit: "count",
    better: "neutral",
    formula: "stops in the scenario",
    source: "—",
  },
  {
    id: "lines",
    name: "Lines",
    unit: "count",
    better: "neutral",
    formula: "lines in the scenario",
    source: "—",
  },
  {
    id: "route_km",
    name: "Route length",
    unit: "km",
    better: "neutral",
    formula: "sum over lines of the outbound routed length",
    source: "TCQSM 3rd ed. (system size)",
  },
  {
    id: "peak_vehicles",
    name: "Vehicles in peak service",
    unit: "vehicles",
    better: "lower",
    formula:
      "per line ceil(cycle time / peak headway); cycle = running time × (1 + recovery share) + dwell + layover at both ends",
    source:
      "TCQSM 3rd ed. (fleet requirement); timetable.recovery_share, timetable.layover_min, mode.dwell_s",
  },
  {
    id: "fleet",
    name: "Fleet including spares",
    unit: "vehicles",
    better: "lower",
    formula: "per line ceil(peak vehicles × (1 + spare share))",
    source: "mode.spare_share (FTA spare ratio guideline, TCRP)",
  },
  {
    id: "vehicle_km_per_day",
    name: "Vehicle-kilometres per weekday",
    unit: "km",
    better: "lower",
    formula: "departures per direction × routed length, both directions",
    source: "TCQSM 3rd ed. (service volume)",
  },
  {
    id: "vehicle_hours_per_day",
    name: "Vehicle-hours per weekday (in service)",
    unit: "h",
    better: "lower",
    formula: "departures per direction × trip time, both directions",
    source: "TCQSM 3rd ed. (service volume)",
  },
  {
    id: "median_stop_spacing_m",
    name: "Median stop spacing",
    unit: "m",
    better: "neutral",
    formula: "median of along-route distances between consecutive stops, all lines (outbound)",
    source: "TCQSM 3rd ed.; mode.stop_spacing_m",
  },
  {
    id: "walk_15_min_coverage_pct",
    name: "15-minute walk coverage (headline)",
    unit: "%",
    better: "higher",
    formula:
      "share of demand within analysis.walk_rule_minutes walk of a stop with peak service, on the street network",
    source: "Product owner rule 2026-11-01; Moreno et al. 2021; TCQSM service coverage",
  },
  {
    id: "sdg_11_2_1_pct",
    name: "SDG 11.2.1 access",
    unit: "%",
    better: "higher",
    formula: "share of demand within 500 m (bus, tram) or 1000 m (rail, metro) walking distance of a stop",
    source: "UN-Habitat, SDG indicator 11.2.1 metadata",
  },
  {
    id: "median_journey_min",
    name: "Median door-to-door journey time",
    unit: "min",
    better: "lower",
    formula:
      "median over the origin–destination pairs given of the fastest journey leaving at the given time",
    source: "Journey planner (ADR-0034, RAPTOR)",
  },
] as const;
