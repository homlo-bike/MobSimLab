# Fare revenue

Below the benefit tables, the **Tables** tab estimates the fares the lines take in a year: the boardings of the [ridership estimate](benefit-tables.md) times the average fare riders pay. The design is in [ADR-0044](../adr/0044-fare-revenue.md).

## Fare structure

Choose one for the project under **Fare structure**:

- **Flat fare**: one fare for every trip.
- **Zonal fares**: a fare for one zone, plus an amount for each further zone. The zones are the tariff zones you draw on the [Schematic tab's network map](schematic.md). A stop outside every zone counts as a zone of its own. Until you draw zones, every trip is in one zone.
- **Distance-based fares**: a base fare plus an amount per km, with an optional highest fare.

## How it works

1. **Trips of a line.** Each line's trips are spread between each pair of its stops by the boardings at both ends: your own boardings for a station where you entered them, else the ridership estimate's. A trip's length is along the line, and its zones are those of the stops on the way. Changes between lines are not modelled yet: each line's boardings pay that line's fare.
2. **Fare paid per boarding**: the average single fare, lowered by **passes** (the share of trips made with a monthly pass, its price in single fares and the trips a holder makes a month) and by **discount groups** (children, older people and students, each with a share of trips and a discount).
3. **The fare's effect on ridership**: a fare above the defaults lowers boardings through the **fare elasticity**, and a lower fare raises them. With the default fares the ridership estimate stays as it is.
4. **Losses**: **fare evasion** (trips that pay nothing) and the **cost of collecting fares** (ticket machines, sales, card fees, inspection) as a share of the fares paid.
5. **Later years**: ridership grows by the **yearly ridership growth**, fares change by the **yearly fare change above inflation**, and ridership answers that change through the elasticity. Amounts are in today's prices.
6. **Low, medium and high** are the 10th, 50th and 90th percentile of 200 draws over the ranges of the values that describe how people travel (ridership, pass and group shares, trips per pass, elasticity, growth, evasion, collection cost). The fares, pass price, discounts and yearly fare change are your choices, so they stay as you set them.

## The tables

- **Fare revenue, first year**, boardings a year, average fare paid, and fare revenue over 30 years.
- **First year per line**: boardings after the fare's effect, the average trip (km, and zones for zonal fares), the single fare, the fare paid per boarding, the fares paid, the collection cost and the fare revenue, per line, per mode and for all lines.
- **Year by year, all lines**: boardings, fares paid, collection cost and fare revenue for years 1 to 5, 10, 15, 20, 25 and 30.

## Changing values

Owners and Editors can change every value under **Fare settings**. Fares are entered in the project's currency; the defaults are 2023 international dollars from the assumption library, converted with the price level of the project's country (World Bank PPP factor) like the operating costs. Setting a value replaces the medium; low and high move with it. Clearing it brings the default back. Sources and reasoning are in [`assumptions/DEFAULTS.md`](../../assumptions/DEFAULTS.md) under Fares.
