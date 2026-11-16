/** Set by Vite `define` (vite.config.ts). */
declare const __APP_VERSION__: string;
declare const __APP_BUILD__: string;

/** Pino's browser build has no type file of its own; it has the same API as the Node build. */
declare module "pino/browser.js" {
  import pino from "pino";
  export default pino;
}
