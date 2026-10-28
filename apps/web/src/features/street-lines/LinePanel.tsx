import { formatLength } from "./geojson";
import { MODE_ORDER, MODES, type Timing } from "./modes";
import { lineChecks, lineStats, type Severity } from "./summary";
import type { LineView, Mode, PointKind, RoutingRules, VehicleProfile } from "./types";

const KINDS: { id: PointKind; label: string; title: string }[] = [
  { id: "via", label: "Via", title: "Via point: shapes the path, no passengers" },
  { id: "stop", label: "Stop", title: "Stop on the sidewalk, served from the door side" },
  { id: "end_stop", label: "End stop", title: "End stop: layover; splits the line into directions" },
];

const CHIP: Record<Severity, string> = {
  ok: "bg-emerald-700 text-white",
  info: "bg-slate-200 text-slate-700",
  warn: "bg-amber-500 text-white",
  error: "bg-red-600 text-white",
};

/** Edits the panel can ask for; the editor applies them to the engine. */
export interface PanelActions {
  setName: (name: string) => void;
  setMode: (mode: Mode) => void;
  setProfile: (p: VehicleProfile) => void;
  setRules: (r: RoutingRules) => void;
  setTiming: (t: Timing) => void;
  select: (id: number | null) => void;
  setKind: (id: number, kind: PointKind) => void;
  setPointName: (id: number, name: string) => void;
  deletePoint: (id: number) => void;
  optimise: () => void;
  clear: () => void;
  placeDepot: () => void;
  removeDepot: () => void;
  setDepotStops: (s: { out?: number; in?: number }) => void;
  setShowDepot: (v: boolean) => void;
  setShowRoads: (v: boolean) => void;
}

interface Props {
  lineName: string;
  view: LineView;
  profile: VehicleProfile;
  rules: RoutingRules;
  timing: Timing;
  selected: number | null;
  depotStops: { out?: number; in?: number };
  showDepot: boolean;
  showRoads: boolean;
  status: string | null;
  error: string | null;
  actions: PanelActions;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-slate-200 pt-3">
      <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-md bg-slate-100 p-2">
      <b className="block font-mono text-base">{value}</b>
      <span className="text-xs text-slate-600">{label}</span>
    </div>
  );
}

function NumberField({
  label,
  value,
  unit,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  unit: string;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          step={step}
          value={value}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
          className="w-20 rounded border border-slate-300 px-1 py-0.5 text-right"
        />
        <span className="w-6 text-slate-500">{unit}</span>
      </span>
    </label>
  );
}

/**
 * Purpose: the street line side panel, laid out like the line and track drawing mockup:
 * name and mode, stat tiles, route points in circuit order, checks, depot runs and rules.
 */
