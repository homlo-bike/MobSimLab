/**
 * Whether this is the static viewer (`vite build --mode static`, `pnpm build:static`): no server, the projects
 * come from the site's `/projects` folder, and only the Simulator, Schematic, Tables and Project preferences
 * tabs show, read-only.
 */
export const STATIC_VIEWER: boolean = import.meta.env.MODE === "static";

/** The project tabs the static viewer shows. */
export const STATIC_TABS: readonly string[] = ["simulator", "schematic", "tables", "preferences"];
