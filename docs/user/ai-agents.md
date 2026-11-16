# AI agents

Connect Claude, or any other app that speaks the Model Context Protocol (MCP), to MobSimLab and ask it to build stop and line scenarios, check them against the 15-minute walk rule, improve them and compare them. MobSimLab never runs or pays for an AI model: the agent uses your own AI account and calls MobSimLab's tools with your permission. The design is in [ADR-0035](../adr/0035-ai-agent-integration-mcp.md).

## Who can connect

Owners, Admins and Editors (the "user" role). Viewers and Restricted users cannot connect agents or create tokens. If your role is lowered to Viewer, every agent you connected stops working on its next call.

## Connect Claude

1. In MobSimLab, open the account menu and click **AI agents**. Copy the address shown under *Connect Claude or another MCP app*. It is your instance address followed by `/mcp`, for example `https://mobsimlab.example.org/mcp`.
2. In Claude, add a **custom connector** with that address (Settings → Connectors → Add custom connector). Claude finds MobSimLab's sign-in by itself.
3. Your browser opens MobSimLab. Sign in if asked, then the consent page shows the app's name, where it will send you back, and what it may do:
   - **project:read**: read your agent scenarios (stops, lines, service levels, validation).
   - **analysis:run**: run analyses (stop spacing, walk coverage, catchments, journeys, benchmarks).
   - **scenario:write**: create agent scenarios and change them. Never the base network, sharing, users or settings.
   - **simulation:run**: read your projects' saved simulation runs, and start, stop and rerun rail capacity runs and settings sweeps in projects where you are an Owner or Editor.
   Untick what you do not want and click **Allow**.
4. Ask Claude, for example: *"Create a scenario with a bus line from the station to the hospital every 10 minutes, then tell me what share of the area is within a 15-minute walk of a stop and where the gaps are."*

The instance must be reachable from the AI app over HTTPS. For an instance on a private network, use a client that runs inside that network (for example Claude Code on your computer) or a personal access token from a script.

## Personal access tokens (scripts, CI)

Under **Personal access token** in the AI agents panel, give the token a name, pick the scopes and how many days it lasts (1 to 365), and click **Create**. The token is shown once; copy it then. Send it as `Authorization: Bearer msl_pat_…` to `/mcp`. Tokens start with `msl_` so secret scanners recognise them if one leaks.

## What agents can do

| Tool | What it does | Scope |
|------|--------------|-------|
| `list_scenarios`, `get_scenario` | Your agent scenarios and their stops, lines and validation | project:read |
| `get_assumptions` | Default stop spacing, speeds, headways, walk speed and the 15-minute rule, with sources; with a scenario, the values its analyses use | project:read |
| `create_scenario` | A new empty scenario or a copy of one, optionally linked to a project so its analyses use the project's values from Project preferences → All parameters | scenario:write |
| `apply_changes` | Add, move, rename or remove stops; add, change or remove lines; set the study area. Bus, trolleybus and BRT lines are routed along real streets | scenario:write |
| `validate_scenario`, `diff_scenarios` | Problems in a scenario; what differs between two | project:read |
| `delete_agent_scenario` | Delete a scenario this connection made (never yours) | scenario:write |
| `measure_stop_spacing` | Spacing along each line and on foot, against the guidance for the mode | analysis:run |
| `coverage_report` | Share of the area within an N-minute walk of a stop along streets, next to the crow-flies figure, in 5-minute bands. With the `ptal` preset: the TfL PTAL band (0 to 6b) | analysis:run |
| `find_coverage_gaps`, `walk_catchment` | Where people are farther than the limit; the walk catchment as a map layer | analysis:run |
| `suggest_stop_locations` | Up to k new stops that cover the most uncovered demand, at least a set distance apart, solved exactly | analysis:run |
| `accessibility_to_destinations` | The 15-minute city: food shops, primary schools, GPs or clinics, pharmacies, parks and workplaces within N minutes on foot, by bicycle, or on foot and public transport | analysis:run |
| `plan_journey` | Door-to-door journeys on the scenario's lines at a time of day | analysis:run |
| `export_gtfs` | The scenario as a GTFS Schedule feed (zip), from the same timetable `plan_journey` rides | project:read |
| `benchmark_scenarios` | Coverage, journey times, line length, run times, cycle time and fleet for several scenarios side by side | analysis:run |
| `list_projects`, `list_runs` | Your projects and your role in each; a project's saved simulation runs | simulation:run |
| `start_run` | The simulator tab's rail capacity run on the background worker, saved with the project | simulation:run |
| `run_sweep` | The capacity run once per variant of its settings, in one job, with the Pareto front | simulation:run |
| `get_run_status`, `cancel_run`, `rerun` | Follow a run and read its result; stop it; run it again in place | simulation:run |

