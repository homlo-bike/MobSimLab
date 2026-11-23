# Project files (.mslab)

A `.mslab` file holds a whole project, so you can keep a copy, send it to someone, or move it to another
MobSimLab.

## Save a project as a file

On the projects home, open the project's menu (right-click, the ⋯ button, or a long press on a phone) and
choose **Save as .mslab file**. Tick **Include saved simulation runs** to add the finished runs of the
simulator, with the replays of road runs; the file gets larger. Anyone who can open a project can save it.

The file holds the project's name, description, area and modes, every drawing saved with the project (railway,
service line timetables, street lines, depots, street setups, GIS regions, schematic, scenarios, preferences,
costs, benefits, fares, cargo bike and any other tool that saves with the project), and which plugins are on.
It does not hold the people with access, the view-only link or the project's history. OpenStreetMap, terrain
and population data are not copied in: the project refers to them, and MobSimLab loads them again.

Tick **Include map data for the static viewer** to also add the map data of the project area: the
OpenStreetMap streets, paths, railways, buildings and places, the water, the population grid and the country
figures the cost and benefit tables use. The [static viewer](static-viewer.md) shows the project with them,
without a server. The map data covers the map tiles that meet the project area's
polygons, up to 20,000 tiles and 300 MB. The tiles of each kind are kept together in one compact archive, so
an intercity project with its corridors fits in one file (the Damascus–Aleppo project with the M5 corridor:
1,033 tiles, 7.7 MB). Saving can take a few minutes when the tiles are not cached yet.
A file with map data uses format 1.4; a MobSimLab that opens it leaves the map data out and loads its own.

## Open a file

On the projects home choose **Open .mslab file** and pick the file. It always becomes a **new project** that
you own; no existing project is changed. If the file holds something this MobSimLab cannot take, for example a
plugin that is not installed here or a tool from a newer version, the rest is opened and a message lists what
was left out.

A file saved by a newer MobSimLab with a newer file format is refused; update MobSimLab first. Files of older
formats are upgraded as they are opened.

During the beta, [examples/projects](../../examples/projects/README.md) holds a test project to open this way: a tram
and bus network for Damascus.

## Safety

Files are checked before anything is saved: every file inside must match the checksum in the manifest and the
published JSON Schemas, and the file must not unpack to more than 512 MB. The upload is read in a separate,
locked-down process with no network and no access to the server's files (see
[the tool-runner](../../apps/api/src/tool-runner/README.md)).

## The format

The format is documented in [ADR-0021](../adr/0021-project-file-format.md) and
[10 §2.2](../architecture/10-collaboration-storage.md#22-project-file-format-mslab-adr-0021), with JSON
Schemas for every file in [`contracts/mslab`](../../contracts/mslab).
