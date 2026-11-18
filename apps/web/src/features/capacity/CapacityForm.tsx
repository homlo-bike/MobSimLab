import { clock } from "../journey-planner/format";
import { useI18n, withNodes } from "../../i18n/i18n";
import { engineLines } from "../railways/serviceLines";
import type { Network } from "../railways/types";
import type { SavedStreetLine } from "../street-lines/saved";
import type { DrawnProblem } from "./drawn";
import { PERIODS } from "./loadPlans";
import type { Boardings, RidershipZones } from "./ridership";
import { BoardingsEditor } from "./SystemResults";
import type { CapacityParams } from "./types";

/** Which network the test runs on. */
export type Source = "example" | "drawn" | "files";
type NamedText = { name: string; text: string };

/** Purpose: picking the network: the example metro, the lines drawn in the project, or the planner's files. */
export function NetworkPicker({
  source,
  setSource,
  drawn,
  railway,
  streets,
  topology,
  setTopology,
  linesFile,
  setLinesFile,
}: {
  source: Source;
  setSource: (s: Source) => void;
  drawn: DrawnProblem | null;
  railway: Network | null;
  streets: readonly { line: SavedStreetLine; index: number }[];
  topology: NamedText | null;
  setTopology: (v: NamedText) => void;
  linesFile: NamedText | null;
  setLinesFile: (v: NamedText) => void;
}) {
  const { t } = useI18n();
  const file = (
    label: string,
    value: { name: string } | null,
    set: (v: { name: string; text: string }) => void,
  ) => (
    <label className="flex min-h-10 cursor-pointer items-center justify-between gap-2 rounded-[10px] border border-slate-300 bg-white px-3 py-2 hover:bg-slate-50">
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        <span className="block truncate text-xs text-slate-500">
          {value ? value.name : t("capacity.noFile")}
        </span>
      </span>
      <span className="text-sm text-blue-700">{value ? t("capacity.replace") : t("capacity.choose")}</span>
      <input
        type="file"
        accept="application/json,.json"
        className="sr-only"
        aria-label={label}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void f.text().then((text) => set({ name: f.name, text }));
        }}
      />
    </label>
  );
  return (
    <fieldset className="space-y-2">
      <legend className="caps mb-1.5">{t("capacity.network")}</legend>
      <div className="seg" role="radiogroup" aria-label={t("capacity.network")}>
        <button
          type="button"
          role="radio"
          aria-checked={source === "example"}
          aria-pressed={source === "example"}
          onClick={() => setSource("example")}
        >
          {t("capacity.example")}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={source === "drawn"}
          aria-pressed={source === "drawn"}
          onClick={() => setSource("drawn")}
        >
          {t("capacity.drawn")}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={source === "files"}
          aria-pressed={source === "files"}
          onClick={() => setSource("files")}
        >
          {t("capacity.mine")}
        </button>
      </div>
      {source === "example" ? (
        <p className="text-xs text-slate-600">{t("capacity.exampleText")}</p>
      ) : source === "drawn" ? (
        <div className="space-y-1 text-xs text-slate-600">
          <p>
            {drawn === null
              ? t("capacity.drawnText", {
                  names: engineLines(railway!)
                    .map((l) => l.name)
                    .join(", "),
                })
              : t(`capacity.drawn.${drawn}`)}
          </p>
          {streets.length > 0 && (
            <p>{t("capacity.drawnStreets", { names: streets.map((x) => x.line.name).join(", ") })}</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {file(t("capacity.topologyFile"), topology, setTopology)}
          {file(t("capacity.linesFile"), linesFile, setLinesFile)}
          <p className="text-xs text-slate-600">
            {withNodes(t("capacity.filesHelp"), { drawn: <em>{t("capacity.drawn")}</em> })}
          </p>
        </div>
      )}
    </fieldset>
  );
}

/** Purpose: the period, the frequency sweep, the passenger loads and the advanced test settings. */
export function RunSettings({
  period,
  setPeriod,
  from,
  setFrom,
  to,
  setTo,
  sweep,
  setSweep,
  showLoads,
  withLoads,
  setWithLoads,
  stopNames,
  estimates,
  ownBoardings,
  onOwnBoardings,
  ensureZones,
  advanced,
  setAdvanced,
}: {
  period: string;
  setPeriod: (p: string) => void;
  from: string;
  setFrom: (v: string) => void;
  to: string;
  setTo: (v: string) => void;
  sweep: boolean;
  setSweep: (v: boolean) => void;
  /** Offer the passenger loads (the drawn lines with a ridership estimate). */
  showLoads: boolean;
  withLoads: boolean;
  setWithLoads: (v: boolean) => void;
  stopNames: string[];
  estimates: Record<string, number> | null;
  ownBoardings: Boardings;
  onOwnBoardings?: (b: Boardings) => void;
  ensureZones: () => Promise<RidershipZones> | null;
  advanced: Partial<CapacityParams>;
  setAdvanced: React.Dispatch<React.SetStateAction<Partial<CapacityParams>>>;
}) {
  const { t } = useI18n();
  const num = (
    key: keyof CapacityParams,
    label: string,
    scale: number,
    unit: string,
    step: number,
    def: number,
  ) => (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span>{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          step={step}
          className="w-20 rounded-md border border-slate-300 px-2 py-1 text-right"
          value={advanced[key] !== undefined ? Number(advanced[key]) / scale : def}
          onChange={(e) => {
            const v = Number(e.target.value);
            setAdvanced((a) => ({ ...a, [key]: Number.isFinite(v) ? v * scale : undefined }));
          }}
        />
        <span className="w-6 text-slate-500">{unit}</span>
      </span>
    </label>
  );
  return (
    <fieldset className="space-y-2">
      <legend className="caps mb-1.5">{t("capacity.period")}</legend>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("capacity.period")}>
        {[...PERIODS, { id: "custom", from: 0, to: 0 } as const].map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            className="chip"
            aria-checked={period === p.id}
            aria-pressed={period === p.id}
            onClick={() => setPeriod(p.id)}
          >
            {t(`capacity.period.${p.id}`)}
            {p.id !== "custom" && (
              <span className="text-xs font-normal text-slate-500">
                {clock(p.from)}–{clock(p.to)}
              </span>
            )}
          </button>
        ))}
      </div>
      {period === "custom" && (
        <div className="flex items-center gap-2">
          <label className="field w-28">
            <span className="sr-only">{t("capacity.from")}</span>
            <input
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              aria-label={t("capacity.from")}
              inputMode="numeric"
            />
          </label>
          <span>{t("capacity.toWord")}</span>
          <label className="field w-28">
            <span className="sr-only">{t("capacity.to")}</span>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              aria-label={t("capacity.to")}
              inputMode="numeric"
            />
          </label>
        </div>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={sweep} onChange={(e) => setSweep(e.target.checked)} />
        {t("capacity.sweep")}
      </label>
      {showLoads && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={withLoads} onChange={(e) => setWithLoads(e.target.checked)} />
            {t("capacity.loads.toggle")}
          </label>
          {withLoads && (
            <BoardingsEditor
              names={stopNames}
              estimate={estimates}
              own={ownBoardings}
              onOwn={onOwnBoardings ?? null}
              onOpen={() => void ensureZones()?.catch(() => undefined)}
            />
          )}
        </>
      )}
      <details className="rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium">{t("capacity.settings")}</summary>
        <div className="mt-2 space-y-1.5">
          {num("stability_runs", t("capacity.set.runs"), 1, "", 1, 8)}
          {num("delayed_share", t("capacity.set.delayed"), 0.01, "%", 5, 20)}
          {num("primary_delay_mean_s", t("capacity.set.mean"), 1, "s", 5, 45)}
          {num("primary_delay_max_s", t("capacity.set.max"), 1, "s", 30, 180)}
          {num("occupancy_limit_share", t("capacity.set.limit"), 0.01, "%", 5, 85)}
          {num("min_buffer_s", t("capacity.set.buffer"), 1, "s", 5, 20)}
          {num("late_threshold_s", t("capacity.set.lateFrom"), 1, "s", 30, 120)}
          {num("seed", t("capacity.set.seed"), 1, "", 1, 1)}
          <p className="pt-1 text-xs text-slate-500">{t("capacity.settingsNote")}</p>
        </div>
      </details>
    </fieldset>
  );
}
