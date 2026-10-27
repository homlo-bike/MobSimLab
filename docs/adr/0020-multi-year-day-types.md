# ADR-0020: Multi-year simulation through representative day types and calendar expansion

- Status: Accepted (architecture PR approved by product owner, 2026-10-27)
- Date: 2026-10-27
- Related: FR-SIM-08, C-06

## Context

Microscopic simulation of every day across several years is computationally infeasible.

## Decision

Simulate representative day types per year and season in full detail; expand with calendar counts (Nager.Date holidays, user seasons, school terms); apply year-to-year changes (openings, fleet, demand growth) between years. Any specific date can still be run fully; continuous multi-day runs available for depot/charging studies.

## Consequences

Annual figures are estimates with stated method; UI and reports explain the expansion.
