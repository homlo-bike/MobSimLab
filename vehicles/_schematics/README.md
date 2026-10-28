# Vehicle schematics

Hand-drawn side views that replace the drawing the app generates from a vehicle's geometry
(`length`, `consist`, `doorsPerSide`, `livery`). None exist yet; the folder is here so they can be
added later without a schema change.

To add one:

1. Draw the side view as SVG and save it here as `<manufacturer>_<model>.svg`, the same name as
   the catalogue file (for example `stadler_citylink-vbk.svg`).
2. Draw to scale: 1 SVG unit = 1 mm, `viewBox="0 0 <length mm> <height mm>"`, rail or road level
   at the bottom edge, cab A on the left.
3. Draw it yourself or from a source you may use. Do not trace manufacturer drawings or photos.
   Schematics are published with the catalogue under CC BY 4.0.
4. Point the vehicle at it:

   ```json
   "schematic": {
     "file": "vehicles/_schematics/stadler_citylink-vbk.svg",
     "author": "Your name",
     "licence": "CC-BY-4.0",
     "created": "2026-11-01"
   }
   ```

   For a vehicle made by `tools/vehicles/convert.py`, put the same object in
   `vehicles/_import/schematics.yaml` under the vehicle's `legacyId` instead, so a rebuild keeps it.

`tools/vehicles/check.py` fails if the file is missing or named after another vehicle.
