# ADR-0045: Appraisal from the cost, fare, demand and benefit tables: NPV, IRR, BCR, multi-criteria analysis and sensitivity

- Status: Proposed (first version built: Tables tab appraisal)
- Date: 2026-11-16
- Deciders: product owner, architecture
- Related: 09-planning-models §3.2–3.5, ADR-0018 (assumption engine), ADR-0019 (demand model), ADR-0039 (cost
  tables), ADR-0040 (benefit tables), ADR-0044 (fare revenue)

## Context

The product owner asked (2026-11-16) for the appraisal: NPV, IRR, benefit-cost ratio, multi-criteria analysis
and sensitivity (tornado chart, switching values), combining the cost tables, fare revenue and the benefits, with
every value editable and flexible defaults. The product owner chose to wait for the demand model (so the users'
travel time benefit counts) and for the fare revenue model, approved the default timeline (4-year build, 30-year
period after opening for rail and 20 for bus-only, social discount rate 5 % or 3 % by country after the EU CBA
Guide, financial rate 4 %, vehicles renewed every 30 years for rail and 12 for bus, straight-line residual value,
conversion factor 1.0), a weighted-sum multi-criteria analysis, tornado chart, switching values and Monte Carlo,
and no export for now.

## Decision

1. **Users' benefit from the demand model.** Each demand run also chooses the same weekday trips again with no
   public transport (same skims, same destinations; the worker's `steps.gain`). The users' benefit is the
   change in the mode-choice logsum divided by the in-vehicle time coefficient, times the value of time of the
   trip purpose: the rule-of-half-free consumer surplus of the nested logit, net of the fares paid. Trips with no
   other way to travel are left out and counted. The car trips and car vehicle-km the network saves come from the
   same comparison. The result's `appraisal` block holds them for the weekday. The appraisal splits them between
   the lines by the run's weekday boardings, and makes them yearly with the mode's weekday equivalents a year.
2. **Cash flow per year.** Construction (civil works, systems, vehicles from the cost tables) is spread evenly over
   the construction years; each asset class is bought again at the end of its life and its remaining value comes
   back in the last year (straight line). From opening: operating cost, fare revenue (net of collection cost, from
   the fare revenue model's draws), the users' benefit (growing with ridership and the value of time), the
   car-km saved times the external costs a car-km (climate, air pollution, noise, accidents, congestion), and GDP
   growth from agglomeration (benefit tables, the only wider benefit added, as in ADR-0040).
3. **Results.** ENPV, ERR and BCR at the social discount rate, with the conversion factor on costs; FNPV and
   FIRR from fares and the operator's costs at the financial rate. Rates of return by bisection; none when the
   value does not change sign. Per line, per mode (with the shared items no line runs on yet) and in total, each on
   the longest construction and appraisal period of its modes.
4. **Social discount rate.** 3 % in EU members outside the Cohesion Fund, 5 % elsewhere (EU CBA Guide 2014);
   outside the EU the planner sets the national rate as the project's value.
5. **Uncertainty.** Low, medium and high are the 10th, 50th and 90th percentile of 200 seeded draws: construction
   and operating cost from the cost tables' range, ridership from the benefit tables' range (the same draw as the
   fare revenue model, so fares and benefits move together), GDP growth, asset lives, value-of-time growth and
   external costs from their ranges. The timeline, discount rates and conversion factor are the planner's choice
   and stay fixed.
6. **Sensitivity.** A tornado chart of the ENPV with each value at its low and high, the others at the medium; the
   switching values of construction cost, operating cost, ridership, the users' benefit and GDP growth (the ENPV is
   linear in each); and the standard tests of 09 §3.4 (construction +20 % and +40 %, ridership −20 %, opening two
   years later, operating cost +10 %).
7. **Multi-criteria analysis.** Weighted sum over the lines: ENPV, boardings a year, jobs, education and healthcare
   reachable per resident (gain, from the benefit tables) and construction cost, each scored 0–100 between the worst
   and the best line; weights are assumption-library values (equal by default). The planner adds criteria and
   scores lines by hand; they are saved as the drawing kind `appraisal`.
8. **Parameters** in `assumptions/parameters/appraisal.yaml` (group *Appraisal*), exported by
   `tools/appraisal/export_defaults.py`, saved as project preferences so they also show in All parameters.

## Alternatives considered

| Option | Why not |
|--------|---------|
| Two demand runs, with and without the lines, picked by the planner | The product owner was asked; one run gives the comparison automatically and the same skims keep the difference clean. |
| Rule-of-half on generalised cost skims | The model is a nested logit; the logsum change is the consistent measure and covers mode switching. |
| Adding land value, earnings and spending impacts | Double counting (EU CBA Guide, UK TAG); they stay as wider context in the benefit tables. |
| Outranking (PROMETHEE, ELECTRE) for the multi-criteria analysis | Not asked for; the weighted sum is transparent and editable. |
| Export to XLSX, CSV or PDF | Left out at the product owner's request. |

## Consequences

- Destinations are held fixed in the comparison and road congestion is not reassigned without public transport,
  so the users' benefit and the car-km saved are conservative; the congestion external cost a car-km stands in for
  the road users' time saved.
- The demand model's fare (`demand.mode.fare_usd`) and the fare revenue table's fares are set separately; keep them
  close.
- Emissions of the buses and trains themselves are not yet counted against the car-km saved.
- The external cost values are educated averages from the EU Handbook (2019) marked `unverified`; read the
  Handbook's country tables before relying on them.
- Demand runs made before this change have no `appraisal` block; run the demand model again to count the users'
  benefit.
