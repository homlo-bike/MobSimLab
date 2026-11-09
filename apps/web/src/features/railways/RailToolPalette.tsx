import { useI18n } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/messages";
import type { RailTool } from "./RailPanel";

const TOOLS: { id: RailTool; label: MessageKey; key: string; icon: string }[] = [
  { id: "select", label: "rail.tool.select", key: "V", icon: "M5 3l14 8-6 2-2 6z" },
  { id: "station", label: "rail.tool.station", key: "S", icon: "M3 9h18v6H3zM6 9V6h12v3M7 15v3m10-3v3" },
  { id: "track", label: "rail.tool.track", key: "T", icon: "M8 3l-3 18M16 3l3 18M6 7h12M5.5 12h13M5 17h14" },
  { id: "turnout", label: "rail.tool.turnout", key: "B", icon: "M6 21V3m0 10c0-4 4-6 12-10" },
  { id: "crossover", label: "rail.tool.crossover", key: "X", icon: "M6 21V3m12 18V3M6 17l12-10" },
  { id: "signal", label: "rail.tool.signal", key: "G", icon: "M12 21v-9m-3-9h6v9H9zM12 6v.01M12 9v.01" },
  {
    id: "pan",
    label: "rail.tool.pan",
    key: "H",
    icon: "M12 3v18M3 12h18M12 3l-3 3m3-3l3 3m-3 15l-3-3m3 3l3-3M3 12l3-3m-3 3l3 3m15-3l-3-3m3 3l-3 3",
  },
  {
    id: "line",
    label: "rail.tool.line",
    key: "L",
    icon: "M4 18c4 0 4-12 8-12s4 12 8 12M4 18h.01M12 6h.01M20 18h.01",
  },
];

interface Props {
  tool: RailTool;
  onTool: (t: RailTool) => void;
}

/** Purpose: floating railway tool palette in the top-left corner of the map. */
export function RailToolPalette({ tool, onTool }: Props) {
  const { t: tr } = useI18n();
  return (
    <div
      role="toolbar"
      aria-label={tr("rail.tools")}
      className="pointer-events-auto absolute top-3 left-3 z-10 w-52 rounded-lg bg-white p-1 text-sm shadow-lg"
    >
      {TOOLS.map((t) => (
        <button
          data-separated={t.id === "line" ? "" : undefined}
          key={t.id}
          type="button"
          aria-pressed={tool === t.id}
          title={`${tr(t.label)} (${t.key})`}
          onClick={() => onTool(t.id)}
          className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-start ${
            t.id === "line" ? "mt-1 border-t border-slate-200 pt-2 font-medium" : ""
          } ${tool === t.id ? "bg-emerald-800 text-white" : "hover:bg-slate-100"}`}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-2" aria-hidden="true">
            <path d={t.icon} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="flex-1">{tr(t.label)}</span>
          <kbd className="text-xs opacity-60">{t.key}</kbd>
        </button>
      ))}
    </div>
  );
}
