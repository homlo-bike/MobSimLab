# Map data

In the **GIS** tab, switch to **Map data** to keep a copy of OpenStreetMap and of the terrain heights with the project. The street, railway, building, water and terrain tools then read this copy instead of asking OpenStreetMap and the elevation server each time, so they are faster, keep working when those servers are down, and everyone sees the same data date.

## The area

The import covers the box around everything drawn in the project, plus a buffer (2 km unless the project sets another). The map shows the box as a dashed line. Draw something first: an empty project has no area. When you later draw outside the box, the view says so; press **Refresh** to import the larger area. Nothing is imported on its own.

## Import OpenStreetMap

Pick where the data comes from:

- **Overpass**: for areas up to 400 km² (your administrator can change this). The area is fetched in small tiles, one after the other.
- **A Geofabrik region**: for larger areas. The view lists the regions that hold the whole area, smallest first. The file is downloaded once and kept for a week for other projects.
- **An .osm.pbf file**: your own extract, for example for an offline install.

Tick **Keep planned roads** to also import roads that are proposed or under construction. Press **Import**. The view shows each step and you can **Cancel**. The earlier import stays in use until the new one has finished, also when the new one fails.

When it is done, the view shows the date of the import, the date of the OpenStreetMap data, and how many roads, railways, buildings and stops it holds. The data is © OpenStreetMap contributors under the ODbL 1.0.

## Import elevation

Press **Import** under **Elevation** to keep the Copernicus GLO-30 heights (30 m grid) of the area. Terrain profiles and gradients then come from this copy. Cells over open sea have no heights.

Where a point has no imported height, the live Copernicus files are read, and if they cannot be, an Open-Elevation server, which is less accurate. Gradient results name the source they used.

## Who can import

Owners and Editors can import and refresh. Viewers see what was imported and when.
