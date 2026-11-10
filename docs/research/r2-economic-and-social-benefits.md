# Research R2: estimating the economic and social benefits of lines

- Date: 2026-11-09
- Status: Approved by the product owner on 2026-11-09 with changes (see the end); first version built, see [ADR-0040](../adr/0040-benefit-estimate.md)
- Asked by: product owner, 2026-11-09: estimate the benefits to the economy (GDP growth, increased land value, stimulated economy) and to the population (access to jobs, education, etc.), location based, from publicly available APIs, with formulas and variables editable per project, as low / medium / high educated estimates.
- Not in scope here: the construction and operating cost breakdown (handled in a separate thread). The "stimulated economy" estimate below reads its totals from that work.
- Related: [09 §3 cost and appraisal](../architecture/09-planning-models.md), ADR-0018 (assumption library), ADR-0034 (journey planner), [06 §3 population and jobs](../architecture/06-gis.md)

**How to read the numbers.** Default values below are starting points for the assumption library. Where a source is linked, the figure was seen in that source's abstract or summary; values marked *(to verify)* still need the full text read. In the library they start as `check: unverified` until a maintainer reads the clause, like every other parameter.

## 1. Recommendation in one paragraph

Measure what the line changes for each 100 m cell of the project area (who can now reach how many jobs, schools, universities and hospitals within a set travel time, and how close each building is to a stop or station) by running the existing journey planner with and without the line. Then turn those changes into money with four small, published formulas: **productivity (GDP)**, **resident earnings from better job access**, **land and property value uplift**, and **construction and operations spending (stimulated economy)**. Every coefficient is an assumption-library parameter with low, central and high values and a source, so it appears in Project Preferences and can be changed per project. The **low / medium / high** result is the 10th, 50th and 90th percentile of a seeded Monte Carlo over those ranges (09 §1.3), which is already the project's way of handling uncertainty. Results show per line, per mode and in total in the Tables tab.

## 2. What gets estimated

| Block | Question it answers | Output (low / medium / high) | Adds to the BCR? |
|-------|--------------------|------------------------------|------------------|
| **A. Access for people** | Who gains access to jobs, education and healthcare, and how much? | People gaining access; jobs, school places, universities and hospitals reachable per resident; change by area and by income band | No: these are counts, not money |
| **B. Productivity (GDP growth)** | How much more productive does the local economy become when firms and workers are effectively closer together? | Extra GDP per year (currency and % of regional GDP) | Yes, as a wider economic impact |
| **C. Resident earnings from job access** | How much more can residents earn because more jobs are within reach? | Extra earnings per year, by area | No by default (overlaps with B); shown for distribution |
| **D. Land and property value uplift** | How much more are buildings near the new stops worth? | One-off value uplift (currency), by station | No: it is the capitalised form of the time savings already counted, so adding it would count the same benefit twice |
| **E. Stimulated economy** | What does spending the construction and operating money do to the economy? | GDP and job-years during construction; GDP and jobs per year in operation | No: it is an economic impact, not a net benefit (the money would be spent on something else otherwise) |

The split in the last column follows the EU Guide to CBA (2014) and UK TAG, which both warn against adding land value and spending impacts to user benefits. The Tables tab would show two clear groups: **"Benefits in the appraisal"** and **"Wider context (not added)"**, so the big numbers are never added up by mistake.

## 3. Location data: which public APIs and datasets

All of these are free to use. Most are global, so the tool works anywhere; some countries have better local data that overrides the global default when it is available. Every value fetched is stored with its source, licence and retrieval date (the existing `Source` record), and any layer can be replaced by an upload.

### 3.1 Global (default everywhere)

