# Benefit tables

Below the cost tables, the **Tables** tab estimates what the lines do for the economy and for the people living near them: ridership, GDP growth, land value, tax revenue, the economy stimulated by building and running them, and access to jobs, schools, universities, hospitals and clinics. The numbers are educated estimates (low, medium and high) to put the project in perspective, not a forecast. The design is in [ADR-0040](../adr/0040-benefit-estimate.md) and the research behind it in [Research R2](../research/r2-economic-and-social-benefits.md).

## How it works

1. **Stations and their catchments.** Every station of a street line or a published rail service line gets the area within walking distance (`mode.catchment_m`: 400 m for buses up to 800 m for metro and rail).
2. **People, jobs and places** in each catchment, from the first source that has them:
   - population from a [region](gis-regions.md) you entered, else WorldPop (100 m grid, 2020, brought to today with the World Bank's population growth), else the floor area of homes in OpenStreetMap;
   - jobs from a region, else the floor area of offices, shops, industry and public buildings in OpenStreetMap;
   - schools, universities and colleges, hospitals, clinics and doctors from OpenStreetMap;
   - GDP per person, the share of residents with a job and the share of children from a region, else the World Bank for the project's country.
3. **Travel times with and without.** The journey planner works out the door-to-door times between all stations at 07:30, 08:00 and 08:30 for the whole network, for no network, and for the network without each line and each mode. A line's benefit is what the network loses without it; the total compares with no network.
4. **The formulas** turn those numbers into the estimates. Each parameter is drawn 200 times within its low–high range; the tables show the 10th, 50th and 90th percentile as low, medium and high.

## The tables

Choose under **Show** whether the tables are for **All lines**, one mode or one line.

- **Ridership**: people near stations who use them on a weekday, and boardings a year.
- **In the appraisal**: GDP growth a year from bringing jobs and people closer together (agglomeration, as in the UK's TAG A2.4). This is the benefit that can be added to a cost–benefit appraisal.
- **Wider context, not added to the appraisal**: earnings of residents from better access to jobs, land value uplift near stations, property tax from that uplift, and GDP and job-years from building and running the lines (from the cost tables). They describe the same benefit from other sides, so adding them up would count it more than once.
- **Access for people**: per kind of place (jobs, schools, universities and colleges, hospitals, clinics and doctors), how many people gain access within the time limit, and how many a resident reaches on average before and with the lines.
- **Per line**: weekday riders, GDP growth and the people gaining access to jobs, per line.
- **Data sources**: where each number came from, and which regions you entered took priority.

## Changing formulas and values

Owners and Editors can change the project's estimate:

- **Formulas**: each estimate's formula is editable. For example weekday riders are `pop * resident_share * trips_per_user`: the people near the stations × the share of them who use the line × trips per user a day. Formulas can use + − × ÷ ^, brackets and ln, log10, exp, sqrt, abs, min and max, and the variables listed below each formula. A formula that cannot be read shows the problem and is not saved; **Reset to the default** brings back the original. Formulas are saved with the project.
- **Parameters**: the medium value of every parameter (catchment share, trips per user, elasticities, uplift shares, time limits, floor area per job, multipliers and others), next to the library's low, medium and high values. Values you change are saved as project preferences and used for the estimate's medium value.
- **Regions**: the most direct way to use local knowledge. Values you enter for a region drawn or imported in the GIS tab replace the sourced ones inside it. See [Regions](gis-regions.md).

## Limits

- Only public transport travel times change; people leaving their cars and less road congestion are not counted yet, so GDP growth and earnings are on the low side.
- Outside regions with your values, jobs come from building floor area in OpenStreetMap and land values from GDP per person; both are rough.
- Cable car and ferry lines are not included yet.
