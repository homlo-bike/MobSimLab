/**
 * English messages of the .mslab project files (save a project as a file, open a file as a new project) on the
 * projects home. Merged into each language's dictionary; every language has its own file next to this one.
 */
export const mslabEn = {
  "menu.saveMslab": "Save as .mslab file",
  "home.openMslab": "Open .mslab file",
  "home.openingMslab": "Opening the file…",
  "home.openedMslab": "Opened “{name}” as a new project.",
  "home.leftOut": "Left out: {list}",
  "mslab.body":
    "Saves the project’s drawings, preferences, scenarios and plugins in one file that you can open again on any MobSimLab.",
  "mslab.runs": "Include saved simulation runs (makes the file larger)",
  "mslab.map":
    "Include map data for the static viewer: streets, buildings, population and country figures of the project area (larger file; can take a few minutes)",
  "static.empty":
    "No projects in this site yet. Put .mslab files in its projects folder and run tools/add-projects.mjs.",
  "mslab.save": "Save file",
  "savedFiles.title": "Saved project files",
  "savedFiles.intro":
    "Choose what a saved .mslab file holds. A project opened from the file uses this data straight away. Sizes are before the file is compressed.",
  "savedFiles.refresh": "Refresh",
  "savedFiles.loadFailed": "The sizes could not be loaded.",
  "savedFiles.whenSaving": "Made when the file is saved",
  "savedFiles.none": "None yet",
  "savedFiles.from": "From {source}",
  "savedFiles.at": "Last updated {date}",
  "savedFiles.update": "Update",
  "savedFiles.updateOf": "Update {name}",
  "savedFiles.always": "Always saved",
  "savedFiles.later": "Not saved in files yet: coming in a later update",
  "savedFiles.include": "Include {name} in saved files",
  "savedFiles.total": "Saved in files now: {size} before compression",
  "savedFiles.design": "Drawings and settings",
  "savedFiles.vehicles": "Own vehicles and fleet",
  "savedFiles.processed": "Worked-out results (timetables, tables, GIS, schematic)",
  "savedFiles.runs": "Simulation and demand runs (with OD matrices)",
  "savedFiles.comments": "Comments and threads",
  "savedFiles.history": "History of changes",
  "savedFiles.osm": "OpenStreetMap data of the project area",
  "savedFiles.liveTiles": "Map tiles the tools fetched live",
  "savedFiles.elevation": "Elevation",
  "savedFiles.population": "Population",
  "savedFiles.uploads": "Your uploaded map, elevation and population files",
  "savedFiles.facts": "Location facts (country, holidays, climate)",
  "savedFiles.economy": "Economic data (World Bank)",
  "savedFiles.otherFetched": "Other fetched data (shared bikes, water depths, places)",
  "savedFiles.viewerMap": "Map data for the static viewer",
  "mslab.results":
    "Include the results the tools worked out (the project opens without working them out again)",
  "mslab.vehicles": "Include the project’s own vehicles and fleet",
  "mslab.fromPrefs": "These choices start from Project preferences → Saved project files.",
  "mslab.comments": "Include comments and their threads",
  "mslab.history": "Include the history of changed values",
  "mslab.fromFile": "from the project file",
} as const;

export type MslabMessages = Record<keyof typeof mslabEn, string>;