| Data | Source and access | Resolution | Licence | Used for |
|------|------------------|-----------|---------|----------|
| Population, and by age group (school age, working age) | **WorldPop** REST catalogue + download (already planned in 06 §3) | 100 m | CC BY 4.0 | A, B, C: who lives where |
| GDP per capita (PPP) | **Kummu, Kosonen & Masoumzadeh Sayyar (2025)**, gridded GDP per capita 1990–2022, Zenodo ([paper](https://doi.org/10.1038/s41597-025-04487-x), [data](https://zenodo.org/records/10976734)) | 30 arc-sec (~1 km) and admin level 2 (43,501 units) | CC BY 4.0 | B, C, D: local income and output level; income bands for equity |
| National GDP, deflators, PPP, employment rate, sector shares | **World Bank WDI API** (already planned for cost conversion) | country | CC BY 4.0 | Scaling to the current year, workers per resident |
| Wages, labour income share, employment by sector | **ILOSTAT SDMX API** | country | CC BY 4.0 | C: earnings per worker; E: jobs per unit of output |
| Input-output tables (how spending in construction and equipment spreads through the economy) | **OECD Inter-Country Input-Output tables** (OECD Data Explorer, SDMX) | country × industry, ~76 countries | CC BY 4.0 | E: GDP and jobs multipliers; import leakage |
| Enrolment rates, school-age population | **UNESCO UIS Data API** and bulk download (the old SDMX API is retired) | country | CC BY-SA 3.0 IGO *(to verify)* | A: how many people of each age actually use schools and universities |
| Schools, universities, hospitals, shops, offices, industrial land | **OpenStreetMap** (already imported) and **Overture Maps places** | point / polygon | ODbL; CDLA-Permissive 2.0 | A: destinations; jobs proxy |
| Built-up volume, residential vs non-residential | **GHSL GHS-BUILT-V** (JRC) | 100 m | CC BY 4.0 | Jobs proxy where no jobs data exist; D: floor area where OSM buildings lack heights |
| Travel times with and without the line | **MobSimLab journey planner** (RAPTOR, ADR-0034): one-to-all earliest arrival from each cell | 100 m cells, several departure times | own | A, B, C, D |

There is **no open global jobs grid** (06 §3 already notes this). The default estimates jobs per cell from non-residential floor area (OSM buildings or GHSL) and points of interest, scaled so the cells add up to the national employment total from ILOSTAT or World Bank. It is marked as an assumption and is replaced by real jobs data wherever a regional source exists.

### 3.2 Regional sources that replace the global default

| Region | Jobs at workplace | Regional GDP | Property values |
|--------|-------------------|--------------|-----------------|
| United States | **LEHD LODES** (jobs by census block, public domain) | **BEA** county GDP API (free key) | FHFA house price index (public domain); assessor data by upload |
| European Union | **Eurostat** employment by NUTS 3 (API); **GEOSTAT 2021** 1 km census grid (employed persons, where the country supplied it) | **Eurostat** GDP by NUTS 3 (API) | Eurostat house price index; France **DVF** transactions (Licence Ouverte) |
| United Kingdom | ONS / NOMIS Business Register and Employment Survey (OGL) | ONS regional GDP | **HM Land Registry Price Paid** (OGL) |
| OECD members | OECD regional database, TL2/TL3 employment | OECD regional GDP | OECD and BIS national house price indices |
| Anywhere | Upload: CSV, GeoJSON, GeoTIFF | Upload | Upload: value per m² by zone or by building |

There is **no open global source of property values**. Where no transaction data exist, the fallback is an editable value per m² for residential and for commercial floor space, with a default derived from local GDP per capita and the national price-to-income ratio, deliberately wide and marked `educated-guess`. This is the weakest input of the whole model and the report would say so.

## 4. Formulas

Notation: *i* = a 100 m population cell (where people live), *j* = a workplace or destination cell, *b* = a building, *s* = a stop or station of the line, *t* = travel time by public transport (walk + wait + ride + change) from the journey planner, averaged over the chosen departure times. "before" = the project's base scenario without the line, "after" = with the line. Every Greek letter and every named value is a parameter in Project Preferences with low / central / high.

### A. Access for people (counts)

Jobs reachable from cell *i* within the time limit *T*:

> **A_i = Σ_j Jobs_j · [t_ij ≤ T]**

Same formula for school places (schools × average pupils per school, or uploaded capacities), universities, and hospitals (with *T* set per destination type: default 30 min for schools, 45 min for jobs and universities, 30 min for hospitals).

Reported:
- **People gaining access** = Σ_i Pop_i where the destination becomes reachable (A_i before = 0 and A_i after > 0), and the same for "gains at least *X* more jobs".
- **Average jobs reachable per resident**, before and after, weighted by population.
- The same figures by **income band** (GDP per capita quintile of the cell) so it is visible whether poorer areas gain.
- For education, the population weights use the right age group (WorldPop age rasters) times the enrolment rate (UIS), so "students who gain access" is not "everyone who lives there".

Parameters: `benefit.access_time_limit_min` per destination type, departure times averaged, jobs-per-m² by building use.

### B. Productivity: GDP growth from agglomeration

Firms are more productive when more workers and other firms are within easy reach. This is the "effective density" method of UK TAG A2.4 and of Graham (2007):

> **ED_j = Σ_k Jobs_k / (t_jk)^α**  (effective density of workplace cell *j*)
>
> **ΔGDP_j = GDP_j · ε_agg · ln(ED_j,after / ED_j,before)**
>
> **ΔGDP = Σ_j ΔGDP_j**, also reported as a % of regional GDP

- GDP_j = jobs in cell *j* × output per worker (gridded GDP per capita and national output per worker, scaled to the price year of the project).
- ε_agg (agglomeration elasticity): low 0.02, central 0.04, high 0.07. A DfT review reports a usual mean range of 0.02–0.05 ([DfT, agglomeration elasticities](https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/706671/agglomeration-elasticities-existing-evidence-and-future-priorities.pdf)); the high value covers business services in large cities *(to verify against TAG A2.4 Table 1, which also gives sector values)*.
- α (distance decay): central 1.0, range 0.8–1.8 *(to verify against TAG A2.4)*.
- Only public transport times change; car times stay the same in both scenarios until the demand model exists. That makes the estimate conservative.

### C. Resident earnings from job access

> **ΔEarnings_i = Workers_i · Wage_i · ε_acc · ln(A_i,after / A_i,before)**

- Workers_i = Pop_i (working age) × employment rate (World Bank / ILOSTAT).
- Wage_i = local GDP per capita × labour income share (ILOSTAT) ÷ employment rate.
- ε_acc (earnings elasticity to job accessibility): low 0.007, central 0.015, high 0.04. Stockholm micro-data gives 0.007 from home and 0.015 for job movers ([Isacsson et al.](https://swopec.hhs.se/ctswps/abs/ctswps2015_018.htm)); US metro studies are higher *(to verify, Melo, Graham, Levinson & Aarabi 2017)*.
- Uses the time-weighted A (Σ Jobs · e^(−β t)) rather than the hard cutoff, so the logarithm never divides by zero.

This overlaps with B (the same productivity gain seen from the worker's side), so it is shown to see **where** benefits land, not added on top.

### D. Land and property value uplift

> **ΔV = Σ_b FloorArea_b · Value_b · u(mode, use_b) · g(d_bs)**

- FloorArea_b: OSM building footprint × levels (or height ÷ 3 m, or GHSL volume). OSM buildings are already imported for the noise map.
- Value_b: value per m² from transactions or upload; otherwise the fallback in 3.2.
- d_bs: walking distance from the building to the nearest new stop or station *(only stops where access actually improved: a station on an existing service does not count again)*.
- g(d) (distance decay): 1 up to the inner radius, falling linearly to 0 at the outer radius. Defaults: rail and metro 400 / 800 m, tram and BRT 250 / 500 m, bus 0 (no uplift by default).
- u (uplift share), low / central / high:

| Mode | Residential | Commercial |
|------|-------------|------------|
| Metro, commuter rail, regional rail | 1 % / 4 % / 10 % | 4 % / 12 % / 20 % |
| Light rail, tram | 0 % / 3 % / 8 % | 2 % / 8 % / 15 % |
| BRT | 0 % / 2 % / 6 % | 0 % / 5 % / 12 % |
| Elevated line or at-grade heavy rail within 50 m | −5 % / −2 % / 0 % | 0 % / 0 % / 0 % |

  The central values follow Debrezion, Pels & Rietveld (2007): about 4.2 % for an average residence and 16.4 % for an average commercial property in the station zone ([VU research portal](https://research.vu.nl/en/publications/the-impact-of-railway-stations-on-residential-and-commercial-prop/)). Rennert (2022), with over 200 cases, finds effects from −7.4 to +9.6 percentage points ([IDEAS](https://ideas.repec.org/a/eee/transa/v163y2022icp165-180.html)). A review of 86 systems found no significant difference between BRT, light rail and metro once other factors are controlled for ([Transport Reviews 2017](https://informahealthcare.com/doi/abs/10.1080/01441647.2017.1301594)), so the mode split above is deliberately mild. The negative row covers noise and visual intrusion close to elevated and heavy rail; when a noise map exists, the noise externality (ADR-0038) is the better measure and that row is off.

### E. Stimulated economy (spending impact)

Construction (one-off, spread over the construction years) and operations (every year):

> **ΔGDP_constr = Σ_c CAPEX_c · d_c · m_GDP,c**
>
> **JobYears_constr = Σ_c CAPEX_c · d_c · m_jobs,c**
>
> same formulas with OPEX for operations, per year

- *c* = cost category from the cost thread (civil works, tunnelling, systems, vehicles, etc.), mapped to an input-output industry (construction, electrical equipment, rail vehicles, services).
- d_c = share spent in the country (the rest is imports: imported trains or a foreign TBM add little to local GDP). Default from the OECD ICIO import share of that industry; editable.
- m_GDP,c and m_jobs,c = value-added and employment multipliers for that industry and country, computed once from the OECD ICIO tables (Leontief inverse, "Type I" = direct + supply chain; "Type II" adds household spending and is the high case). For countries outside ICIO, the World Bank income-group average is used, with a wider range.
- For context only: an APTA-commissioned study for the US reports about 41,400 jobs per US$1 billion invested in transit ([APTA](https://www.apta.com/resource/economic-impact-of-public-transportation-investment/)); that figure includes later productivity gains, so it is not directly comparable to E alone.

### Low / medium / high

Each run draws all parameters from their low–central–high ranges (triangular distributions, fixed seed so results repeat), recomputes A–E, and reports the **10th percentile as low, the median as medium and the 90th percentile as high**. Setting all parameters to "all low" at once would give a much more extreme low than is realistic, which is why sampling is better. A tornado chart (already planned in 09 §3.5) shows which parameter matters most, which tells the user what to research first.

## 5. Editable formulas and variables

- **Variables:** every parameter above goes into a new `assumptions/parameters/benefits.yaml` file, so they appear under **Project Preferences → Parameters → Benefits**, with the source, the basis and a per-project override, exactly like the existing parameters.
- **Formulas:** each block's formula is stored as a short text expression over named variables (for example `GDP_j * eps_agg * ln(ED_after / ED_before)`). The project can edit it, the change is recorded like any override, and **Reset to default** brings the published formula back. Expressions are evaluated by a small safe maths parser (numbers, the named variables, + − × ÷, ^, ln, exp, min, max), never as code.
- **Data layers:** each input layer (population, GDP, jobs, property values) shows which source it came from and can be swapped for an upload.

## 6. Where it appears

- **Tables tab:** a "Benefits" section, per line, per mode and total, low / medium / high, in two groups ("In the appraisal" and "Wider context, not added"), with the method statement and sources. Exportable like the other tables.
- **GIS tab:** two optional map layers: change in jobs reachable per cell, and land value uplift per station area. *(This is a suggestion; I would only build it if you want it.)*

## 7. Limits worth knowing

- Accessibility only changes for public transport until the demand model exists, so B and C ignore people switching from cars and any road decongestion.
- The jobs layer outside the US, EU and UK is a proxy built from buildings and points of interest.
- Property values outside regions with open transaction data are educated guesses; the range is wide on purpose.
- These are educated estimates to put the project in perspective, not a substitute for a formal appraisal.

## 8. Proposed build steps (after approval)

1. Assumption library: `benefits.yaml` with all parameters and sources; the formula expression parser.
2. Data adapters: WorldPop age groups, gridded GDP, World Bank and ILOSTAT country values, OSM / GHSL jobs proxy; LODES and Eurostat as the first regional overrides; property value upload.
3. Accessibility engine: one-to-all journey planner runs from every populated cell, with and without the line (in the worker, cached per scenario).
4. Blocks A–E with Monte Carlo low / medium / high.
5. Tables tab "Benefits" section and export.
6. Block E connects to the cost breakdown once that thread has published its cost categories.

## 9. Decision (2026-11-09)

The product owner approved the approach with these points:

1. The approach is fine for now.
2. Formulas must be editable, for example ridership as a share of the people living near a station. Built as ten editable formulas in a small expression language, with the parameters in the assumption library.
3. Healthcare access is part of it: hospitals, and clinics and doctors, from OpenStreetMap.
4. No GIS layers in the calculation itself, but a region drawn or imported from OpenStreetMap with values (primary land use, land value, tax revenue, population density and others) takes priority over sourced data. Built as GIS regions.

What the first version does differently from §8: accessibility runs from the stations' catchments rather than every populated cell; jobs come from OpenStreetMap buildings; gridded GDP, ILOSTAT, LODES, Eurostat, GHSL and OECD multipliers are not read yet (regions and parameters stand in). See [ADR-0040](../adr/0040-benefit-estimate.md).
