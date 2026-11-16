# Population

In the **GIS** tab, switch to **Population** to bring population data into the project: WorldPop or GHSL for the project area, or your own files. You then choose which layer the [noise map](gis-streets.md), the [walk analysis](gis-walk.md) and the [benefit tables](benefit-tables.md) use. Until you choose one, they read WorldPop live for each area, as before.

## Project area

The project area is the box around everything drawn in the project (lines, the railway, depots and regions), widened by a **buffer** in km (2 km unless you change it). It is outlined with a dashed line on the map. Imports cover only this box, at most 10,000 km².

## Import WorldPop or GHSL

- **WorldPop**: the constrained 100 m grid, for a year from 2015 to 2030.
- **GHSL GHS-POP** (European Commission, JRC): 100 m (3 arc seconds, the default) or about 1 km (30 arc seconds), for the epoch nearest the year you pick (1975 to 2030, every 5 years).

Choose the source, the year and your **confidence** in it, then **Import**. The server downloads the data once and stores the cells of the project area; the layer shows its progress. Both are licensed CC BY 4.0 and the layer keeps the citation.

## Upload your own data

| File | What it holds |
|------|---------------|
| GeoTIFF (`.tif`) | A grid of people per cell, or people per km². You can keep only the cells in the project area. |
| GeoJSON (`.geojson`, `.json`) | Zones (polygons) or points with a field holding the people, and optionally a zone id field. |
| CSV with points | A longitude (or x) column, a latitude (or y) column and a people column. |
| CSV with values per zone | A zone id column and a people column, joined to GeoJSON zones you uploaded before (for example census tables and their boundaries). |

Give the layer a name, its licence, source address, citation, reference year and confidence. The coordinate system is read from the file; if it has none, or the wrong one, enter it as `EPSG:nnnn`, a PROJ string or the text of the `.prj` file. Files can be up to 200 MB.

## Choose the layer the project uses

Under **Population used by the project**, pick a ready layer, or WorldPop live. The noise map, walk analysis and benefit tables then count people from it and name it in their credits. People of zones and points are spread over the 100 m cells whose centres fall inside them.

## Map and difference

Under **Map and difference**, show one layer on the map, or one layer minus another to compare sources: blue where the first has more people, red where it has fewer. Choose the cell size (500 m unless you change it).

Each layer can be renamed, have its details changed or be deleted. Layers are saved with the project; viewers can see them but not change them.
