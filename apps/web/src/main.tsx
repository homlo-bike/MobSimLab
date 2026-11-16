import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";
import { logUncaughtErrors } from "./logging/logger";
import { STATIC_VIEWER } from "./static/mode";
import { staticFetch } from "./static/shim";

// The static viewer has no server: its stand-in answers the app's API requests from the site's project files.
if (STATIC_VIEWER) {
  const base = window.fetch.bind(window);
  window.fetch = staticFetch(base);
}
logUncaughtErrors();

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
