/** Editing tools, as in the mockup: select and move, add point, pan, and the preview run. */
export type Tool = "select" | "add" | "pan" | "depot";

const TOOLS: { id: Exclude<Tool, "depot">; label: string; key: string; icon: string }[] = [
  { id: "select", label: "Select and move", key: "V", icon: "M5 3l14 8-6 2-2 6z" },
  { id: "add", label: "Add point", key: "P", icon: "M5 19l6-6m0 0a3 3 0 104-4 3 3 0 00-4 4zM17 3v6m-3-3h6" },
  {
    id: "pan",
    label: "Pan",
    key: "H",
    icon: "M12 3v18M3 12h18M12 3l-3 3m3-3l3 3m-3 15l-3-3m3 3l3-3M3 12l3-3m-3 3l3 3m15-3l-3-3m3 3l-3 3",
  },
];

interface Props {
  tool: Tool;
  onTool: (t: Tool) => void;
  previewing: boolean;
  canPreview: boolean;
  onPreview: () => void;
}

/** Purpose: floating tool palette in the top-left corner of the map. */
export function ToolPalette({ tool, onTool, previewing, canPreview, onPreview }: Props) {
  const item = "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left";
  return (
    <div
      role="toolbar"
      aria-label="Street line tools"
      className="pointer-events-auto absolute top-3 left-3 z-10 w-44 rounded-lg bg-white p-1 text-sm shadow-lg"
    >
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={tool === t.id}
          title={`${t.label} (${t.key})`}
          onClick={() => onTool(t.id)}
          className={`${item} ${tool === t.id ? "bg-emerald-800 text-white" : "hover:bg-slate-100"}`}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-2" aria-hidden="true">
            <path d={t.icon} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="flex-1">{t.label}</span>
          <kbd className="text-xs opacity-60">{t.key}</kbd>
        </button>
      ))}
      <div className="my-1 border-t border-slate-200" />
      <button
        type="button"
        className={`${item} hover:bg-slate-100 disabled:opacity-40`}
        aria-pressed={previewing}
        disabled={!canPreview}
        onClick={onPreview}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
          <path d={previewing ? "M6 6h12v12H6z" : "M7 5l12 7-12 7z"} />
        </svg>
        {previewing ? "Stop preview" : "Preview run"}
      </button>
    </div>
  );
}
