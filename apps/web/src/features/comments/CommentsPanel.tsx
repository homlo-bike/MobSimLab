import { useMemo, useState } from "react";
import { type Translate, useI18n } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/messages";
import type { DepotsDoc } from "../depots/types";
import type { Network } from "../railways/types";
import type { StreetLinesDoc } from "../street-lines/saved";
import type { CommentObjectType } from "./api";
import { ObjectComments, objectKey, useOpenThreads } from "./Comments";

/** One object a comment can be on, as the panel lists it. */
export interface CommentableObject {
  type: CommentObjectType;
  id: string;
  label: string;
}

const GROUPS: { type: CommentObjectType; label: MessageKey }[] = [
  { type: "station", label: "comments.group.station" },
  { type: "track", label: "comments.group.track" },
  { type: "switch", label: "comments.group.switch" },
  { type: "signal", label: "comments.group.signal" },
  { type: "service-line", label: "comments.group.service-line" },
  { type: "street-line", label: "comments.group.street-line" },
  { type: "depot", label: "comments.group.depot" },
];

/**
 * Purpose: every object of the project's saved drawings that can carry comments, with a name to show.
 * Inputs: the railway design, the street lines and the depots as saved. Generated signals are left out (their ids
 * change with the design), and street lines without an id yet (an Owner or Editor opening the project gives them one).
 */
export function commentableObjects(
  t: Translate,
  railway: Network | null | undefined,
  streetLines: StreetLinesDoc | null | undefined,
  depots: DepotsDoc | null | undefined,
): CommentableObject[] {
  const out: CommentableObject[] = [];
  const named = (name: string | undefined, key: MessageKey, id: string | number) =>
    name?.trim() ? name : t(key, { id });
  for (const s of railway?.stations ?? [])
    out.push({ type: "station", id: String(s.id), label: named(s.name, "rail.stationN", s.id) });
  for (const tr of railway?.tracks ?? [])
    out.push({ type: "track", id: String(tr.id), label: named(tr.name, "rail.trackN", tr.id) });
  for (const sw of railway?.switches ?? [])
    out.push({ type: "switch", id: String(sw.id), label: t("comments.switchN", { id: sw.id }) });
  for (const sg of railway?.signals ?? [])
    out.push({ type: "signal", id: String(sg.id), label: named(sg.name, "comments.signalN", sg.id) });
  for (const l of railway?.lines ?? []) out.push({ type: "service-line", id: l.id, label: l.name || "—" });
  for (const l of streetLines?.lines ?? [])
    if (l.id) out.push({ type: "street-line", id: l.id, label: l.name || t("street.untitled") });
  for (const d of depots?.depots ?? []) out.push({ type: "depot", id: d.id, label: d.name || "—" });
  return out;
}

/**
 * Purpose: comments for people who cannot open the editors (Commenters and Viewers): the objects with open
 * threads, and a choice of any object of the project to read its threads or start one.
 */
export function CommentsPanel({ objects }: { objects: CommentableObject[] }) {
  const { t } = useI18n();
  const open = useOpenThreads();
  const [chosen, setChosen] = useState<string>("");
  const byKey = useMemo(() => new Map(objects.map((o) => [objectKey(o.type, o.id), o])), [objects]);
  const withThreads = objects.filter((o) => open.has(objectKey(o.type, o.id)));
  const current = byKey.get(chosen) ?? null;

  return (
    <section aria-labelledby="comments-panel" className="flex flex-col gap-3">
      <h2 id="comments-panel" className="text-lg font-semibold">
        {t("comments.title")}
      </h2>
      <p className="text-slate-600">{t("comments.panelIntro")}</p>
      {objects.length === 0 ? (
        <p className="text-slate-600">{t("comments.noObjects")}</p>
      ) : (
        <>
          <div>
            <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
              {t("comments.openList")}
            </h3>
            {withThreads.length === 0 ? (
              <p className="mt-1 text-slate-600">{t("comments.noOpen")}</p>
            ) : (
              <ul className="mt-1 flex flex-col">
                {withThreads.map((o) => {
                  const k = objectKey(o.type, o.id);
                  return (
                    <li key={k}>
                      <button
                        type="button"
                        aria-current={k === chosen}
                        onClick={() => setChosen(k)}
                        className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-slate-100 aria-[current=true]:bg-amber-50"
                      >
                        <span className="min-w-0 flex-1 truncate">{o.label}</span>
                        <span className="shrink-0 text-xs text-slate-500">
                          {t(GROUPS.find((g) => g.type === o.type)!.label)}
                        </span>
                        <span className="shrink-0 rounded-full bg-amber-100 px-1.5 text-xs font-medium text-amber-900">
                          💬 {open.get(k)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-600">{t("comments.object")}</span>
            <select
              value={chosen}
              onChange={(e) => setChosen(e.target.value)}
              className="rounded border border-slate-300 bg-white p-1"
            >
              <option value="">{t("comments.choose")}</option>
              {GROUPS.map((g) => {
                const items = objects.filter((o) => o.type === g.type);
                return items.length ? (
                  <optgroup key={g.type} label={t(g.label)}>
                    {items.map((o) => (
                      <option key={o.id} value={objectKey(o.type, o.id)}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                ) : null;
              })}
            </select>
          </label>
          {current && (
            <div>
              <p className="font-medium">{current.label}</p>
              <ObjectComments type={current.type} id={current.id} />
            </div>
          )}
        </>
      )}
    </section>
  );
}
