# Simulator: test the system (capacity run)

Find out whether your rail lines work: do they fit the tracks, do they run on time, do small delays die out, and how many trains could each line carry? The method is in [ADR-0032 §3 step 8 and §4](../adr/0032-railway-operations-management.md).

## Start

1. Open a project and click **Simulator** in the top bar. **Test the system** is the first view of the panel.
2. Choose the network:
   - **Example metro**: line M1 Westpark – Eastgate, five stations, a depot at each end, every 5 minutes in the peaks and every 10 minutes otherwise. It is there to try the test before your own railway exists.
   - **My railway**: pick two files, the **track topology** (in the railway tool, **Download track topology (JSON)**) and a **lines file** (below).
3. Pick a **period**: morning peak 07:00–09:00, midday 11:00–13:00, evening peak 16:00–18:00, evening 20:00–22:00, or **Other** to type the times.
4. Leave **Also find the most trains each line can carry** on to try other frequencies (it takes longer: one more test per frequency).
5. Click **Run the test**. Everything runs in your browser; **Stop** ends the frequency search after the current step.

## What the test does

For the period, with half an hour of service before it (so the line is full when the period starts) and half an hour after it:

1. **Plan.** The timetable planner places every trip on blocking times, with the minimum buffer between trains. Trips it cannot fit are counted.
2. **Measure.** The blocking time stairways of each hour are pushed together (UIC 406 compression). The share of the hour they take is the **capacity used**, for the line and for its busier terminal's platforms. The UIC 406 recommended limit is 85 % for metro and suburban lines and 75 % for mixed traffic (`capacity.occupancy_limit_share`).
3. **Run.** The period runs through the interlocking and train protection, second by second: routes are set and released, switches move, trains keep their distance. Any deadlock or safety event is reported.
4. **Disturb.** The period runs again 8 times. Each time, one trip in five starts late, on average by 45 s and at most by 3 minutes (metro values; the same seed gives the same delays). The test measures the delay passed on to other trips and the delay left 15 minutes before the end of the half hour after the period, with no new delays. **Delays die out** when less than 30 s is left on average; otherwise they **pile up**.
5. **Search** (optional). The same test at the next clock-face frequencies (for example every 4, 3, 2.5 and 2 minutes after every 5). When the planned service does not work, longer headways are tried instead.

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

**Test settings** changes the number of runs, the share and size of late starts, the recommended limit, the buffer between trains, the late threshold and the seed. The defaults and their sources are in the assumption library (`stability.*`, `capacity.occupancy_limit_share`, `timetable.min_buffer_s`, `recording.late_threshold_s`).

## Lines file

The lines file is the one the timetable planner reads (`crates/rail-plan/examples/publish_journeys.rs`): `{"lines": [ ... ]}`, each line with

- `id`, `name`;
- `calls`: the stations in order, each `{"pick": {"Group": "Station name"}, "stop": true, "dwell_s": null}` (or `{"Station": "<station id>"}`, or `{"Platforms": ["<platform id>", ...]}` with the preferred one first);
- `train`: running-time parameters (`length_m`, `mass_kg`, `rotating_mass_factor`, `max_tractive_effort_n`, `power_w`, `davis_a_n`, `davis_b_n_per_mps`, `davis_c_n_per_mps2`, `service_decel_mps2`, `max_speed_mps`);
- `dwell_s`, `turnback_s`, `supplement_share`;
- `stabling`: storage track ids the line's trains may use;
- `bands`: `{"from_s", "to_s", "headway_s"}` in seconds from the start of the service day;
- `return_offset_s`: `null` to let the planner choose.

## Not yet

- Passenger loads (who is left behind on a full train) need the demand model; the test is about trains and tracks.
- Lines drawn in the railway tool will feed the test directly, without a lines file.
- Street lines (bus, tram in traffic) are not part of this test.
