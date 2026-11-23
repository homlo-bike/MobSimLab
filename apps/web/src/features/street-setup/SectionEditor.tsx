import { useState } from "react";
import type { MessageKey } from "../../i18n/en";
import { type Translate, useI18n } from "../../i18n/i18n";
import {
  has,
  MAX_WIDTH,
  MIN_WIDTH,
  moves,
  newSection,
  ROAD_USERS,
  SECTION_KINDS,
  sectionFill,
  sectionName,
  sortedUsers,
  STYLES,
  TEMPLATES,
  template,
  totalWidth,
  typicalWidth,
} from "./sections";
import type { RoadUser, Section, SectionDir, SectionKind } from "./types";

const KIND_LABEL: Record<SectionKind, MessageKey> = {
  lane: "setup.lay.kind.lane",
  parking: "setup.lay.kind.parking",
  island: "setup.lay.kind.island",
  green: "setup.lay.kind.green",
  protection: "setup.lay.kind.protection",
};
const USER_LABEL: Record<RoadUser, MessageKey> = {
  car: "setup.lay.user.car",
  bus: "setup.lay.user.bus",
  tram: "setup.lay.user.tram",
  bike: "setup.lay.user.bike",
  taxi: "setup.lay.user.taxi",
  walk: "setup.lay.user.walk",
};
const ONE_LABEL: Record<RoadUser, MessageKey> = {
  car: "setup.lay.one.car",
  bus: "setup.lay.one.bus",
  tram: "setup.lay.one.tram",
  bike: "setup.lay.one.bike",
  taxi: "setup.lay.one.taxi",
  walk: "setup.lay.one.walk",
};
const SHORT_LABEL: Record<RoadUser, MessageKey> = {
  car: "setup.lay.short.car",
  bus: "setup.lay.short.bus",
  tram: "setup.lay.short.tram",
  bike: "setup.lay.short.bike",
  taxi: "setup.lay.short.taxi",
  walk: "setup.lay.short.walk",
};
const STYLE_TITLE: Partial<Record<SectionKind, MessageKey>> = {
  protection: "setup.lay.style.protection",
  island: "setup.lay.style.island",
  green: "setup.lay.style.green",
};
const STYLE_LABEL: Record<string, MessageKey> = {
  kerb: "setup.lay.style.kerb",
  bollards: "setup.lay.style.bollards",
  planters: "setup.lay.style.planters",
  raised: "setup.lay.style.raised",
  painted: "setup.lay.style.painted",
  trees: "setup.lay.style.trees",
  grass: "setup.lay.style.grass",
  shrubs: "setup.lay.style.shrubs",
};
const DIRS: [SectionDir, MessageKey][] = [
  ["backward", "setup.lay.dir.backward"],
  ["forward", "setup.lay.dir.forward"],
  ["both", "setup.lay.dir.both"],
];
const TEMPLATE_LABEL: Record<(typeof TEMPLATES)[number], MessageKey> = {
  centreBus: "setup.lay.t.centreBus",
  tramPeople: "setup.lay.t.tramPeople",
  protectedBike: "setup.lay.t.protectedBike",
  tramBus: "setup.lay.t.tramBus",
};

/** Purpose: the name of a section as the editor shows it: "Bus lane", "General traffic", "Cars + Trams"... */
export function nameOf(s: Section, t: Translate): string {
  const n = sectionName(s);
  switch (n.key) {
    case "one":
      return t(ONE_LABEL[n.user]);
    case "mixed":
      return n.users.map((u) => t(USER_LABEL[u])).join(" + ");
    case "new":
      return t("setup.lay.name.new");
    case "general":
      return t("setup.lay.name.general");
    case "shared":
      return t("setup.lay.name.shared");
    default:
      return t(KIND_LABEL[n.key]);
  }
}

/** Purpose: the short mark on a section in the strip. */
function markOf(s: Section, t: Translate): string {
  if (s.kind !== "lane")
    return s.style && s.kind !== "protection" ? t(STYLE_LABEL[s.style] ?? KIND_LABEL[s.kind]) : "";
  const n = sectionName(s);
  if (n.key === "one") return t(SHORT_LABEL[n.user]);
  if (n.key === "general") return t("setup.lay.short.mixed");
  if (n.key === "mixed") return n.users.map((u) => t(SHORT_LABEL[u])).join("+");
  if (n.key === "shared") return `${t(SHORT_LABEL.bike)}+${t(SHORT_LABEL.walk)}`;
  return "?";
}

const arrow = (s: Section) => (!moves(s) ? "" : s.dir === "forward" ? "↑" : s.dir === "backward" ? "↓" : "↕");

const fmt = (m: number) => (Math.round(m * 10) / 10).toFixed(1);

/**
 * Purpose: the custom layout of a street, section by section from building to building: a strip to pick a
 * section from, a button to add one, and the selected section's type, users, direction, width and place.
 * Ready-made layouts replace all sections at once.
 */
