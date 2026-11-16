# ADR-0044: Fare revenue from the ridership estimate, a chosen fare structure and editable fare values

- Status: Proposed (first version built: Tables tab fare revenue table)
- Date: 2026-11-16
- Deciders: product owner, architecture
- Related: 09-planning-models §3.1, ADR-0018 (assumption engine), ADR-0039 (cost tables), ADR-0040 (benefit
  tables), ADR-0041 (schematic and tariff zones)

## Context

The financial appraisal (FNPV, FIRR) needs fare revenue a year. The product owner asked (2026-11-16) for a fare
revenue model in the Tables tab with flat, zonal and distance-based fares (the planner picks one per project),
tickets and passes with discount groups, a fare elasticity of ridership, yearly fare and ridership changes, fare
evasion and the cost of collecting fares, all with a Monte Carlo range. Every value must be editable per project,
with flexible defaults. Ridership comes from the benefit tables' estimate now and from the demand model later.

## Decision

1. **Boardings** of a line a year are the benefit tables' `ridership_annual` (low, medium, high).
2. **Trips of a line** are spread between each pair of its stops in proportion to the boardings at both ends
   (the planner's own boardings by station name, else the estimate's weekday boardings with central values;
   equal when neither is known). A trip's length is along the line (routed street length, or straight lines
   between rail stops, as on the Schematic tab); its zones are the different tariff zones of the stops on the
   way, using the zones drawn on the Schematic network map and the diagram's station positions. A stop outside
   every zone counts as a zone of its own; without zones every trip is in one zone. Transfers are not modelled:
   each line's boardings pay that line's fare. The demand model's trip matrix can replace this spread later.
3. **Single fare** by structure: flat; zonal = first zone + extra per further zone; distance-based = base + per
   km, with an optional cap.
4. **Fare paid per boarding** = average single fare × (1 − pass share + pass share × pass price in single fares ÷
   trips per pass a month) × (1 − Σ group share × group discount) for children, older people and students.
5. **Fare effect on ridership**: boardings × (fare paid ÷ fare paid with the library's default fares)^elasticity,
   so the defaults leave the estimate unchanged.
6. **Later years**: ridership grows by the yearly growth; fares change by the yearly change above inflation, and
   ridership answers that change through the elasticity. Year 1 is the first year of operation, in today's prices.
7. **Losses**: fares paid = boardings × (1 − evasion) × fare paid; collection cost = a share of fares paid; fare
   revenue = fares paid − collection cost. Both are shown so the appraisal can count collection either way.
8. **Values** live in `assumptions/parameters/fares.yaml` (group Fares), exported by `tools/fares/export_defaults.py`.
   Fares are 2023 international dollars (PPP), converted like operating costs (PPP factor × US GDP deflator, into
   the project's currency). The project's own values and fare structure are kept in the drawing kind `fares`,
   fares in international dollars so a change of currency keeps them right.
9. **Monte Carlo**: 200 seeded draws, triangular over low–central–high, giving the 10th, 50th and 90th
   percentiles. Values the project decides (fares, pass price, discounts, yearly fare change) stay at the project's
   value; ridership (one draw for all lines), pass and group shares, trips per pass, elasticity, growth, evasion
   and collection cost vary. `fareDraw` takes the random numbers as a function, so the appraisal can draw fare
   revenue together with costs.

## Consequences

- The appraisal gets fare revenue year by year per line, per mode and in total, with a range.
- Zonal fares depend on the zones being drawn on the Schematic tab; the table says when none are.
- Trip lengths and zones come from a simple spread along each line; network trips with transfers wait for the
  demand model.
