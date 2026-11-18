# Example projects

Project files (`.mslab`) for testing MobSimLab during the beta. Open one on the projects home with
**Open .mslab file**; it becomes a new project that you own (see [Project files](../../docs/user/project-files.md)).

## Damascus tram and bus network

`damascus-tram-and-bus-network.mslab` is the acceptance test project: a tram and bus network for Damascus and
the suburbs of Rif Dimashq.

- Trams T1 to T5 follow the alignments of the 1907 to 1967 tramway and reuse the Hejaz Railway corridor.
- Buses B1, B2 (airport express), B7, O2, O4, W1, E1 and N1 connect the suburbs and the airport, with orbital
  and through-running lines so that not every trip goes through the centre.
- C1 is a cable car from Muhajreen to the Qasioun viewpoint.
- No line runs through the walled Old City or on a motorway.

The file holds the drawings, depots, timetables, schematic and preferences, without simulation runs or map data.
The map data (streets, buildings, population) loads on the instance that opens it. It holds no keys or personal
data. It was saved with format 1.0.0, so newer MobSimLab versions upgrade it as they open it.