The headline is the 15-minute walk to the nearest stop or station (`walk_minutes` preset). The SDG 11.2.1 rule (500 m to any stop, 1000 m to rail and BRT), the per-mode catchment rule, the frequent-service rule and PTAL are available as secondary presets. Every result names the rule, the parameters and where the defaults come from.

### PTAL

`coverage_report` with `preset: "ptal"` grades each point by Transport for London's Public Transport Accessibility Level (TfL, *Assessing transport connectivity in London*, 2015). For every line, the walk to its nearest stop is measured along the street network at TfL's 80 m/min, up to 640 m for bus and tram and 960 m for rail, metro and light rail. Half the headway and a reliability allowance (2 min for bus, 0.75 min for rail and tram) are added, which gives the access time. 30 divided by the access time is the line's equivalent doorstep frequency; per mode the best line counts in full and the others at half weight, and the modes are added up to the access index. The index is banded 0, 1a, 1b, 2, 3, 4, 5, 6a and 6b. The walk speed and limits are TfL's, not the project's, so the bands compare with published PTAL maps. The report gives the share in each band, the share at PTAL 4 or better and the mean index; `list_points` also returns the graded points as GeoJSON.

### The 15-minute city

`accessibility_to_destinations` counts the daily needs each place reaches within N minutes (default 15, `analysis.walk_rule_minutes`), following Moreno et al. (2021):

- `walk`: along the street network at 4.5 km/h (`demand.walk_speed_kmh`), 20 s at each signalised crossing.
- `cycle`: at 15 km/h (`analysis.cycle_speed_kmh`) on streets, cycleways and paths open to bicycles; footways and pedestrian zones only where bicycles are signed in, never steps or motorways.
- `walk_transit`: on foot and the scenario's lines with the journey planner, for departures every 10 minutes between 07:00 and 09:00 (both can be set), and the median count over those departures, so one lucky connection does not count. Walks from the last stop follow the street network; the walk to the first stop is still the journey planner's straight line × 1.3. At most 400 places are evaluated this way.

Destinations come from OpenStreetMap: food shops (`shop=supermarket`, `convenience`, `greengrocer`, `bakery`, `butcher`, `deli`, `grocery`, `farm`, `amenity=marketplace`), primary schools (`amenity=school` unless marked secondary only), GPs and clinics, pharmacies, parks (`leisure=park`, counted at the centre of the park) and workplaces (`office`, `craft`, industrial and commercial land, `man_made=works`). The list is versioned and its version is printed with every result. An agent can send its own destinations instead, for example jobs or services from a local register, with any category names. The report gives, per category, the share of demand that reaches at least one and the median count, the share that reaches every category, and the places that miss the most as GeoJSON.

### Stop placement

`suggest_stop_locations` solves the maximal covering location problem (Church & ReVelle, 1974): which k candidate points along the scenario's routes, no two closer than the mode's shortest stop spacing, bring the most uncovered demand within the walk limit. A quick greedy choice is made first, then the exact problem is solved as a mixed-integer programme with HiGHS (MIT licence) within a time limit (default 10 s, at most 60 s). The result says whether HiGHS proved the choice optimal; if time runs out, the better of the two choices is returned. `exact: false` gives the greedy choice only.

### Simulation runs and sweeps

