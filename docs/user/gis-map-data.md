# Map data

In the **GIS** tab, switch to **Map data** to keep a copy of OpenStreetMap and of the terrain heights with the project. The street, railway, building, water and terrain tools then read this copy instead of asking OpenStreetMap and the elevation server each time, so they are faster, keep working when those servers are down, and everyone sees the same data date.

## The area

The import covers the box around everything drawn in the project, plus a buffer of 2 km. Owners and Editors can change the buffer (0 to 50 km) with **Buffer (km)** and **Save buffer**; the same buffer is used for the population import. The map shows the box as a dashed line. Draw something first: an empty project has no area. When you later draw outside the box, the view says so; press **Refresh** to import the larger area. Nothing is imported on its own.

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

## Your own elevation grid

If you have better heights than GLO-30, such as a LiDAR terrain model from your city or country, upload it under **Your own elevation grid**:

1. Optionally fill in its **Source**, **Licence** and **Vertical accuracy (m)**. They are shown with the grid and next to gradient results.
2. If the file does not name its coordinate system, give it as an EPSG code (for example `EPSG:25832`), a PROJ string or WKT (the text of a `.prj` file).
3. Press **Choose a GeoTIFF file** and pick the file (heights in metres, up to 500 MB unless your administrator set another limit).

The grid is cut to the project area and converted to longitude and latitude at about its own resolution. Where it has heights it is used before GLO-30; elsewhere GLO-30 still answers. Uploading another file replaces it, and **Remove** goes back to GLO-30 everywhere.

## Who can import

Owners and Editors can import and refresh. Viewers see what was imported and when.
