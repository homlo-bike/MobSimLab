/**
 * The worlds of the plugin API (contracts/wit/plugin.wit, package `mobsimlab:plugin@1.0.0`) and what a component
 * of each may import and must export, as jco names them in JavaScript.
 */

export type World = "calculation" | "importer" | "exporter";

/** The one function each world exports (camelCase, as the transpiled glue exposes it). */
export const WORLD_EXPORT: Record<World, string> = {
  calculation: "calculate",
  importer: "importFiles",
  exporter: "exportFiles",
};

/** Interfaces a component may import; anything else (WASI included) is refused. */
export const ALLOWED_IMPORTS = new Set(["mobsimlab:plugin/host"]);

/** The plugin API version the host implements. */
export const PLUGIN_API_VERSION = "1.0.0";

/** Purpose: whether a string names a world. */
export const isWorld = (w: unknown): w is World =>
  w === "calculation" || w === "importer" || w === "exporter";

/**
 * Patterns that must not appear in the JavaScript glue jco writes for a component. jco only writes the code
 * that lifts and lowers values and instantiates the core modules; this is a second check that nothing in a
 * component made it load code, reach the network or post messages.
 */
export const FORBIDDEN_IN_GLUE: [RegExp, string][] = [
  [/^\s*import\s/m, "a static import"],
  [/\bimport\s*\(/, "a dynamic import"],
  [/\brequire\s*\(/, "require"],
  [/\beval\s*\(/, "eval"],
  [/\bFunction\s*\(/, "the Function constructor"],
  [
    /\b(fetch|XMLHttpRequest|WebSocket|EventSource|importScripts|postMessage|indexedDB|localStorage)\b/,
    "a browser API",
  ],
  [/\bprocess\s*\./, "the Node process object"],
];
