# Simulator: test the system

Find out whether your lines work: do the rail lines fit the tracks, do the trains and buses run on time, do small delays die out, how many trains could each line carry, and does everyone fit in the vehicles? The rail method is in [ADR-0032 §3 step 8 and §4](../adr/0032-railway-operations-management.md).

To run your street lines in traffic, from their depots and back, see [Road simulation](road-simulation.md).

## Start

1. Open a project and click **Simulator** in the top bar. **Test the system** is the first view of the panel.
2. Choose the network:
   - **Example metro**: line M1 Westpark – Eastgate, five stations, a depot at each end, every 5 minutes in the peaks and every 10 minutes otherwise. It is there to try the test before your own railway exists.
   - **Drawn in this project**: the railway drawn in the [railway tool](railway-tool.md) and its service lines, and the project's [street lines](street-line-tool.md), as saved. It is picked by default when the project has a service line with at least two stops and a train, or a routed street line with at least two stops. The test builds the railway with its terrain heights, as the Tables tab does, and plans the lines as **Publish timetable** does: same stops, train, headways, peaks and stabling. Lines without two stops or a train are left out. A drawing with errors is not tested; the panel says to fix it in the railway tool first. You do not need to publish the timetable first.
   - **From files**: pick two files, the **track topology** (in the railway tool, **Download track topology (JSON)**) and a **lines file** (below).
3. Pick a **period**: morning peak 07:00–09:00, midday 11:00–13:00, evening peak 16:00–18:00, evening 20:00–22:00, or **Other** to type the times.
4. Leave **Passenger loads** on to see how full the vehicles get (lines drawn in the project only; see below).
5. Leave **Also find the most trains each line can carry** on to try other frequencies (it takes longer: one more test per frequency).
6. Click **Run the test**. Everything runs in your browser; **Stop** ends the frequency search after the current step.

## Run on the server and save

Owners and Editors of the project can also click **Run on the server and save**. The same test, with the same network, period and settings, then runs on the background worker of the server instead of in your browser:

- It keeps running when you close the tab or the project.
- It is saved to the project. **Saved runs** lists every run of the project, newest first, with who started it and when, and every member of the project (Viewers included) can open one to see its results.
- While it runs, the panel shows what the worker is doing (planning the period, or which frequency it is trying) and the results so far. **Stop** ends it after the current step and keeps what it found.
- If the worker stops in the middle (a restart of the server), the run is marked **Failed** with a note to start it again.
- **Run again** (Owners and Editors) runs an open saved run again with its own network, period and settings and replaces its result; it moves to the top of the list with your name.
- **Delete** (Owners and Editors) removes the run and its result for everyone, after you confirm. A run that is still going is stopped.

Runs wait their turn: the server runs as many at the same time as it has background workers (`MOBSIMLAB_SIM_WORKERS` in `.env`, 1 by default), and the others show **Waiting** until a worker is free.

The result is the same as in the browser: both use the same Rust code. The run in the browser stays as it was, instant and not saved. With **Drawn in this project**, the server runs the rail lines; street lines and passenger loads run in the browser only.

## What the test does

For the period, with half an hour of service before it (so the line is full when the period starts) and half an hour after it:

1. **Plan.** The timetable planner places every trip on blocking times, with the minimum buffer between trains. Trips it cannot fit are counted.
2. **Measure.** The blocking time stairways of each hour are pushed together (UIC 406 compression). The share of the hour they take is the **capacity used**, for the line and for its busier terminal's platforms. The UIC 406 recommended limit is 85 % for metro and suburban lines and 75 % for mixed traffic (`capacity.occupancy_limit_share`).
3. **Run.** The period runs through the interlocking and train protection, second by second: routes are set and released, switches move, trains keep their distance. Any deadlock or safety event is reported.
4. **Disturb.** The period runs again 8 times. Each time, one trip in five starts late, on average by 45 s and at most by 3 minutes (metro values; the same seed gives the same delays). The test measures the delay passed on to other trips and the delay left 15 minutes before the end of the half hour after the period, with no new delays. **Delays die out** when less than 30 s is left on average; otherwise they **pile up**.
5. **Search** (optional). The same test at the next clock-face frequencies (for example every 4, 3, 2.5 and 2 minutes after every 5). When the planned service does not work, longer headways are tried instead.

## Street lines

