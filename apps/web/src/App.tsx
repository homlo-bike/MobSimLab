import type { Map as MapLibreMap } from "maplibre-gl";
import { useState } from "react";
import { StreetLineEditor } from "./features/street-lines/StreetLineEditor";
import { MapView } from "./map/MapView";

/** Application shell: top bar, the map and the street line tool with its side panel. Menus and panels arrive in Phase 1. */
export function App() {
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [streetLine, setStreetLine] = useState(false);
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  // Development hook for end-to-end scripts that need map coordinates.
  if (import.meta.env.DEV) Object.assign(window, { mobsimMap: map });

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-10 items-center gap-4 border-b border-slate-300 bg-white px-3 text-sm">
        <span className="font-semibold">MobSimLab</span>
        <nav aria-label="Main menu" className="flex gap-3 text-slate-600">
          <span>File</span>
          <span>Edit</span>
          <span>View</span>
          <span>Help</span>
        </nav>
        <div className="ml-auto flex gap-2" role="toolbar" aria-label="Network design">
          <button
            type="button"
            aria-pressed={streetLine}
            onClick={() => setStreetLine(!streetLine)}
            className={`rounded border px-2 py-0.5 ${streetLine ? "border-blue-700 bg-blue-700 text-white" : "border-slate-300 hover:bg-slate-100"}`}
          >
            Street line
          </button>
        </div>
      </header>
      <main className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <MapView onReady={setMap} />
          {streetLine && <StreetLineEditor map={map} panel={panel} />}
        </div>
        {streetLine && (
          <aside
            ref={setPanel}
            aria-label="Street line editor"
            className="w-96 shrink-0 overflow-y-auto border-l border-slate-300 bg-white"
          />
        )}
      </main>
    </div>
  );
}
