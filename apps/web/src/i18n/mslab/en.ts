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
} as const;

export type MslabMessages = Record<keyof typeof mslabEn, string>;
