import type { RailTool } from "./RailPanel";

const TOOLS: { id: RailTool; label: string; key: string; icon: string }[] = [
  { id: "select", label: "Select and move", key: "V", icon: "M5 3l14 8-6 2-2 6z" },
  { id: "station", label: "Station", key: "S", icon: "M3 9h18v6H3zM6 9V6h12v3M7 15v3m10-3v3" },
  { id: "track", label: "Track", key: "T", icon: "M8 3l-3 18M16 3l3 18M6 7h12M5.5 12h13M5 17h14" },
  { id: "turnout", label: "Turnout", key: "B", icon: "M6 21V3m0 10c0-4 4-6 12-10" },
  { id: "crossover", label: "Crossover", key: "X", icon: "M6 21V3m12 18V3M6 17l12-10" },
  { id: "signal", label: "Signal", key: "G", icon: "M12 21v-9m-3-9h6v9H9zM12 6v.01M12 9v.01" },
  {
    id: "pan",
    label: "Pan",
    key: "H",
    icon: "M12 3v18M3 12h18M12 3l-3 3m3-3l3 3m-3 15l-3-3m3 3l3-3M3 12l3-3m-3 3l3 3m15-3l-3-3m3 3l-3 3",
  },
];

interface Props {
  tool: RailTool;
  onTool: (t: RailTool) => void;
}

/** Purpose: floating railway tool palette in the top-left corner of the map. */
export function RailToolPalette({ tool, onTool }: Props) {
  return (
    <div
      role="toolbar"
      aria-label="Railway tools"
      className="pointer-events-auto absolute top-3 left-3 z-10 w-44 rounded-lg bg-white p-1 text-sm shadow-lg"
    >
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={tool === t.id}
          title={`${t.label} (${t.key})`}
          onClick={() => onTool(t.id)}
          className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left ${
            tool === t.id ? "bg-emerald-800 text-white" : "hover:bg-slate-100"
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-2" aria-hidden="true">
            <path d={t.icon} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="flex-1">{t.label}</span>
          <kbd className="text-xs opacity-60">{t.key}</kbd>
        </button>
      ))}
    </div>
  );
}