Agents run the simulator tab's **rail capacity run** on the background worker ([simulator guide](simulator.md)): the period's timetable is planned on the track and run, and stability is tested with random primary delays. The network is the example metro, the railway editor's topology and lines files, or the network of a run already saved in the project (`network: {kind: "run", run_id}`), so the agent does not need to send files again. Runs are saved with the project, like the ones you start yourself: every member sees them under **Saved runs**, and they show who started them, including the agent. An agent acts with your role in the project: it can read runs where you are a member, and start, stop and rerun them only where you are an Owner or Editor.

`start_run` and `run_sweep` return at once with a run id. The agent then calls `get_run_status`, which gives the progress while the run goes and a summary when it is done: the verdict, the fleet and the key figures of each line (capacity consumption, punctuality with and without delays, knock-on delay). `detail: "full"` returns the whole result when it is small enough.

`run_sweep` varies the capacity run's settings (for example the minimum buffer, the reserve share, or the size and share of primary delays) and runs every variant in one job, without one agent call per variant:

- **Grid:** every combination of the listed values.
- **Latin hypercube** (McKay, Beckman & Conover, 1979): a set number of variants spread evenly over ranges, drawn with a seed so the same sweep gives the same variants.

Each variant is measured (verdict, trains needed, trains out at peak, unplaced trips, highest capacity consumption, lowest punctuality with and without delays, largest knock-on and residual delay), and the result keeps the **Pareto front** over the objectives the agent picks: the variants no other variant beats on every objective. A sweep runs at most 200 variants and keeps the period fixed. Sweeps are in the project's runs list for agents and the API; the simulator tab lists capacity runs only.

## Seeing what agents did

- **Connected agents and tokens** lists each app and token with its scopes, last use and its recent actions. **Disconnect** stops it at once.
- **Scenarios** lists agent scenarios with an *Agent* badge. **Show** draws its stops and lines on the map with the 15-minute walk catchment (green within 5 minutes, yellow 10, orange 15) and prints the coverage headline.
- Every change an agent makes is in the audit trail with the app, the tool and a fingerprint of the arguments. Runs an agent starts, stops or reruns are in the project's audit trail with the app and the tool.
- Admins can switch off **Let AI apps register themselves**; then no new app can register, and apps already registered or connected keep working until disconnected.

## How the walk is measured

Walks follow the street network from OpenStreetMap at 4.5 km/h, avoid motorways and paths marked `foot=no`, add 20 s at each signalled crossing, and can be limited to step-free paths. Until population data is loaded, coverage counts the length of walkable street within the limit (labelled *street length proxy*); an agent can also send its own demand points (homes, jobs, schools), and the report then counts those. All defaults are in the assumption library (`walk.*`, `analysis.*`, `mode.stop_spacing_m`).

## Limits

- Agent scenarios live in your own workspace, not in shared projects yet; people cannot be invited to them.
- Rail lines without a timetable from the railway operations planner use run times from the vehicle's speed and acceleration, and the frequency the agent gives.
- In `plan_journey`, walks to and between stops are still straight-line distance × 1.3 (as in the [journey planner](journey-planner.md)).
- `export_gtfs` writes a weekday feed in which each line runs at its headways (one template trip per direction and period, repeated by `frequencies.txt`). It uses the GTFS plugin's exporter. The agent gives the time zone; the agency is the scenario name and this instance unless set. The feed is not run through the MobilityData GTFS Validator.
- Each agent connection may have 2 runs queued or running at once; a third is refused until one finishes or is stopped. People starting runs in the simulator tab are not counted.
- Agents run only the rail capacity run and sweeps of its settings. Headways are swept per line with `start_run`'s `sweep_headways`, as in the simulator tab. A KPI catalogue for runs, experiments over several scenarios and `compare_results` wait until scenarios can be simulated on the worker.
- MobSimLab answers agents with one response per call, so progress is read with `get_run_status`, not pushed as MCP progress notifications.
- At most 200 scenarios per user, 2000 stops and 100 lines per scenario; calls are rate limited per connection.