Each street line runs the timetable the journey planner rides: a departure from its first end stop every headway (half the headway in the project's weekday peaks from Project preferences → Calendar and years, by default 07:00–09:00 and 16:00–19:00), the routed running time of each leg, the line's dwell at every stop and its layover at every end stop. One vehicle runs the whole circuit and takes the next departure once it is back; at an end stop it waits for its scheduled departure, so the layover soaks up delay.

Every trip meets its own traffic. The routed running time already holds the expected delay in main-road traffic (Project preferences: `street.mixed_traffic_delay_share` and `street.bus_lane_delay_share`); each trip gets between 0.4 and 2 times that delay (the assumption's low and high ends, most often the central value). The period runs as many times as the rail test (**Test settings**: runs, seed, late threshold), with half an hour of service before and after it.

Each street line card shows:

- **On time**: the share of stop departures in the period no later than the late threshold, with the average delay and the delay 95 % stay within;
- **Circuit**: the planned circuit time with dwell and layover, the part of it in traffic, and the circuit as run;
- **Vehicles**: how many the timetable needs at the period's shortest headway;
- **Bunching**: the share of gaps between following vehicles shorter than half the planned gap, and the delay left at the end;
- **Keeps to time** when less than 30 s of delay is left on average at the end of the half hour after the period, else **Delays pile up**.

## Passenger loads

With **Passenger loads** on, each drawn line (rail and street) gets a **Passengers** block: the busiest point in the period, the load there against the places in the vehicles, and how many people are left behind for the next vehicle.

- **Boardings** per station or stop are a weekday's, from the [Tables tab's ridership estimate](benefit-tables.md) (the `ridership_daily` formula over the people, jobs and students near the station, shared among the lines that call there). The Tables tab estimates the stations of the published network, so publish the rail timetable first. Under **Boardings per station or stop** you can type your own weekday number for any station or stop (all lines together); it replaces the estimate and is saved with the project. Leave the field empty to go back to the estimate.
- **Hours.** Each hour of the project's weekday peaks (Project preferences → Calendar and years; by default 07:00–09:00 and 16:00–19:00) carries `benefit.ridership.peak_hour_share` of the day (10 %); the rest of the day is spread evenly over the other service hours of the weekday (by default 05:00–00:30).
- **Where people go.** People who board at a stop ride to the line's other stops in proportion to those stops' boardings. In a peak hour the busier direction carries `benefit.ridership.peak_direction_share` of the riders (60 %); off the peak, and on a loop line, both are the same. Both shares are in the Tables tab's parameters.
- **Places.** A train has its catalogue places times the units coupled; a bus has `mode.vehicle_capacity` (75, BRT 120, intercity coach 50).
- **Left behind**: on the busiest link of each hour, the riders above the places of the vehicles that pass in that hour, added over the period.

## Verdicts

| Verdict | Meaning |
|---|---|
| Works as intended | Fits with margin, runs on time, delays die out. |
| Works, close to the limit | As above, but the busiest part is within 10 % of the recommended limit. |
| Runs, above the recommended limit | Fits and recovers in the test, but busier than UIC 406 recommends. |
| Delays pile up | Fits, but small delays spread and do not die out. |
| Not enough capacity | Trips cannot be given a conflict-free path, or the plan does not run. |

Each line card shows the capacity used (line and terminal), the most trains per hour at 100 % and at the limit, punctuality without and with delays, and, after the search, **Works up to N trains an hour each way**: the highest frequency tried that works or works close to the limit.

The frequencies do not always improve in order. A line can work every 5 minutes but not every 6 when the turn-backs at a terminal fit one pattern and not the other; the table lists every frequency tried.

**Test settings** changes the number of runs, the share and size of late starts, the recommended limit, the buffer between trains, the late threshold and the seed. The defaults and their sources are in the assumption library (`stability.*`, `capacity.occupancy_limit_share`, `timetable.min_buffer_s`, `recording.late_threshold_s`). Values you set in **Project preferences → All parameters** are the starting point; the signalling and driving values there (route setting, release, sighting, braking…) also reach the planner and the kernel. Drawn lines take their dwell, layover, running-time supplement, acceleration and service braking from there too, for the line's mode or for every mode.

## Lines file

The lines file is the one the timetable planner reads (`crates/rail-plan/examples/publish_journeys.rs`): `{"lines": [ ... ]}`, each line with

- `id`, `name`;
- `calls`: the stations in order, each `{"pick": {"Group": "Station name"}, "stop": true, "dwell_s": null}` (or `{"Station": "<station id>"}`, or `{"Platforms": ["<platform id>", ...]}` with the preferred one first);
- `train`: running-time parameters (`length_m`, `mass_kg`, `rotating_mass_factor`, `max_tractive_effort_n`, `power_w`, `davis_a_n`, `davis_b_n_per_mps`, `davis_c_n_per_mps2`, `service_decel_mps2`, `max_speed_mps`);
- `dwell_s`, `turnback_s`, `supplement_share`;
- `stabling`: storage track ids the line's trains may use;
- `bands`: `{"from_s", "to_s", "headway_s"}` in seconds from the start of the service day;
- `return_offset_s`: `null` to let the planner choose.

A lines file can also hold the railway tool's service lines, `{"service_lines": [ ... ]}`, in the form **Publish timetable** sends them to the planner (`rail_plan::ServiceLine`). Each may give `dwell_s`, `turnback_s`, `supplement_share`, `accel_ms2` and `decel_ms2`; absent ones take the mode's values.

## Not yet

- Passenger loads use the line-by-line estimate above, not a full demand model with transfers between lines (ADR-0019).
- Street lines run one after the other: buses of different lines do not meet each other at stops or junctions.
