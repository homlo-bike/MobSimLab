/**
 * Notices when the server refuses a change because this page's CSRF token is out of date (the server was restarted
 * with a new signing key while the page stayed open). Every save from the page fails from then on until it is
 * reloaded, so the app warns the person instead of failing quietly.
 */
import { useSyncExternalStore } from "react";

/** The server's message for a refused CSRF token (apps/api/src/iam/access.guard.ts). */
const REFUSED = "missing or invalid CSRF token";

let stale = false;
const listeners = new Set<() => void>();

function markStale(): void {
  if (stale) return;
  stale = true;
  for (const l of listeners) l();
}

/** Purpose: watch the app's own API requests for a refused CSRF token. Call once, before the first render. */
export function watchStaleToken(): void {
  const base = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await base(input, init);
    if (res.status === 403) {
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (
        method !== "GET" &&
        method !== "HEAD" &&
        new URL(url, window.location.href).pathname.startsWith("/api/")
      ) {
        void res
          .clone()
          .json()
          .then((b: { message?: unknown }) => {
            if (b?.message === REFUSED) markStale();
          })
          .catch(() => {});
      }
    }
    return res;
  };
}

/** Purpose: true once a change was refused for an out-of-date token; it stays true until the page reloads. */
export function useStaleToken(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => stale,
  );
}

/** Purpose: tests only: forget an earlier refusal. */
export function resetStaleToken(): void {
  stale = false;
}
