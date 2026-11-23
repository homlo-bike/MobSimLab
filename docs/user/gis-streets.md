# Streets in the GIS tab

The GIS tab also measures the [walk coverage and stop spacing](gis-walk.md). The [Population](gis-population.md) view imports WorldPop or GHSL for the project area, or your own population files.

Say how a street is shared, where OpenStreetMap is missing or wrong, or to test a change such as a new bus lane, a street closed to cars or a tram with its own lanes. Your layout overrides OpenStreetMap in the [street line tool](street-line-tool.md), the [railway tool](railway-tool.md) and the [road simulation](road-simulation.md), for running times and for the reliability and safety checks.

## Set up a street

1. Open the project's **GIS** tab and zoom in to street level (zoom 13 or closer). The streets on screen load by themselves, as in the street line tool.
2. Tap a street. Its panel shows a cross-section of the street and two choices:
   - **OSM default** keeps the lanes OpenStreetMap gives the street.
   - **Custom layout** lets you lay the street out yourself, section by section from building to building. **Customise this street** starts from the street's lanes as OpenStreetMap describes them (from zoom 16; zoomed out, from a typical street with its lane count).
3. In a custom layout, the strip at the top shows the sections left to right, looking along the street as OpenStreetMap draws it, to scale. Tap a section to change it:
   - **What is it?** A **Lane or path**, **Parking**, a **Traffic island**, a **Green strip** (trees, grass or shrubs) or **Protection** (a kerb, bollards or planters).
   - **Who can use it?** For a lane or path, pick one or more of **Cars**, **Buses**, **Trams**, **Bikes**, **Taxis** and **Pedestrians**. One is a lane of its own (a bus lane, a tram lane, a sidewalk); more than one is mixed traffic, such as a tram lane buses may use, or general traffic of cars, buses and bikes. Lanes trams use have rails.
   - **Direction**: **↑ With** runs the way the street is drawn, **↓ Against** the other way, **↕ Both** either way.
   - **Width** in metres. Under the strip, the total width is compared with the street's width where OpenStreetMap tags it.
   - **←** and **→** move the section, so a bus lane can go in the middle. **Duplicate** copies it, **Remove** takes it out.

   **+ Add section** adds an empty section after the selected one. **Start from a template** replaces the layout with a ready-made one: centre bus lanes behind kerbs, trams and people only, protected bike lanes, or trams with buses and cars beside them. **OSM default** goes back to OpenStreetMap's lanes.
4. **Reliability and safety** says what the layout means for cars, buses, trams and cyclists. **Reset to OpenStreetMap** removes the setup.
5. Setups are saved with the project, for everyone who opens it (see [Saving](street-line-tool.md#saving)). Setups an earlier release kept only in your browser move into the project the first time you open it.

From zoom 16 the map draws each street lane by lane, with its junctions, as OpenStreetMap describes it or as you laid it out, in your order and widths. The cross-section then shows the street's own lanes at their widths (parking lanes, kerbs and tram tracks too); zoomed out, it shows a typical street for the setup. Traffic keeps to the project's driving side (**Project preferences → Parameters**, `street.driving_side`).

On the map, streets are coloured by how well buses and trams are protected from traffic: green for a separated bus or tram lane, blue for a painted one, orange for a main road where they run in traffic, grey for other streets. Streets you set up have a dark outline and are listed under **Streets set up**; tap one in the list to go to it.

The setups are saved in your browser for this project, until projects keep their drawings on the server.

## What changes

**Buses, BRT, trolleybuses and intercity buses** (street line tool). On main roads (trunk, primary and secondary roads), buses in the general traffic take about 25 % longer than at the speed limit at peak, and buses in a painted bus lane about 8 % longer (`street.mixed_traffic_delay_share` and `street.bus_lane_delay_share` in the assumption library). Owners and Editors can change both values for the project under **Project preferences → Running time in traffic**; the street line tool, the railway tool and the texts in this tab then use the project's values, and **Use the library value** goes back to the default. The values are saved with the project. A separated bus lane or a busway has no delay. The delay is part of the running time, the cycle and the vehicles needed. The panel's **Reliability** line shows how much of the circuit runs in traffic and in bus lanes. When at least 200 m runs in main-road traffic, a check names those roads.

**What a custom layout means for traffic.** Lanes cars may use are the general traffic lanes in each direction; their directions make the street one-way or two-way. A lane of buses (or taxis) without cars is a bus lane. A bus, tram or bike lane of its own counts as separated when parking, a traffic island, a green strip or protection is next to it, and as painted otherwise. A street with no lane for cars is closed to cars, lorries and their traffic, and buses on it are not held up. A street with no lane buses may use is closed to buses: bus routes go round it. A tram has its own lane when, in each direction it runs, a lane without cars carries it; a tram sharing a lane with cars runs in mixed traffic.

**Trams** (railway tool). A tram in the traffic of a main road gets a warning: it is held up in traffic jams and can be stuck in gridlock. Setting the street to **Own lane** resolves the warning. A painted own lane leaves a note that cars still get in the way; **Kerb or barrier** removes it too. The same delays as for buses apply to the tram's running time: about 25 % longer than at the speed limit in a main road's traffic, about 8 % in a painted own lane, and none in a separated own lane or off main roads. Railway operations use them in the timetable's running and blocking times, and in the simulator the tram keeps to the traffic's pace there. The track topology gives each street-running stretch whether it is separated, whether the planner set it (`source`), and the expected delay share in traffic (also per section, `traffic_delay_share`).

**Cyclists**. Where a tram runs in mixed traffic without a bike lane, cyclists ride along the rails, and a wheel caught in the groove is a common cause of falls. It is a warning on main roads and a note elsewhere. A bike lane resolves it.
