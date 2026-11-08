import type { Issue } from "./types";

const STYLE: Record<Issue["level"], string> = {
  error: "border-red-300 bg-red-50 text-red-900",
  warning: "border-amber-300 bg-amber-50 text-amber-950",
  info: "border-slate-200 bg-slate-50 text-slate-700",
};

/** Purpose: the kit's live checks as a list, errors first. */
export function Issues({ issues, where }: { issues: Issue[]; where: (i: Issue) => string | null }) {
  if (!issues.length) return null;
  const order = { error: 0, warning: 1, info: 2 };
  const sorted = [...issues].sort((a, b) => order[a.level] - order[b.level]);
  return (
    <ul className="mt-2 flex flex-col gap-1.5" aria-label="Checks">
      {sorted.map((i, k) => (
        <li key={k} className={`rounded-lg border px-2.5 py-1.5 text-xs ${STYLE[i.level]}`}>
          <span className="font-semibold capitalize">{i.level}</span>
          {where(i) && <span className="font-semibold">, {where(i)}</span>}: {i.message}
          {i.parameter && <span className="block text-[11px] opacity-75">Parameter {i.parameter}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Purpose: one figure of a summary grid. */
export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2.5 py-1.5">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="font-semibold text-slate-900">{value}</div>
    </div>
  );
}
