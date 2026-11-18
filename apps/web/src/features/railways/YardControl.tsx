import { useI18n } from "../../i18n/i18n";
import { nextId } from "./doc";
import { field, input, Row } from "./panelControls";
import { trainsThatFit } from "./storage";
import type { Network, RailView, Track, Yard } from "./types";

/** Purpose: how many of the lines' longest trains fit on a stabling yard's tracks. */
export function yardTrains(y: Yard, view: Pick<RailView, "tracks" | "train_length_m">): number {
  return y.tracks.reduce((n, id) => {
    const tv = view.tracks.find((x) => x.id === id);
    return n + (tv ? trainsThatFit(tv.length_m, tv.tracks, view.train_length_m) : 0);
  }, 0);
}

/** Purpose: a railway with a track moved into a stabling yard (`null`: out of any), keeping no empty yard. */
export function withTrackInYard(
  doc: Network,
  track: number,
  yard: number | "new" | null,
  name: string,
): Network {
  let yards = (doc.yards ?? [])
    .map((y) => ({ ...y, tracks: y.tracks.filter((id) => id !== track) }))
    .map((y) => (y.id === yard ? { ...y, tracks: [...y.tracks, track].sort((a, b) => a - b) } : y));
  if (yard === "new")
    yards = [...yards, { id: nextId(doc), name, tracks: [track], charging: false, cleaning: false }];
  return { ...doc, yards: yards.filter((y) => y.tracks.length > 0) };
}

/**
 * Purpose: the stabling yard of a storage track in the railway tool: which yard it belongs to (or a new one), the
 * yard's name, whether trains charge and are cleaned there, and how many trains the yard holds. Yard tracks count
 * as overnight stabling for the timetable planner (track topology `depot_groups` of kind `rail_yard`).
 */
export function YardControl({
  track,
  doc,
  view,
  setDoc,
}: {
  track: Track;
  doc: Network;
  view: RailView;
  setDoc: (d: Network) => void;
}) {
  const { t } = useI18n();
  const yards = doc.yards ?? [];
  const yard = yards.find((y) => y.tracks.includes(track.id));
  const patch = (f: (y: Yard) => Yard) =>
    yard && setDoc({ ...doc, yards: yards.map((y) => (y.id === yard.id ? f(y) : y)) });
  return (
    <div className="flex flex-col gap-2">
      <Row label={t("rail.yard")}>
        <select
          aria-label={t("rail.yard")}
          value={yard?.id ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            setDoc(
              withTrackInYard(
                doc,
                track.id,
                v === "" ? null : v === "new" ? "new" : Number(v),
                t("yard.defaultName", { n: yards.length + 1 }),
              ),
            );
          }}
          className={input}
        >
          <option value="">{t("rail.yardNone")}</option>
          {yards.map((y) => (
            <option key={y.id} value={y.id}>
              {y.name}
            </option>
          ))}
          <option value="new">{t("yard.add")}</option>
        </select>
      </Row>
      {yard && (
        <>
          <input
            aria-label={t("yard.name")}
            placeholder={t("yard.name")}
            value={yard.name}
            onChange={(e) => patch((y) => ({ ...y, name: e.target.value }))}
            className={field}
          />
          <p className="text-xs text-slate-600">{t("yard.capacity", { n: yardTrains(yard, view) })}</p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={yard.charging}
              onChange={(e) => patch((y) => ({ ...y, charging: e.target.checked }))}
            />
            {t("yard.charging")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={yard.cleaning}
              onChange={(e) => patch((y) => ({ ...y, cleaning: e.target.checked }))}
            />
            {t("yard.cleaning")}
          </label>
        </>
      )}
    </div>
  );
}
