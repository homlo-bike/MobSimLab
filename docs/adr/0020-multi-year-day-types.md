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

## Built so far

- **Calendar** (Project preferences → Calendar and years): the simulation years (10 by default, up to 60), the public holidays of the project's country and region from Nager.Date (`GET /api/calendar/holidays`, `MOBSIMLAB_NAGER_URL`) kept in the project with the planner's added and removed days, and the days of each day type (weekday, Saturday, Sunday, public holiday) per year, each one changeable. Year-to-year changes are not applied: every year runs the same network and service, as the product owner asked.
- **Climate** (Project preferences → Climate): monthly average, average high and low and the spread of highs and lows at the project's location, from 30 years (1991–2020) of Open-Meteo daily temperatures (`GET /api/calendar/climate`, `MOBSIMLAB_OPENMETEO_URL`, `MOBSIMLAB_OPENMETEO_APIKEY`; data CC BY 4.0, the free API is for non-commercial use, so a commercial installation sets its own endpoint and key). The project keeps its own copy; every value can be changed. The climate is the same every year.
- **Weather day types**: each day type splits into ordinary days and expected hot, very hot and frost days from each month's climate (`apps/web/src/features/calendar-run/weather.ts`). Hot days cap running sections at the heat speed restriction (buckling risk on welded track) and very hot days also cap sections under overhead line (sag), over the restriction hours; frost days without switch heating add frozen switches' delays to the stability test. Heating and air conditioning on board and switch heating add energy. Every limit is an assumption library value (group Energy and climate).
- **Calendar runs** (Simulator → Years, run kind `calendar` on the background worker, `worker/src/mobsim_worker/jobs/calendar.py`): every simulation year, one date or up to 366 dates in a row. Each day type and weather variant runs its rail service once in the capacity kernel; the day figures (vehicle-km, vehicle-hours, passengers, energy, operating cost) come from the Tables tab's models and are multiplied by the day counts, plus the fixed operating cost a year.
- Not built yet: seasons and school terms, per-day-type timetables (until then every day type runs the lines' own service), street lines in SUMO per day type, and state carried from one day to the next in a row of dates.
