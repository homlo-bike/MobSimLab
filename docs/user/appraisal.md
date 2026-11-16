# Appraisal

At the bottom of the **Tables** tab, the appraisal weighs what the lines cost against what they bring, year by year, discounted to today. The design is in [ADR-0045](../adr/0045-appraisal.md).

## What it counts

- **Costs** from the [cost tables](cost-tables.md): construction, spread evenly over the construction years; each asset class (civil works; track, power and signalling; vehicles) bought again at the end of its life; the value left at the end of the period returned in the last year; and the operating cost every year.
- **Fare revenue** from the [fare revenue table](fare-revenue.md), after the cost of collecting fares.
- **Users' benefit** from the [demand model](demand-model.md): what public transport is worth to the trips, compared with the same trips with no public transport (time, comfort and money, valued with the model's value of time). Pick a run for ridership in the Demand section; runs made before the appraisal existed need running again.
- **Car-km saved**, from the same comparison, times the external costs of a car-km: climate, air pollution, noise, accidents and congestion.
- **GDP growth** from agglomeration, from the [benefit tables](benefit-tables.md). Earnings, land values and spending impacts stay out, so nothing is counted twice.

## Results

- **ENPV, ERR and benefit-cost ratio**: every benefit to society against the costs, at the social discount rate (by the World Bank income group of the project's country: 3.5 % high income, 6 % upper-middle income or unknown, 8 % lower-middle and low income; set your country's rate if it has one).
- **FNPV and FIRR**: the operator's view, fares against costs, at the financial discount rate.
- Per line, per mode and for all lines, with low, medium and high from 200 random draws over the ranges of the values. The timeline, the discount rates and the conversion factor stay as you set them.
- A **year-by-year** cash flow and the **present values** of each item.

## Sensitivity

- The **tornado chart** shows how far the ENPV moves when one value goes to its low or its high. Hover a bar for the numbers, or open the table under it.
- **Switching values** tell how much an item can change before the ENPV reaches 0.
- **Standard tests**: construction cost +20 % and +40 %, ridership −20 %, opening two years later, operating cost +10 %.

## Multi-criteria analysis

The lines are ranked by a weighted sum of criteria: ENPV, boardings a year, jobs, schools and universities, and hospitals and clinics reachable (gain per resident), and construction cost. Each criterion scores 0 for the worst line and 100 for the best. Change the weights, or **Add a criterion** of your own, name it, say whether higher or lower is better, and score each line.

## Settings

Every value can be changed under **Appraisal settings**, or in Project preferences → All parameters → Appraisal: construction and appraisal periods (per mode), discount rates, the conversion factor, asset lives, the growth of the value of time and the external costs of a car-km. Setting a value replaces the medium; low and high move with it.
