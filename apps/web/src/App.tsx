import { MapView } from "./map/MapView";

/** Application shell: top bar and the map. Menus and panels arrive in Phase 1. */
export function App() {
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
      </header>
      <main className="relative flex-1">
        <MapView />
      </main>
    </div>
  );
}
