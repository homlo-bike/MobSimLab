import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/i18n";
import { nextId } from "../railways/doc";
import { trainsThatFit } from "../railways/storage";
import type { Network, Yard } from "../railways/types";
import { buildRailway } from "../tables/railBuild";

/** What the yards' capacity needs from the railway as the engine builds it. */
export interface YardBuild {
  /** Length (m) and number of parallel tracks of each track, by id. */
  tracks: { id: number; length_m: number; tracks: number }[];
  /** The longest train of the service lines, m. */
  train_length_m: number;
  /** Trains the published service lines use on a weekday; null when no line could be published. */
  trains: number | null;
}

/** Purpose: build the railway and publish its lines for the yards' capacity. Side effects: loads the rail engine. */
export async function buildYards(railway: Network): Promise<YardBuild> {
  const { view, reports } = await buildRailway(railway);
  const lines = Object.values(reports);
  return {
    tracks: view.tracks.map((x) => ({ id: x.id, length_m: x.length_m, tracks: x.tracks })),
    train_length_m: view.train_length_m,
    trains: lines.length ? lines.reduce((n, r) => n + r.trains, 0) : null,
  };
}

/** Purpose: how many of the longest trains fit on a yard's tracks. */
export function yardTrains(y: Yard, b: YardBuild): number {
  return y.tracks.reduce((n, id) => {
    const tv = b.tracks.find((x) => x.id === id);
    return n + (tv ? trainsThatFit(tv.length_m, tv.tracks, b.train_length_m) : 0);
  }, 0);
}

interface Props {
  /** The project's railway drawing; `null` when there is none. */
  railway: Network | null;
  /** Told about every change to the railway drawing. */
  onRailway: (doc: Network) => void;
  /** Builds the railway for the capacity (tests inject one). */
  build?: (railway: Network) => Promise<YardBuild>;
}

/**
 * Purpose: stabling yards, the rail depot type of the Depots tool: storage tracks of the railway grouped
 * as one depot, with whether trains charge and are cleaned there. Yard tracks count as overnight
 * stabling for the timetable planner (track topology `depot_groups` of kind `rail_yard`).
 */
export function YardEditor({ railway, onRailway, build = buildYards }: Props) {
  const { t } = useI18n();
  const [built, setBuilt] = useState<YardBuild | null>(null);
  // Only the tracks and lines change the capacity, not the yards' names or services.
  const key = railway?.yards?.length ? JSON.stringify({ ...railway, yards: undefined }) : "";
  useEffect(() => {
    if (!key || !railway) return setBuilt(null);
    let live = true;
    build(railway).then(
      (b) => live && setBuilt(b),
      () => live && setBuilt(null),
    );
    return () => {
      live = false;
    };
  }, [key]);
  const yards = railway?.yards ?? [];
  const storage = (railway?.tracks ?? []).filter((x) => x.use === "storage");
  const setYards = (f: (ys: Yard[]) => Yard[]) => railway && onRailway({ ...railway, yards: f(yards) });
  const patch = (id: number, f: (y: Yard) => Yard) =>
    setYards((ys) => ys.map((y) => (y.id === id ? f(y) : y)));
  const owner = (track: number) => yards.find((y) => y.tracks.includes(track));

  return (
    <section aria-labelledby="yards-title">
      <h3 id="yards-title" className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
        {t("yard.list")}
      </h3>
      <p className="mt-1 text-slate-600">{t("yard.intro")}</p>
      {storage.length === 0 && <p className="mt-1 text-slate-600">{t("yard.noStorage")}</p>}
      {storage.length > 0 && yards.length === 0 && <p className="mt-1 text-slate-600">{t("yard.none")}</p>}
      {built && yards.length > 0 && (
        <p className="mt-1 text-slate-600" data-testid="yard-capacity">
          {t("yard.capacityAll", {
            n: yards.reduce((n, y) => n + yardTrains(y, built), 0),
            length: Math.round(built.train_length_m),
          })}{" "}
          {built.trains !== null && t("yard.needed", { n: built.trains })}
        </p>
      )}
      {built &&
        built.trains !== null &&
        yards.reduce((n, y) => n + yardTrains(y, built), 0) < built.trains && (
          <p className="mt-1 text-amber-800">{t("yard.short")}</p>
        )}
      <ul className="mt-2 flex flex-col gap-3">
        {yards.map((y) => (
          <li key={y.id} className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3">
            <label className="block">
              <span className="font-medium">{t("yard.name")}</span>
              <input
                className="input mt-1 w-full"
                value={y.name}
                onChange={(e) => patch(y.id, (x) => ({ ...x, name: e.target.value }))}
              />
            </label>
            {built && <p className="text-slate-600">{t("yard.capacity", { n: yardTrains(y, built) })}</p>}
            <fieldset>
              <legend className="font-medium">{t("yard.tracks")}</legend>
              <div className="mt-1 flex flex-col gap-1">
                {storage.map((s) => {
                  const other = owner(s.id);
                  const taken = other !== undefined && other.id !== y.id;
                  return (
                    <label key={s.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={y.tracks.includes(s.id)}
                        disabled={taken}
                        onChange={(e) =>
                          patch(y.id, (x) => ({
                            ...x,
                            tracks: e.target.checked
                              ? [...x.tracks, s.id].sort((a, b) => a - b)
                              : x.tracks.filter((id) => id !== s.id),
                          }))
                        }
                      />
                      <span>{s.name || t("rail.trackN", { id: s.id })}</span>
                      {taken && (
                        <span className="text-xs text-slate-500">
                          {t("yard.inOther", { name: other.name })}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={y.charging}
                onChange={(e) => patch(y.id, (x) => ({ ...x, charging: e.target.checked }))}
              />
              {t("yard.charging")}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={y.cleaning}
                onChange={(e) => patch(y.id, (x) => ({ ...x, cleaning: e.target.checked }))}
              />
              {t("yard.cleaning")}
            </label>
            <button
              type="button"
              className="btn min-h-10 self-start"
              onClick={() => setYards((ys) => ys.filter((x) => x.id !== y.id))}
            >
              {t("yard.remove")}
            </button>
          </li>
        ))}
      </ul>
      {railway && storage.length > 0 && (
        <button
          type="button"
          className="btn mt-2 min-h-10"
          onClick={() =>
            setYards((ys) => [
              ...ys,
              {
                id: nextId(railway),
                name: t("yard.defaultName", { n: ys.length + 1 }),
                tracks: storage.filter((s) => !owner(s.id)).map((s) => s.id),
                charging: false,
                cleaning: false,
              },
            ])
          }
        >
          {t("yard.add")}
        </button>
      )}
    </section>
  );
}
