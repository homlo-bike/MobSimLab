# Journey planner

Benchmark your network: how long does it take to get from A to B, and how does that change through the day? The design is in [ADR-0034](../adr/0034-journey-planner.md).

## Start

1. Click **Journey planner** in the top bar. The panel opens on the right.
2. Choose the network to route on:
   - the **street line** you drew in the street line tool (draw it first, then open the planner; it runs at its headway off-peak and twice as often in the peaks, 07:00–09:00 and 16:00–19:00, from 05:00 to 00:30), and/or
   - the **rail lines** published in the railway tool (see _Rail timetables_ below): they appear under **Network** as _Rail lines from the railway tool_, and the checkbox leaves them out.
3. Click **A**, then click the map; then the same for **B**. Drag the markers to move them.
4. Pick **Depart at** or **Arrive by** and a time.

## What you see

- **Total time**, the arrival (or departure) time and the number of changes.
- **The split** as a bar and a list: walking, waiting for the first vehicle, in vehicle, walking and waiting at changes, and (arrive-by) how early you arrive. The parts add up to the total.
- **Leave at …**: when leaving at the asked time means waiting at the stop, the latest time to leave and still make the same vehicles, with the door-to-door time.
- **Itinerary**: every walk, wait and ride, with line, stops and platform. _Timed connection_ marks a guaranteed connection at a node.
- **Alternatives**: slower journeys with fewer changes, if there are any.
- **Through the day**: the same question every 5–60 minutes from 04:00 to 01:00, as stacked bars. Hover a bar for its split; click it to plan that time. **Show as table** lists the numbers. Fastest, median and slowest times are shown above the chart.

## Rail timetables

The railway operations planner turns a railway design and its lines into exact, conflict-free trains. Draw the lines in the railway tool under **Service lines** and click **Publish timetable** (see [the railway tool](railway-tool.md#service-lines)); the journey planner then routes on the trains.

Each platform edge is a stop at the middle of the edge, named after its station. Trains and street lines connect at stations:

- all platforms of one station (and station parts with the same name) are one station;
- a street stop with the **same name** as a station is part of it when it is within 600 m (_Same-name stops are one station within_ under **Walking and changing**). The naming tool gives a bus stop beside a station the station's name, so this happens without extra work. The network line under **Network** says how many stops were joined this way.

Changing within a station is the walk between the two stops plus 60 s for stairs or lifts.

## Walking and changing

Until the walking network exists, a walk is the straight-line distance × 1.3 at 4.5 km/h. Under **Walking and changing** you can set the walking speed, the longest walk to a stop (1000 m) and at a change (400 m), how far apart two stops with the same name may be and still be one station (600 m), the time to change at one stop (60 s) and the most vehicles in a journey. Changing between two platforms of one station adds 60 s for stairs or lifts unless the timetable gives the time. All defaults are in the assumption library (`demand.walk_speed_kmh`, `journey.*`).

## Limits

Delays, fares, step-free routing, crowding and staying seated when a vehicle continues as another line are not modelled yet. On the map, walks and rides are drawn as straight lines between stops.
