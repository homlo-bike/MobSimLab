import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { preloadLanguage } from "./i18n/i18n";
import "./index.css";
import { logUncaughtErrors } from "./logging/logger";
import { STATIC_VIEWER } from "./static/mode";
import { setTheme, storedTheme } from "./shell/theme";
import { staticFetch } from "./static/shim";
import { watchStaleToken } from "./session/staleToken";

// The static viewer has no server: its stand-in answers the app's API requests from the site's project files.
if (STATIC_VIEWER) {
  const base = window.fetch.bind(window);
  window.fetch = staticFetch(base);
}
// A page left open across a server restart can no longer save: warn the person (StaleTokenBar).
if (!STATIC_VIEWER) watchStaleToken();
logUncaughtErrors();
// The theme last used in this browser, until the account's own has loaded: no flash of the other one.
setTheme(storedTheme());

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing");
// Fetch only the language the page opens in before the first render, so it never flashes in English.
void preloadLanguage().then(() =>
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
