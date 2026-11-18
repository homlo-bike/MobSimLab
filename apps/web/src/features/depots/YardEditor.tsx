import { useI18n } from "../../i18n/i18n";
import { nextId } from "../railways/doc";
import type { Network, Yard } from "../railways/types";

interface Props {
  /** The project's railway drawing; `null` when there is none. */
  railway: Network | null;
  /** Told about every change to the railway drawing. */
  onRailway: (doc: Network) => void;
}

/**
 * Purpose: stabling yards, the rail depot type of the Depots tool: storage tracks of the railway grouped
 * as one depot, with whether trains charge and are cleaned there. Yard tracks count as overnight
 * stabling for the timetable planner (track topology `depot_groups` of kind `rail_yard`).
 */
export function YardEditor({ railway, onRailway }: Props) {
  const { t } = useI18n();
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