export function SectionEditor({
  sections,
  streetWidth,
  editable,
  onChange,
}: {
  sections: readonly Section[];
  /** The street's width from OpenStreetMap, building to building, when tagged. */
  streetWidth: number | null;
  editable: boolean;
  onChange: (sections: Section[]) => void;
}) {
  const { t } = useI18n();
  const [picked, setPicked] = useState(0);
  const at = Math.min(Math.max(0, picked), Math.max(0, sections.length - 1));
  const sel = sections[at];

  const edit = (f: (list: Section[], i: number) => number | void) => {
    const list = sections.map((s) => ({ ...s, users: [...(s.users ?? [])] }));
    const next = f(list, at);
    onChange(list);
    if (typeof next === "number") setPicked(next);
  };
  const total = totalWidth(sections);
  const over = streetWidth != null ? total - streetWidth : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <div
          role="listbox"
          aria-label={t("setup.lay.sections")}
          // A drawing of the street, kerb to kerb: it keeps its sides in right-to-left languages.
          dir="ltr"
          className="flex h-20 w-full overflow-hidden rounded-lg border border-slate-300"
        >
          {sections.map((s, i) => {
            const name = nameOf(s, t);
            const wide = s.width >= 2.4;
            return (
              <button
                key={i}
                type="button"
                role="option"
                aria-selected={i === at}
                aria-label={t("setup.lay.optionLabel", { name, width: fmt(s.width) })}
                onClick={() => setPicked(i)}
                className={`relative flex min-w-0 flex-col items-center justify-center gap-0.5 overflow-hidden border-e border-slate-900/15 text-slate-900 aria-selected:outline-3 aria-selected:-outline-offset-3 aria-selected:outline-blue-700 ${
                  s.kind === "protection" ? "text-white" : ""
                }`}
                style={{ flex: `${s.width} 1 0`, background: sectionFill(s) }}
              >
                {has(s, "tram") && (
                  <>
                    <span aria-hidden="true" className="absolute inset-y-0 left-[28%] w-0.5 bg-stone-600" />
                    <span aria-hidden="true" className="absolute inset-y-0 right-[28%] w-0.5 bg-stone-600" />
                  </>
                )}
                <span aria-hidden="true" className="relative text-base leading-none font-bold">
                  {arrow(s)}
                </span>
                {wide && (
                  <span
                    aria-hidden="true"
                    className="relative max-w-full truncate rounded bg-white/70 px-0.5 text-[10px] font-bold uppercase"
                  >
                    {markOf(s, t)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p className={`text-xs ${over > 0.05 ? "font-medium text-red-700" : "text-slate-500"}`}>
          {streetWidth != null
            ? over > 0.05
              ? t("setup.lay.tooWide", { total: fmt(total), street: fmt(streetWidth), over: fmt(over) })
              : t("setup.lay.totalOf", { total: fmt(total), street: fmt(streetWidth) })
            : t("setup.lay.total", { total: fmt(total) })}
        </p>
      </div>

      <fieldset disabled={!editable} className="flex flex-col gap-3">
        <button
          type="button"
          className="btn min-h-11 w-full border-dashed"
          onClick={() =>
            edit((list, i) => {
              list.splice(i + 1, 0, newSection("lane"));
              return list.length === 1 ? 0 : i + 1;
            })
          }
        >
          {t("setup.lay.add")}
        </button>

        {sel && (
          <section
            aria-label={t("setup.lay.selected", { name: nameOf(sel, t) })}
            className="flex flex-col gap-3 rounded-xl border border-slate-200 p-3"
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-4 w-4 shrink-0 rounded border border-slate-400"
                style={{ background: sectionFill(sel) }}
              />
              <h4 className="min-w-0 flex-1 truncate font-semibold">{nameOf(sel, t)}</h4>
              <span className="shrink-0 text-xs text-slate-500">
                {t("setup.lay.position", { n: at + 1, count: sections.length })}
              </span>
            </div>

            <div role="group" aria-label={t("setup.lay.what")}>
              <div className="text-sm font-medium">{t("setup.lay.what")}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {SECTION_KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={sel.kind === k}
                    className="chip min-h-11 text-sm"
                    onClick={() =>
                      edit((list, i) => {
                        const s = list[i]!;
                        if (s.kind === k) return;
                        list[i] = { ...newSection(k), users: [] };
                      })
                    }
                  >
                    {t(KIND_LABEL[k])}
                  </button>
                ))}
              </div>
            </div>

            {sel.kind === "lane" && (
              <div role="group" aria-label={t("setup.lay.who")}>
                <div className="text-sm font-medium">{t("setup.lay.who")}</div>
                <div className="mt-1 grid grid-cols-3 gap-1.5">
                  {ROAD_USERS.map((u) => (
                    <button
                      key={u}
                      type="button"
                      aria-pressed={has(sel, u)}
                      className="chip min-h-11 justify-center px-2 text-sm"
                      onClick={() =>
                        edit((list, i) => {
                          const s = list[i]!;
                          const users = has(s, u) ? s.users!.filter((x) => x !== u) : [...s.users!, u];
                          const fresh =
                            sortedUsers(s).length === 0 || s.width === typicalWidth("lane", s.users!);
                          const next: Section = { ...s, users };
                          if (fresh) next.width = typicalWidth("lane", users);
                          if (moves(next) && !next.dir) next.dir = "forward";
                          if (!moves(next)) next.dir = null;
                          list[i] = next;
                        })
                      }
                    >
                      {t(USER_LABEL[u])}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-slate-500">{usersHint(sel, t)}</p>
              </div>
            )}

            {moves(sel) && (
              <div role="group" aria-label={t("setup.lay.dir")}>
                <div className="text-sm font-medium">{t("setup.lay.dir")}</div>
                <div className="seg mt-1 [&>button]:min-h-11">
                  {DIRS.map(([d, l]) => (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={(sel.dir ?? "both") === d}
                      onClick={() =>
                        edit((list, i) => {
                          list[i] = { ...list[i]!, dir: d };
                        })
                      }
                    >
                      {t(l)}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-slate-500">{t("setup.lay.dirHint")}</p>
              </div>
            )}

            {STYLES[sel.kind] && (
              <div role="group" aria-label={t(STYLE_TITLE[sel.kind]!)}>
                <div className="text-sm font-medium">{t(STYLE_TITLE[sel.kind]!)}</div>
                <div className="seg mt-1 [&>button]:min-h-11">
                  {STYLES[sel.kind]!.map((x) => (
                    <button
                      key={x}
                      type="button"
                      aria-pressed={sel.style === x}
                      onClick={() =>
                        edit((list, i) => {
                          list[i] = { ...list[i]!, style: x };
                        })
                      }
                    >
                      {t(STYLE_LABEL[x]!)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <label className="flex flex-col gap-1 text-sm font-medium">
              {t("setup.lay.width")}
              <span className="flex items-center gap-2">
                <input
                  type="range"
                  min={MIN_WIDTH}
                  max={8}
                  step={0.1}
                  value={Math.min(8, sel.width)}
                  aria-label={t("setup.lay.widthSlider")}
                  className="min-w-0 flex-1"
                  onChange={(ev) => {
                    const w = Number(ev.target.value);
                    edit((list, i) => {
                      list[i] = { ...list[i]!, width: w };
                    });
                  }}
                />
                <input
                  type="number"
                  inputMode="decimal"
                  min={MIN_WIDTH}
                  max={MAX_WIDTH}
                  step={0.1}
                  value={fmt(sel.width)}
                  aria-label={t("setup.lay.widthMetres")}
                  className="input min-h-11 w-20 tabular-nums"
                  onChange={(ev) => {
                    const w = Number(ev.target.value);
                    if (!Number.isFinite(w) || w < MIN_WIDTH) return;
                    edit((list, i) => {
                      list[i] = { ...list[i]!, width: Math.min(MAX_WIDTH, Math.round(w * 10) / 10) };
                    });
                  }}
                />
                <span className="text-xs text-slate-500">m</span>
              </span>
            </label>

            <div className="grid grid-cols-[2.75rem_2.75rem_1fr_1fr] gap-1.5">
              <button
                type="button"
                className="btn min-h-11 px-0"
                aria-label={t("setup.lay.left")}
                disabled={at === 0}
                onClick={() =>
                  edit((list, i) => {
                    [list[i - 1], list[i]] = [list[i]!, list[i - 1]!];
                    return i - 1;
                  })
                }
              >
                ←
              </button>
              <button
                type="button"
                className="btn min-h-11 px-0"
                aria-label={t("setup.lay.right")}
                disabled={at >= sections.length - 1}
                onClick={() =>
                  edit((list, i) => {
                    [list[i + 1], list[i]] = [list[i]!, list[i + 1]!];
                    return i + 1;
                  })
                }
              >
                →
              </button>
              <button
                type="button"
                className="btn min-h-11"
                onClick={() =>
                  edit((list, i) => {
                    list.splice(i + 1, 0, { ...list[i]!, users: [...(list[i]!.users ?? [])] });
                    return i + 1;
                  })
                }
              >
                {t("setup.lay.duplicate")}
              </button>
              <button
                type="button"
                className="btn min-h-11 text-red-800"
                disabled={sections.length <= 1}
                onClick={() =>
                  edit((list, i) => {
                    list.splice(i, 1);
                    return Math.min(i, list.length - 1);
                  })
                }
              >
                {t("setup.lay.remove")}
              </button>
            </div>
          </section>
        )}

        <div role="group" aria-label={t("setup.lay.templates")}>
          <div className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
            {t("setup.lay.templates")}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {TEMPLATES.map((id) => (
              <button
                key={id}
                type="button"
                className="btn min-h-11 text-sm"
                onClick={() => {
                  onChange(template(id));
                  setPicked(0);
                }}
              >
                {t(TEMPLATE_LABEL[id])}
              </button>
            ))}
          </div>
        </div>
      </fieldset>
    </div>
  );
}

function usersHint(s: Section, t: Translate): string {
  const us = sortedUsers(s);
  const base =
    us.length === 0
      ? t("setup.lay.nobody")
      : us.length === 1
        ? t("setup.lay.ownHint")
        : t("setup.lay.mixedHint");
  return us.includes("tram") ? `${base} ${t("setup.lay.railsHint")}` : base;
}
