import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

// MapLibre 6 looks for its worker next to its own module, which does not exist once Vite bundles it. Every module
// that makes a map imports this first (the workspace map, the area window).
setWorkerUrl(workerUrl);
