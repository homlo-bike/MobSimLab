import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { preloadLanguage } from "./i18n/i18n";
import "./index.css";

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
