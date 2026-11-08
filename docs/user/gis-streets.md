# Streets in the GIS tab

Say how a street is shared, where OpenStreetMap is missing or wrong, or to test a change such as a new bus lane. Your setup overrides OpenStreetMap in the [street line tool](street-line-tool.md) and the [railway tool](railway-tool.md), for running times and for the reliability and safety checks.

## Set up a street

1. Open the project's **GIS** tab and zoom in to street level (zoom 13 or closer). The streets on screen load by themselves, as in the street line tool.
2. Tap a street. Its panel shows a cross-section of the street as set up and these settings. Each one starts at **OSM**, which keeps what OpenStreetMap says.
   - **Traffic lanes**: general traffic lanes in both directions, not counting bus or tram lanes.
   - **Bus lane**: a bus lane in each direction of travel.
   - **Bike lane**: a bike lane in each direction of travel.
   - **Separation from traffic**: a kerb, barrier or separate track bed between the bus, tram and bike lanes and the traffic (**Kerb or barrier**), or only paint (**Painted**).
   - **Tram**: for tram track along the street, **Own lane** or **Mixed traffic**. With **OSM**, the railway tool decides from the street's width.
3. **Reliability and safety** under the settings says what the setup means for buses, trams and cyclists. **Reset to OpenStreetMap** removes the setup.
4. Setups are saved with the project, for everyone who opens it (see [Saving](street-line-tool.md#saving)). Setups an earlier release kept only in your browser move into the project the first time you open it.

On the map, streets are coloured by how well buses and trams are protected from traffic: green for a separated bus or tram lane, blue for a painted one, orange for a main road where they run in traffic, grey for other streets. Streets you set up have a dark outline and are listed under **Streets set up**; tap one in the list to go to it.

The setups are saved in your browser for this project, until projects keep their drawings on the server.

## What changes

**Buses, BRT, trolleybuses and intercity buses** (street line tool). On main roads (trunk, primary and secondary roads), buses in the general traffic take about 25 % longer than at the speed limit at peak, and buses in a painted bus lane about 8 % longer (`street.mixed_traffic_delay_share` and `street.bus_lane_delay_share` in the assumption library). A separated bus lane or a busway has no delay. The delay is part of the running time, the cycle and the vehicles needed. The panel's **Reliability** line shows how much of the circuit runs in traffic and in bus lanes. When at least 200 m runs in main-road traffic, a check names those roads.

**Trams** (railway tool). A tram in the traffic of a main road gets a warning: it is held up in traffic jams and can be stuck in gridlock. Setting the street to **Own lane** resolves the warning. A painted own lane leaves a note that cars still get in the way; **Kerb or barrier** removes it too. The same delays as for buses apply to the tram's running time: about 25 % longer than at the speed limit in a main road's traffic, about 8 % in a painted own lane, and none in a separated own lane or off main roads. Railway operations use them in the timetable's running and blocking times, and in the simulator the tram keeps to the traffic's pace there. The track topology gives each street-running stretch whether it is separated, whether the planner set it (`source`), and the expected delay share in traffic (also per section, `traffic_delay_share`).

**Cyclists**. Where a tram runs in mixed traffic without a bike lane, cyclists ride along the rails, and a wheel caught in the groove is a common cause of falls. It is a warning on main roads and a note elsewhere. A bike lane resolves it.
