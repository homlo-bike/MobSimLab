import { useCallback, useEffect, useState } from "react";
import { pluginTabs } from "../plugins/registry";

/** The app's own project tabs, in the order the top bar shows them. */
export const CORE_TABS = ["simulator", "create", "schematic", "gis", "tables", "preferences"] as const;
export type CoreTab = (typeof CORE_TABS)[number];
/** A core tab, or the id of a tab a plugin adds (such as "cargo-bike"). */
export type Tab = CoreTab | (string & {});
/** Every project tab: the core tabs, then the plugins' tabs (ADR-0036 §3, `tabs`). */
export const TABS: readonly Tab[] = [...CORE_TABS, ...pluginTabs().map((t) => t.id)];

/** Where the app is. Paths: `/`, `/projects/<id>/<tab>`, `/agents/consent`. */
export type Route =
  { page: "home" } | { page: "project"; id: string; tab: Tab; fresh: boolean } | { page: "consent" };

/**
 * Purpose: read a route from a location.
 * Inputs: pathname and search. `?new=1` marks a project that was just created (its Create tab starts with the
 * "what do you want to build first" chooser).
 */
export function parseRoute(pathname: string, search = ""): Route {
  if (pathname === "/agents/consent") return { page: "consent" };
  const m = /^\/projects\/([0-9a-fA-F-]{36})(?:\/([a-z][a-z0-9-]*))?\/?$/.exec(pathname);
  if (m?.[1]) {
    // A tab of an installed plugin is only known once the project's plugins load; the workspace falls back to
    // the simulator for a tab the project does not have.
    const tab = TABS.find((t) => t === m[2]) ?? m[2] ?? "simulator";
    return { page: "project", id: m[1], tab, fresh: new URLSearchParams(search).get("new") === "1" };
  }
  return { page: "home" };
}

/** Purpose: the path for a route. */
export function routePath(r: Route): string {
  if (r.page === "consent") return "/agents/consent";
  if (r.page === "project") return `/projects/${r.id}/${r.tab}${r.fresh ? "?new=1" : ""}`;
  return "/";
}

/**
 * Purpose: the current route and a function to move to another, with browser back and forward working.
 * Side effects: pushes history entries; listens to `popstate`.
 */
export function useRoute(): [Route, (r: Route, replace?: boolean) => void] {
  const [route, setRoute] = useState<Route>(() =>
    parseRoute(window.location.pathname, window.location.search),
  );
  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname, window.location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const go = useCallback((r: Route, replace = false) => {
    const path = routePath(r);
    if (replace) window.history.replaceState(null, "", path);
    else window.history.pushState(null, "", path);
    setRoute(r);
  }, []);
  return [route, go];
}
