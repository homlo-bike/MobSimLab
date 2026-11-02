import type { Map as MapLibreMap } from "maplibre-gl";
import { useCallback, useEffect, useState } from "react";
import { AdminPanel } from "./admin/AdminPanel";
import { AgentsPanel } from "./agents/AgentsPanel";
import { ConsentPage } from "./agents/ConsentPage";
import { JourneyPlanner } from "./features/journey-planner/JourneyPlanner";
import type { StreetLineInput } from "./features/journey-planner/network";
import { RailwayEditor } from "./features/railways/RailwayEditor";
import { StreetLineEditor } from "./features/street-lines/StreetLineEditor";
import { MapView } from "./map/MapView";
import { AccountMenu } from "./session/AccountMenu";
import { fetchMe, type Me, SIGNIN_MESSAGES } from "./session/api";
import { SetupPanel } from "./setup/SetupPanel";

/**
 * Application shell: top bar with account menu, the setup wizard while in setup mode, the administration
 * panel for Owners and Admins, the map, and the street line and railway tools with their side panel.
 */
export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [admin, setAdmin] = useState(false);
  const [agents, setAgents] = useState(false);
  const reload = useCallback(() => {
    fetchMe().then(setMe, () => setMe(null));
  }, []);
  useEffect(reload, [reload]);
  const refusal = new URLSearchParams(window.location.search).get("signin");
  const [map, setMap] = useState<MapLibreMap | null>(null);
  // One side tool at a time: they share the side panel and the map's click handlers.
  const [tool, setTool] = useState<"street" | "railway" | "journey" | null>(null);
  const toggle = (t: "street" | "railway" | "journey") => setTool(tool === t ? null : t);
  const toolButton = (on: boolean) =>
    `rounded border px-2 py-0.5 ${on ? "border-blue-700 bg-blue-700 text-white" : "border-slate-300 hover:bg-slate-100"}`;
  // The street line last drawn, so the journey planner can ride it.
  const [line, setLine] = useState<StreetLineInput | null>(null);
  // The track topology last built in the railway tool, so street lines wait at its level crossings.
  const [railTopology, setRailTopology] = useState<unknown>(null);
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  // Development hook for end-to-end scripts that need map coordinates.
  if (import.meta.env.DEV) Object.assign(window, { mobsimMap: map });

  // An AI app sent the person here to approve a connection (ADR-0035).
  if (window.location.pathname === "/agents/consent")
    return (
      <div className="h-full overflow-y-auto bg-slate-50">
        <ConsentPage me={me} />
      </div>
    );

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
        <div className="ml-auto flex gap-2" role="toolbar" aria-label="Network design">
          <button
            type="button"
            aria-pressed={tool === "street"}
            onClick={() => toggle("street")}
            className={toolButton(tool === "street")}
          >
            Street line
          </button>
          <button
            type="button"
            aria-pressed={tool === "railway"}
            onClick={() => toggle("railway")}
            className={toolButton(tool === "railway")}
          >
            Railway
          </button>
          <button
            type="button"
            aria-pressed={tool === "journey"}
            onClick={() => toggle("journey")}
            className={toolButton(tool === "journey")}
          >
            Journey planner
          </button>
        </div>
        <span>
          {me && (
            <AccountMenu
              me={me}
              onSignedOut={reload}
              onAdmin={() => setAdmin(true)}
              onAgents={() => setAgents(true)}
            />
          )}
        </span>
      </header>
      {refusal && !me?.user && (
        <p role="status" className="border-b border-amber-300 bg-amber-50 px-3 py-1 text-sm">
          {SIGNIN_MESSAGES[refusal] ?? SIGNIN_MESSAGES.invalid_request}
        </p>
      )}
      {me?.user?.role === "restricted" && (
        <p role="status" className="border-b border-amber-300 bg-amber-50 px-3 py-1 text-sm">
          Your account is restricted. Please contact an administrator.
        </p>
      )}
      <main className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {admin && me?.user && me.csrfToken && (
            <AdminPanel
              role={me.user.role}
              userId={me.user.id}
              csrfToken={me.csrfToken}
              onClose={() => setAdmin(false)}
            />
          )}
          {agents && me?.user && me.csrfToken && (
            <AgentsPanel
              role={me.user.role}
              csrfToken={me.csrfToken}
              map={map}
              onClose={() => setAgents(false)}
            />
          )}
          {me?.instance.mode === "setup" && me.user?.role === "owner" && me.csrfToken && (
            <SetupPanel name={me.instance.name} csrfToken={me.csrfToken} onFinished={reload} />
          )}
          <MapView onReady={setMap} />
          {tool === "street" && (
            <StreetLineEditor map={map} panel={panel} onLineChange={setLine} railTopology={railTopology} />
          )}
          {tool === "railway" && <RailwayEditor map={map} panel={panel} onTopologyChange={setRailTopology} />}
          {tool === "journey" && (
            <JourneyPlanner
              map={map}
              panel={panel}
              streetLine={line && line.view.points.length >= 2 ? line : null}
            />
          )}
        </div>
        {tool && (
          <aside
            key={tool}
            ref={setPanel}
            aria-label={
              tool === "journey"
                ? "Journey planner"
                : tool === "street"
                  ? "Street line editor"
                  : "Railway editor"
            }
            className={`${tool === "journey" ? "w-[26rem]" : "w-96"} shrink-0 overflow-y-auto border-l border-slate-300 bg-white`}
          />
        )}
      </main>
    </div>
  );
}
