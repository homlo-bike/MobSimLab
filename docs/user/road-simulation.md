# Simulator: road simulation

See how your street lines run in traffic: every bus, BRT vehicle and trolleybus leaves its depot slot, drives its trips through the street network with the cars and the traffic lights, stops at each stop for the line's dwell time, and goes back to its depot. The run uses [Eclipse SUMO](https://eclipse.dev/sumo/) on the server's background worker and is saved with the project, with a replay you can play on the map. This is Phase 5 of the [implementation plan](../architecture/12-implementation-plan.md).

## Start

1. Open a project and click **Simulator** in the top bar, then **Road simulation**.
2. Pick a **period**: morning peak 07:00–09:00, midday 11:00–13:00, evening peak 16:00–18:00, evening 20:00–22:00, or **Other** to type the times (at most 12 hours).
3. **Service before the period** (30 minutes by default, at most 120) runs the lines before the period starts, so the vehicles are spread along the lines when it does. Measures count the period only.
4. **Random seed** (1 by default): the same seed, project and period give the same run.
5. Owners and Editors click **Run on the server and save**. Viewers can open saved runs.

The panel lists what will run: every routed [street line](street-line-tool.md) with at least two stops and a departure in the period. A line that is not routed or has no departures is left out, with the reason. A line whose depot has no layout yet (see the depot tool) runs too, but its vehicles start and end on the street next to the first stop.

Saved runs work as in [Run on the server and save](simulator.md#run-on-the-server-and-save): they keep running when you close the tab, every project member can open them, and Owners and Editors can **Stop**, **Run again** and **Delete** them. While a run goes, the panel shows the step: building the street network, planning the vehicles, adding the background traffic, and the simulated time.

## What it simulates

- **Streets.** The OpenStreetMap streets around the lines and depots, with 600 m of room, as the GIS tab loads them. The street setup of the GIS tab is applied first: the number of traffic lanes, and a bus lane on the kerb side of each direction. Traffic lights come from OpenStreetMap; SUMO times them (actuated signals).
- **Depots.** The depot layout of each depot the lines use: its gates, aisles and lanes, joined to the nearest street. Each vehicle leaves from the slot the depot tool gives it and parks back in it.
- **Vehicles.** Each line's vehicle (length, width, top speed, weight) from the street line tool. The line's departures in the period (and the service before it) go to the fewest vehicles that can run them, each taking the next trip it is back in time for. A vehicle drives its pull-out run from the depot, its trips round the line's circuit from the first end stop, and its pull-in run back.
- **Stops.** At every stop the vehicle stands for the line's **dwell** time (street line tool, timing). At the end stops it also waits for its planned departure. Dwell does not depend on passengers yet.
- **Background traffic.** Cars on every street. On a street with traffic peaks set in the GIS tab, the morning and evening values are the cars per hour per direction in those peaks; elsewhere the project values `street.peak_cars_*_vph` by road type apply. Outside the two peaks the traffic is a share of the peak value, 60 % by default; change it in **Project preferences → Road simulation** (`road.off_peak_traffic_share`). Cars are not shown in the replay.
- **Energy.** Battery buses and trolleybuses run with SUMO's battery model: driving, air drag, rolling, regenerative braking and the heating and air conditioning load (`energy.hvac_power_kw`). Batteries start full, with the size of `road.battery_capacity_kwh`. Trolleybuses charge under the overhead wire (streets tagged with a trolley wire in OpenStreetMap) at `road.trolley_wire_charge_kw`. A vehicle whose battery runs empty stops where it is.

Vehicles never jump ahead: a vehicle stuck in a jam stays stuck (no SUMO teleports), and a vehicle standing still for 5 minutes away from a stop and not at a red light is reported as a gridlock.

## Results

**Run** sums up the whole run: vehicles back in their depot at the end, teleports (should be 0), gridlocks, background cars, the street network's length and traffic lights, and how much faster than real time it ran.

Each line shows, for the period:

| Measure | Meaning |
|---|---|
| Trips in the period | Trips run round the whole circuit / trips planned. |
| Circuit, planned → simulated | Planned time round the circuit (legs, dwells and layovers) and the average simulated time. |
| Average speed | Circuit length over the simulated circuit time. |
| Departures on time | Share of departures from stops at most 2 minutes after the plan. |
| Delay, average / 95 % | Departure delay at stops. |
| Bunched | Share of following departures from the same stop less than half the planned gap apart. |
| Lost in traffic, per trip | Time standing (under 0.5 m/s) away from stops and red lights. |
| Lost at traffic lights, per trip | Time standing at a light that is not green. |
| Energy | Battery and trolleybus lines: kWh per km and in all, the lowest battery charge, and vehicles that ran out. |

**Events** lists gridlocks, vehicles that ran out of charge and vehicles not back in the depot by the end, with the time.

## Replay

A finished run shows **Replay**. **Play** moves the line vehicles on the map, in their line's colour, at the chosen **speed** (1× to 300× real time); **Pause** stops, **Reset** goes back to the start, and the **time** slider jumps to any moment. Vehicles in the depot are drawn paler; at closer zoom each vehicle shows its line and number.

## Not yet

- Dwell is fixed per line; it does not depend on how many people board and alight.
- Background traffic follows the peak values per street, not origin–destination demand or traffic counts.
- There is no live view while a run goes; the replay comes when it is done.
- Results are saved with the run in the project, not exported as Parquet files.
- The run time target of NFR-PERF-04 has not been measured on a city-sized network yet.
