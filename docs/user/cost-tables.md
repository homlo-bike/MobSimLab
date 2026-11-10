# Cost tables

The **Tables** tab estimates what the project costs to build and to run a year, per mode, per line and in total. The numbers are educated estimates (low, medium and high) to put the project in perspective, not a budget. The design is in [ADR-0039](../adr/0039-cost-estimate.md).

## What it costs

The tables read what is drawn in the project:

- **Railways** from the railway tool: track length by construction type (street level, elevated guideway, viaduct, bridge, ramp, cut and cover tunnel, bored tunnel), track, power and signalling, switches, and stations by level. Set how tunnels and elevated stretches are built on each track in the railway tool (**Tunnel built by**, **Raised on**; see [Railway tool](railway-tool.md#draw-tracks)).
- **Rail service lines**: the trains each line needs (from publishing its timetable) with reserves, their depot places, crew hours and running cost per car-km.
- **Street lines**: stops, the bus lanes the line uses, trolley wires, vehicles for the headway with reserves, depot places and vehicle-hours (service hours a day at the line's headway).

On top come design and management and a contingency (shares of the infrastructure), infrastructure upkeep a year (a share of its construction cost) and administration and overheads (a share of the operating cost). Land is not included. Cable car and ferry lines are not costed yet.

## The tables

- **Construction** and **Operating, a year**: the medium estimate with the range from low to high.
- **Where the construction money goes**: a stacked bar per mode (and the total) split into track and structures, systems and street works, stations, vehicles and depots, and design and contingency; beside it, construction by infrastructure type, largest first, with the low to high range as a line. Hover or tab to a bar for its numbers.
- **Per mode**: construction and operating cost of each mode and the total.
- **Per line**: length, fleet, construction and operating cost. Click a column heading in this table or in **Per mode** to sort by it. Rail lines that share track split its cost by their train-km; track no line uses yet has its own row.
- **Construction by infrastructure type** and **Operating cost a year**: every item with its quantity, unit cost and the low, medium and high amounts, grouped by mode and kind. Click a mode or a kind to open or close it, or use **Expand all** and **Collapse all**; **Largest first** orders the groups and items by their medium estimate.

Switch between the country's currency and US dollars at the top.

## Country and today's prices

The unit costs are in 2023 international dollars (purchasing power parity), the basis the Transit Costs Project uses to compare countries; vehicles are in 2023 US dollars. The tables find the country at the project's location (OpenStreetMap boundaries) and read three values from the World Bank (World Development Indicators, CC BY 4.0):

| Value | Indicator | Used for |
|-------|-----------|----------|
| Local currency per international $ | PA.NUS.PPP | Construction and operation |
| Local currency per US$ | PA.NUS.FCRF | Vehicles, and the US$ view |
| Price rise since 2023 | NY.GDP.DEFL.ZS (United States), latest ÷ 2023 | Everything |

Under **Country and prices** you can choose another country and enter your own value for each of the three. Leave a field empty to use the World Bank's value again. Without a location or World Bank data the tables stay in 2023 international dollars.

## Changing unit costs

**Unit costs used** lists every unit cost the estimate uses, per mode, with the assumption library's low, medium and high values. Enter a medium value to change it for this project; low and high move with it in the same proportion. Leave the field empty to return to the library's value. Changes are saved with the project, and only Owners and Editors can make them.

The values, their sources and the reasoning behind each are in [assumptions/parameters/costs.yaml](../../assumptions/parameters/costs.yaml) (readable in [DEFAULTS.md](../../assumptions/DEFAULTS.md)).
