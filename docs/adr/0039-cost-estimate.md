# ADR-0039: Construction and operating cost tables from sourced unit costs and World Bank price levels

- Status: Proposed (first version built: Tables tab cost tables)
- Date: 2026-11-09
- Deciders: product owner, architecture
- Related: 09-planning-models §3.1, ADR-0017 (outbound gateway), ADR-0018 (assumption engine), ADR-0030 (railway design tool)

## Context

The Tables tab needs a construction and operating cost breakdown per mode, per line and in total, split by
infrastructure type (street level, elevated, viaduct, bridge, ramp, cut and cover tunnel, bored tunnel,
systems, stations, depots, vehicles). The numbers are educated estimates to put a project in perspective, so
they come as low, medium and high, and must reflect the project's country and today's prices. Every value used
in a calculation needs a source or a documented assumption with a range, and must be editable per project.

The railway design only knows levels (underground, street, elevated), not how a tunnel or an elevated
stretch is built, and the cost of each differs by a factor of two to five.

## Decision

1. **Unit costs in the assumption library.** `assumptions/parameters/costs.yaml` (group *Cost*) holds every unit
   cost with low, central and high values per mode, its source and reasoning. Prices are 2023 international
   dollars at purchasing power parity, the basis of the Transit Costs Project database; vehicles, which are
   traded internationally, are 2023 US dollars at market rates. `tools/costs/export_defaults.py` writes them for
   the web app; CI checks the export is current.
2. **Construction type in the railway editor.** Each track has *Tunnel built by* (auto, cut and cover, TBM) and
   *Raised on* (auto, elevated guideway, viaduct, bridge), shown when the track has such stretches. Auto is cut
   and cover on the first underground level and TBM on the second, an elevated guideway for tram, light rail
   and metro and a viaduct for main lines. Ramps between levels are their own type.
3. **Country and today's prices from the World Bank.** The API finds the country of the project's location in
   the OpenStreetMap boundaries (Overpass `is_in`) and reads from the World Bank Indicators API, through the
   outbound gateway: the PPP conversion factor (PA.NUS.PPP), the exchange rate (PA.NUS.FCRF) and the US GDP
   deflator (NY.GDP.DEFL.ZS). Construction and operating unit costs are scaled by deflator(latest) ÷
   deflator(2023) and converted with the PPP factor; vehicles with the exchange rate. The planner can choose
   another country and override each of the three values.
4. **Quantities.** Track km by construction type and number of tracks (single track at a share of double),
   systems per km, switches, stations by level, from the rail engine's build. Fleet and service from publishing
   the service lines (trains, trips, running times); line length from the station positions. Street lines:
   stops, bus lane km, trolley wire km, vehicles from the headway and cycle time, service hours a day. Design
   and management and contingency are shares of the infrastructure; upkeep a share of it per year; overheads a
   share of the operating cost.
5. **Per line.** Items of one line count for it; rail infrastructure shared by the lines of a mode is split by
   their train-km; track no line uses yet is shown on its own.
6. **Editable.** Each unit cost's medium value can be set per project and mode in the tables (saved as project
   preferences, `cost.<key>.<mode>`); low and high move with it. The chosen country is the drawing kind `costs`.

## Alternatives considered

| Option | Why not |
|--------|---------|
| Guess the construction type in the table from depth and terrain, editable per stretch there | The product owner chose to set it in the railway editor, where the track is drawn. |
| One cost per km of line by mode (benchmark only) | Hides the main cost driver (share in tunnel or on structures) and cannot answer "what if this part is elevated". |
| Market exchange rates for everything | Construction and operation are mostly local labour and materials; PPP reflects their price level better. The Transit Costs Project compares countries at PPP for the same reason. |
| Country cost indices from national statistics | No open, global, machine-readable source; the World Bank indicators cover nearly every country. |

## Consequences

- The estimate is only as good as the unit costs; most are `educated-guess` or `documented` with
  `check: unverified`. Reading the Transit Costs Project dataset per country and construction type and
  replacing the global values with country-group values is the main follow-up.
- Cable car and ferry lines (plugins) are not costed yet; their tools keep their lines in the browser.
- Land acquisition is not included.
- The live-sources workflow also checks the World Bank API and the country lookup.
