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
   Untick what you do not want and click **Allow**.
4. Ask Claude, for example: *"Create a scenario with a bus line from the station to the hospital every 10 minutes, then tell me what share of the area is within a 15-minute walk of a stop and where the gaps are."*

The instance must be reachable from the AI app over HTTPS. For an instance on a private network, use a client that runs inside that network (for example Claude Code on your computer) or a personal access token from a script.

## Personal access tokens (scripts, CI)

Under **Personal access token** in the AI agents panel, give the token a name, pick the scopes and how many days it lasts (1 to 365), and click **Create**. The token is shown once; copy it then. Send it as `Authorization: Bearer msl_pat_…` to `/mcp`. Tokens start with `msl_` so secret scanners recognise them if one leaks.

## What agents can do

| Tool | What it does | Scope |
|------|--------------|-------|
| `list_scenarios`, `get_scenario` | Your agent scenarios and their stops, lines and validation | project:read |
| `get_assumptions` | Default stop spacing, speeds, headways, walk speed and the 15-minute rule, with sources | project:read |
| `create_scenario` | A new empty scenario or a copy of one | scenario:write |
| `apply_changes` | Add, move, rename or remove stops; add, change or remove lines; set the study area. Bus, trolleybus and BRT lines are routed along real streets | scenario:write |
| `validate_scenario`, `diff_scenarios` | Problems in a scenario; what differs between two | project:read |
| `delete_agent_scenario` | Delete a scenario this connection made (never yours) | scenario:write |
| `measure_stop_spacing` | Spacing along each line and on foot, against the guidance for the mode | analysis:run |
| `coverage_report` | Share of the area within an N-minute walk of a stop along streets, next to the crow-flies figure, in 5-minute bands | analysis:run |
| `find_coverage_gaps`, `walk_catchment` | Where people are farther than the limit; the walk catchment as a map layer | analysis:run |
| `suggest_stop_locations` | Up to k new stops that cover the most uncovered demand, at least a set distance apart | analysis:run |
| `plan_journey` | Door-to-door journeys on the scenario's lines at a time of day | analysis:run |
| `benchmark_scenarios` | Coverage, journey times, line length, run times, cycle time and fleet for several scenarios side by side | analysis:run |

The headline is the 15-minute walk to the nearest stop or station (`walk_minutes` preset). The SDG 11.2.1 rule (500 m to any stop, 1000 m to rail and BRT), the per-mode catchment rule and the frequent-service rule are available as secondary presets. Every result names the rule, the parameters and where the defaults come from.

## Seeing what agents did

- **Connected agents and tokens** lists each app and token with its scopes, last use and its recent actions. **Disconnect** stops it at once.
- **Scenarios** lists agent scenarios with an *Agent* badge. **Show** draws its stops and lines on the map with the 15-minute walk catchment (green within 5 minutes, yellow 10, orange 15) and prints the coverage headline.
- Every change an agent makes is in the audit trail with the app, the tool and a fingerprint of the arguments.
- Admins can switch off **Let AI apps register themselves**; then no new app can register, and apps already registered or connected keep working until disconnected.

## How the walk is measured

Walks follow the street network from OpenStreetMap at 4.5 km/h, avoid motorways and paths marked `foot=no`, add 20 s at each signalled crossing, and can be limited to step-free paths. Until population data is loaded, coverage counts the length of walkable street within the limit (labelled *street length proxy*); an agent can also send its own demand points (homes, jobs, schools), and the report then counts those. All defaults are in the assumption library (`walk.*`, `analysis.*`, `mode.stop_spacing_m`).

## Limits

- Agent scenarios live in your own workspace, not in shared projects yet; people cannot be invited to them.
- Rail lines without a timetable from the railway operations planner use run times from the vehicle's speed and acceleration, and the frequency the agent gives.
- In `plan_journey`, walks to and between stops are still straight-line distance × 1.3 (as in the [journey planner](journey-planner.md)).
- Not yet available: simulation runs and parameter sweeps, PTAL, the 15-minute-city destination preset, GTFS export, and an exact optimiser for stop placement (the suggestion is a greedy best-first choice).
- At most 200 scenarios per user, 2000 stops and 100 lines per scenario; calls are rate limited per connection.
