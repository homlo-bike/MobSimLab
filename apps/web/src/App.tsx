import { useCallback, useEffect, useState } from "react";
import { MapView } from "./map/MapView";
import { AccountMenu } from "./session/AccountMenu";
import { fetchMe, type Me, SIGNIN_MESSAGES } from "./session/api";
import { SetupPanel } from "./setup/SetupPanel";

/** Application shell: top bar with account menu, the setup wizard while in setup mode, and the map. */
export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const reload = useCallback(() => {
    fetchMe().then(setMe, () => setMe(null));
  }, []);
  useEffect(reload, [reload]);
  const refusal = new URLSearchParams(window.location.search).get("signin");

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-10 items-center gap-4 border-b border-slate-300 bg-white px-3 text-sm">
        <span className="font-semibold">{me?.instance.name ?? "MobSimLab"}</span>
        <nav aria-label="Main menu" className="flex gap-3 text-slate-600">
          <span>File</span>
          <span>Edit</span>
          <span>View</span>
          <span>Help</span>
        </nav>
        <span className="ml-auto">{me && <AccountMenu me={me} onSignedOut={reload} />}</span>
      </header>
      {refusal && !me?.user && (
        <p role="status" className="border-b border-amber-300 bg-amber-50 px-3 py-1 text-sm">
          {SIGNIN_MESSAGES[refusal] ?? SIGNIN_MESSAGES.invalid_request}
        </p>
      )}
      <main className="relative flex-1">
        {me?.instance.mode === "setup" && me.user?.role === "owner" && me.csrfToken && (
          <SetupPanel name={me.instance.name} csrfToken={me.csrfToken} onFinished={reload} />
        )}
        <MapView />
      </main>
    </div>
  );
}