export function LinePanel(props: Props) {
  const { view, profile, rules, timing, selected, actions: a } = props;
  const mode = MODES[profile.mode];
  const st = lineStats(view, timing);
  const checks = lineChecks(view);
  const stops = view.points.filter((p) => p.kind !== "via");
  const name = (id: number | undefined) => {
    const p = view.points.find((q) => q.id === id);
    return p ? `${p.seq + 1} · ${p.name}` : "";
  };
  const trip = (kind: "pull_out" | "pull_in", stop: number | undefined) =>
    view.depot_trips.find((t) => t.kind === kind && t.stop === stop);
  const terminals = [...new Set(view.depot_trips.map((t) => t.stop))];
  const outStop = props.depotStops.out ?? terminals[0];
  const inStop = props.depotStops.in ?? terminals[0];

  return (
    <div className="flex flex-col gap-3 p-4 text-sm">
      <h2 className="text-xl font-semibold">{props.lineName || "Untitled line"}</h2>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-slate-600">Line name</span>
        <input
          value={props.lineName}
          onChange={(e) => a.setName(e.target.value)}
          className="rounded border border-slate-300 bg-slate-50 px-2 py-1.5"
        />
      </label>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-slate-600">Mode</span>
        <div
          role="radiogroup"
          aria-label="Mode"
          className="flex rounded border border-slate-300 bg-slate-50 p-0.5"
        >
          {MODE_ORDER.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={profile.mode === m}
              onClick={() => a.setMode(m)}
              className={`flex-1 rounded px-1 py-1 text-xs ${profile.mode === m ? "bg-white font-semibold shadow" : "text-slate-600"}`}
              style={profile.mode === m ? { color: MODES[m].color } : undefined}
            >
              {MODES[m].label}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-600">{mode.profile}</p>
        {profile.mode === "trolleybus" && (
          <NumberField
            label="Battery range"
            value={profile.battery_range_m}
            unit="m"
            step={100}
            onChange={(v) => a.setProfile({ ...profile, battery_range_m: v })}
          />
        )}
        {profile.mode === "brt" && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={profile.doors_both_sides}
              onChange={(e) => a.setProfile({ ...profile, doors_both_sides: e.target.checked })}
            />
            Doors on both sides
          </label>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-slate-200 pt-3">
        <Stat value={formatLength(st.lengthM)} label="Circuit length" />
        <Stat value={String(st.stops)} label={`Stops (${st.endStops} end)`} />
        <Stat
          value={`${Math.round(st.cycleMin)} min`}
          label={`Cycle: ${Math.round(st.runMin)} run, ${Math.round(st.dwellMin)} dwell, ${Math.round(st.layoverMin)} layover`}
        />
        <Stat value={String(st.vehicles)} label={`Vehicles for a ${timing.headwayMin} min headway`} />
      </div>

      {(props.status || props.error) && (
        <p
          className={`rounded px-2 py-1 text-xs ${props.error ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-700"}`}
          role="status"
        >
          {props.error ?? props.status}
        </p>
      )}

      <Section title="Route points · circuit order">
        {view.points.length === 0 && (
          <p className="text-slate-600">No points yet. Choose Add point and click on a street.</p>
        )}
        <ol className="flex flex-col">
          {view.points.map((p) => {
            const leg = view.legs[p.seq];
            const sel = p.id === selected;
            return (
              <li
                key={p.id}
                className={`rounded px-1 py-1 ${sel ? "bg-amber-50 ring-1 ring-amber-400" : ""}`}
              >
                <div
                  className="flex cursor-pointer items-center gap-2"
                  onClick={() => a.select(sel ? null : p.id)}
                >
                  {p.kind === "via" ? (
                    <span className="flex h-5 w-5 items-center justify-center">
                      <span className="h-3 w-3 rounded-full border-2" style={{ borderColor: mode.color }} />
                    </span>
                  ) : (
                    <span
                      className="flex h-5 w-5 items-center justify-center rounded text-xs font-bold text-white"
                      style={{ background: p.status === "error" ? "#dc2626" : mode.color }}
                    >
                      {p.seq + 1}
                    </span>
                  )}
                  <span className={`flex-1 truncate ${p.kind === "via" ? "text-slate-500" : ""}`}>
                    {p.kind === "via" ? `Via point ${p.seq + 1}` : p.name}
                  </span>
                  {p.kind === "end_stop" && (
                    <span className="rounded-full border border-slate-300 px-1.5 text-xs text-slate-500">
                      end
                    </span>
                  )}
                  {leg && (
                    <span
                      className="font-mono text-xs"
                      style={{
                        color:
                          leg.status === "ok" ? "#64748b" : leg.status === "warning" ? "#d97706" : "#dc2626",
                      }}
                    >
                      → {formatLength(leg.length_m)}
                    </span>
                  )}
                </div>
                {sel && (
                  <div className="mt-1 flex flex-col gap-1 pl-7">
                    {p.kind !== "via" && (
                      <input
                        aria-label={`Name of point ${p.seq + 1}`}
                        className="rounded border border-slate-300 px-1 py-0.5"
                        defaultValue={p.name}
                        key={p.name}
                        onBlur={(e) => e.target.value !== p.name && a.setPointName(p.id, e.target.value)}
                      />
                    )}
                    <div className="flex items-center gap-1">
                      <span role="group" aria-label={`Kind of point ${p.seq + 1}`} className="flex">
                        {KINDS.map((k) => (
                          <button
                            key={k.id}
                            type="button"
                            title={k.title}
                            aria-pressed={p.kind === k.id}
                            onClick={() => a.setKind(p.id, k.id)}
                            className={`border border-slate-300 px-1.5 py-0.5 text-xs first:rounded-l last:rounded-r ${p.kind === k.id ? "bg-slate-800 text-white" : "bg-white"}`}
                          >
                            {k.label}
                          </button>
                        ))}
                      </span>
                      <button
                        type="button"
                        aria-label={`Delete point ${p.seq + 1}`}
                        className="ml-auto text-xs text-slate-500 hover:text-red-700"
                        onClick={() => a.deletePoint(p.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {view.points.length > 1 && <p className="pl-7 text-xs text-slate-500">↺ back to point 1</p>}
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100 disabled:opacity-40"
            disabled={view.points.length < 2}
            onClick={a.optimise}
            title="Choose the travel direction at every via point for the shortest circuit"
          >
            Optimise
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100 disabled:opacity-40"
            disabled={view.points.length === 0}
            onClick={a.clear}
          >
            Clear line
          </button>
        </div>
      </Section>

      <Section title="Checks">
        <ul className="flex flex-col gap-1.5" aria-label="Checks">
          {checks.map((c) => (
            <li
              key={c.text}
              className={`flex gap-2 ${c.point !== undefined ? "cursor-pointer" : ""}`}
              onClick={() => c.point !== undefined && a.select(c.point)}
            >
              <span className={`h-fit rounded px-1 text-[10px] font-bold uppercase ${CHIP[c.sev]}`}>
                {c.sev}
              </span>
              <span className="text-xs">{c.text}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Depot runs">
        <p className="text-xs text-slate-600">
          Vehicles start and end the day in the depot. Pull-out and pull-in are routed with the same rules and
          run without passengers.
        </p>
        {!view.depot ? (
          <button
            type="button"
            className="w-fit rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
            onClick={a.placeDepot}
          >
            Place depot gate on the map
          </button>
        ) : (
          <>
            {terminals.length === 0 && (
              <p className="text-xs text-slate-600">Add stops to route the depot runs.</p>
            )}
            {terminals.length > 0 &&
              (["pull_out", "pull_in"] as const).map((kind) => {
                const chosen = kind === "pull_out" ? outStop : inStop;
                const t = trip(kind, chosen);
                return (
                  <label key={kind} className="flex items-center gap-2">
                    <span className="w-20">{kind === "pull_out" ? "Pull-out to" : "Pull-in from"}</span>
                    <select
                      value={chosen}
                      onChange={(e) =>
                        a.setDepotStops({
                          ...props.depotStops,
                          [kind === "pull_out" ? "out" : "in"]: Number(e.target.value),
                        })
                      }
                      className="min-w-0 flex-1 rounded border border-slate-300 p-0.5"
                    >
                      {terminals.map((s) => (
                        <option key={s} value={s}>
                          {name(s)}
                        </option>
                      ))}
                    </select>
                    <span className={`font-mono text-xs ${t?.status === "error" ? "text-red-700" : ""}`}>
                      {t?.status === "ok" ? formatLength(t.length_m) : "no path"}
                    </span>
                  </label>
                );
              })}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={props.showDepot}
                onChange={(e) => a.setShowDepot(e.target.checked)}
              />
              Show depot runs on the map
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
                onClick={a.placeDepot}
              >
                Move depot gate
              </button>
              <button
                type="button"
                className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
                onClick={a.removeDepot}
              >
                Remove depot
              </button>
            </div>
          </>
        )}
        {stops.length === 0 && view.depot && null}
      </Section>

      <Section title="Rules">
        <label className="flex items-center justify-between gap-2">
          <span>Traffic</span>
          <select
            value={rules.traffic_side}
            onChange={(e) =>
              a.setRules({ ...rules, traffic_side: e.target.value as RoutingRules["traffic_side"] })
            }
            className="rounded border border-slate-300 p-0.5"
          >
            <option value="right">Right-hand</option>
            <option value="left">Left-hand</option>
          </select>
        </label>
        <NumberField
          label="Stops within this distance form one station"
          value={rules.grouping_distance_m}
          unit="m"
          step={10}
          onChange={(v) => a.setRules({ ...rules, grouping_distance_m: v })}
        />
        <NumberField
          label="Warn when turning round adds more than"
          value={rules.detour_warn_m}
          unit="m"
          step={50}
          onChange={(v) => a.setRules({ ...rules, detour_warn_m: v })}
        />
        <NumberField
          label="Headway"
          value={timing.headwayMin}
          unit="min"
          onChange={(v) => a.setTiming({ ...timing, headwayMin: v })}
        />
        <NumberField
          label="Dwell per stop"
          value={timing.dwellS}
          unit="s"
          step={5}
          onChange={(v) => a.setTiming({ ...timing, dwellS: v })}
        />
        <NumberField
          label="Layover per end stop"
          value={timing.layoverMin}
          unit="min"
          onChange={(v) => a.setTiming({ ...timing, layoverMin: v })}
        />
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={props.showRoads}
            onChange={(e) => a.setShowRoads(e.target.checked)}
          />
          Show roads this vehicle may use{profile.mode === "trolleybus" ? " (green: overhead wire)" : ""}
        </label>
        <p className="text-xs text-slate-500">
          Buses never U-turn or reverse; they go round the block. A stop is served only by vehicles with its
          sidewalk on the door side. Street data © OpenStreetMap contributors.
        </p>
      </Section>
    </div>
  );
}
