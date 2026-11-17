import { useI18n } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/messages";

/** Editing tools: select and move, add point, pan, and place the bus depot. */
export type Tool = "select" | "add" | "pan" | "depot";

const TOOLS: { id: Tool; label: MessageKey; key: string; icon: string }[] = [
  { id: "select", label: "rail.tool.select", key: "V", icon: "M5 3l14 8-6 2-2 6z" },
  {
    id: "add",
    label: "street.tool.add",
    key: "P",
    icon: "M5 19l6-6m0 0a3 3 0 104-4 3 3 0 00-4 4zM17 3v6m-3-3h6",
  },
  {
    id: "pan",
    label: "rail.tool.pan",
    key: "H",
    icon: "M12 3v18M3 12h18M12 3l-3 3m3-3l3 3m-3 15l-3-3m3 3l3-3M3 12l3-3m-3 3l3 3m15-3l-3-3m3 3l-3 3",
  },
  {
    id: "depot",
    label: "street.tool.depot",
    key: "D",
    icon: "M3 21V9l9-6 9 6v12M7 21v-7h10v7M7 17h10",
  },
];

interface Props {
  tool: Tool;
  onTool: (t: Tool) => void;
}

/** Purpose: floating tool palette in the top-left corner of the map. */
export function ToolPalette({ tool, onTool }: Props) {
  const { t: tr } = useI18n();
  const item = "flex w-full items-center gap-2 rounded px-2 py-1.5 text-start";
  return (
    <div
      role="toolbar"
      aria-label={tr("street.tools")}
      className="pointer-events-auto absolute top-3 left-3 z-10 w-44 rounded-lg bg-white p-1 text-sm shadow-lg"
    >
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={tool === t.id}
          title={`${tr(t.label)} (${t.key})`}
          onClick={() => onTool(t.id)}
          className={`${item} ${tool === t.id ? "bg-emerald-800 text-white" : "hover:bg-slate-100"}`}
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
