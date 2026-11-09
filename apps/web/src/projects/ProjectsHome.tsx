import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Translate, useI18n } from "../i18n/i18n";
import type { MessageKey } from "../i18n/messages";
import { EyeIcon, MoreIcon, PlusIcon, SearchIcon } from "../shell/icons";
import { anchorOf, Popover } from "../shell/Popover";
import { initials } from "../shell/UserMenu";
import { can, type Project, type ProjectsApi, type Shelf, shelfOf } from "./api";
import { DeleteDialog, NewProjectDialog, RenameDialog, ShareDialog } from "./ProjectDialogs";

type Filter = "all" | Shelf | "archived";
type Dialogs =
  | { kind: "new" }
  | { kind: "rename" | "delete"; project: Project }
  | { kind: "share"; project: Project; focus: "invite" | "access" };

const LINE_COLOURS = ["#1d4ed8", "#c81e1e", "#c2410c", "#0f766e", "#7c3aed", "#475569"];

/** Purpose: a small deterministic "network" drawing per project, so cards are easy to tell apart. */
function Thumb({ id, className }: { id: string; className: string }) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const pick = (n: number) => ((h >>> n) & 0xff) / 255;
  const a = LINE_COLOURS[h % LINE_COLOURS.length];
  const b = LINE_COLOURS[(h >>> 3) % LINE_COLOURS.length];
  const y1 = 20 + pick(4) * 56;
  const x2 = 40 + pick(12) * 200;
  return (
    <svg viewBox="0 0 280 96" aria-hidden="true" className={className} preserveAspectRatio="xMidYMid slice">
      <rect width="280" height="96" fill="#eef1f4" />
      <path d={`M0 ${y1} H${x2 - 30} L${x2} ${y1 - 20} H280`} stroke={a} strokeWidth="5" fill="none" />
      <path d={`M${x2} 0 V96`} stroke={b} strokeWidth="5" />
      <circle cx={x2} cy={y1 - 20} r="6" fill="#fff" stroke="#0f172a" strokeWidth="3" />
    </svg>
  );
}

/** Purpose: "Edited 12 min ago" style text in the current language. */
function edited(iso: string, language: string, t: Translate): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  const ago =
    s < 60
      ? rtf.format(0, "minute")
      : s < 3600
        ? rtf.format(-Math.round(s / 60), "minute")
        : s < 86400
          ? rtf.format(-Math.round(s / 3600), "hour")
          : rtf.format(-Math.round(s / 86400), "day");
  return t("home.edited", { when: ago });
}

const isPhone = () =>
  typeof window.matchMedia === "function" && window.matchMedia("(max-width: 767px)").matches;

/**
 * The projects home (mockups "Projects home", desktop, tablet and phone): own projects, projects shared with the
 * person that they can edit, view-only projects, and archived ones; a New project card; and on each project a
 * menu with Open, Rename, Share, Manage access, Duplicate, Archive and Delete, by right-click, the ⋯ button, the
 * keyboard context-menu key, or a long press on touch screens.
 */
export function ProjectsHome({
  api,
  meId,
  canCreate,
  onOpen,
}: {
  api: ProjectsApi;
  meId: string;
  canCreate: boolean;
  onOpen: (p: Project, fresh?: boolean) => void;
}) {
  const { t, language } = useI18n();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [archived, setArchived] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState<{
    project: Project;
    at: { x: number; y: number; w?: number; h?: number };
    sheet: boolean;
  } | null>(null);
  const [dialog, setDialog] = useState<Dialogs | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(() => {
    api.list(false).then(setProjects, (e: unknown) => setError(String(e)));
    api.list(true).then(setArchived, () => setArchived([]));
  }, [api]);
  useEffect(reload, [reload]);

  const counts = useMemo(() => {
    const c = { mine: 0, shared: 0, viewOnly: 0 };
    for (const p of projects ?? []) c[shelfOf(p)]++;
    return c;
  }, [projects]);

  const needle = q.trim().toLowerCase();
  const matches = (p: Project) =>
    !needle || p.name.toLowerCase().includes(needle) || (p.areaName ?? "").toLowerCase().includes(needle);
  const shelves: { shelf: Shelf | "archived"; title: MessageKey; items: Project[] }[] =
    filter === "archived"
      ? [{ shelf: "archived", title: "home.archived", items: (archived ?? []).filter(matches) }]
      : (
          [
            ["mine", "home.mine"],
            ["shared", "home.sharedEdit"],
            ["viewOnly", "home.viewOnly"],
          ] as const
        )
          .filter(([s]) => filter === "all" || filter === s)
          .map(([shelf, title]) => ({
            shelf,
            title,
            items: (projects ?? []).filter((p) => shelfOf(p) === shelf && matches(p)),
          }));

  const openMenu = (project: Project, e: MouseEvent | { currentTarget: Element }, fromPointer: boolean) => {
    const sheet = isPhone();
    const at =
      fromPointer && "clientX" in e && (e.clientX || e.clientY)
        ? { x: e.clientX, y: e.clientY }
        : anchorOf(e.currentTarget);
    setMenu({ project, at, sheet });
  };

  // Long press on touch screens opens the actions; a short tap opens the project.
  const press = useRef<{ timer: number; fired: boolean } | null>(null);
  const touchHandlers = (p: Project) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== "touch") return;
      const target = e.currentTarget;
      press.current = {
        fired: false,
        timer: window.setTimeout(() => {
          if (press.current) press.current.fired = true;
          openMenu(p, { currentTarget: target }, false);
        }, 500),
      };
    },
    onPointerUp: () => press.current && window.clearTimeout(press.current.timer),
    onPointerLeave: () => press.current && window.clearTimeout(press.current.timer),
    onPointerCancel: () => press.current && window.clearTimeout(press.current.timer),
  });
  const open = (p: Project) => {
    if (press.current?.fired) {
      press.current = null;
      return;
    }
    onOpen(p);
  };

  const replace = (p: Project) => {
    setProjects((ps) => ps?.map((x) => (x.id === p.id ? p : x)) ?? null);
  };
  const act = async (f: () => Promise<void>) => {
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: t("home.all") },
    { id: "mine", label: `${t("home.mine")} · ${counts.mine}` },
    { id: "shared", label: `${t("home.shared")} · ${counts.shared}` },
    { id: "viewOnly", label: `${t("home.viewOnly")} · ${counts.viewOnly}` },
    { id: "archived", label: t("home.archived") },
  ];

  const actions = (p: Project) => {
    const close = () => setMenu(null);
    const item = (label: MessageKey, onClick: () => void, danger = false) => (
      <button
        key={label}
        type="button"
        role="menuitem"
        className={`menu-item ${danger ? "text-red-700" : ""}`}
        onClick={() => (close(), onClick())}
      >
        {t(label)}
      </button>
    );
    return [
      item("menu.open", () => onOpen(p)),
      can.edit(p) && item("menu.rename", () => setDialog({ kind: "rename", project: p })),
      can.manage(p) && item("menu.share", () => setDialog({ kind: "share", project: p, focus: "invite" })),
      item("menu.access", () => setDialog({ kind: "share", project: p, focus: "access" })),
      canCreate &&
        item(
          "menu.duplicate",
          () =>
            void act(async () => {
              const copy = await api.duplicate(p.id);
              setProjects((ps) => [copy, ...(ps ?? [])]);
              setNotice(t("home.duplicated", { name: copy.name }));
            }),
        ),
      can.manage(p) && <hr key="hr" className="my-1.5 border-slate-200" />,
      can.manage(p) &&
        (p.archivedAt
          ? item(
              "menu.unarchive",
              () =>
                void act(async () => {
                  await api.archive(p.id, false);
                  reload();
                }),
            )
          : item(
              "menu.archive",
              () =>
                void act(async () => {
                  await api.archive(p.id, true);
                  reload();
                  setNotice(t("home.archivedNotice", { name: p.name }));
                }),
            )),
      can.manage(p) && item("menu.delete", () => setDialog({ kind: "delete", project: p }), true),
    ].filter(Boolean);
  };

  const card = (p: Project) => {
    const meta =
      shelfOf(p) === "mine"
        ? edited(p.updatedAt, language, t)
        : `${p.owner.displayName ?? "—"} · ${t(`prole.${p.myRole}` as MessageKey)}`;
    return (
      <li
        key={p.id}
        className={`group relative flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-1.5 md:block md:overflow-hidden md:rounded-xl md:border md:p-0 ${menu?.project.id === p.id ? "md:border-blue-700 md:ring-2 md:ring-blue-200" : ""}`}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenu(p, e, true);
        }}
        {...touchHandlers(p)}
      >
        <button
          type="button"
          className="flex min-h-15 min-w-0 flex-1 items-center gap-3 text-start focus-visible:outline-2 focus-visible:outline-blue-700 md:block md:w-full"
          onClick={() => open(p)}
          aria-describedby={`meta-${p.id}`}
        >
          <Thumb id={p.id} className="h-10 w-14 shrink-0 rounded-lg md:h-24 md:w-full md:rounded-none" />
          <span className="block min-w-0 md:px-3 md:pt-2.5 md:pb-3 md:pe-12">
            <span className="block truncate font-semibold">{p.name}</span>
            <span id={`meta-${p.id}`} className="flex items-center gap-1 truncate text-xs text-slate-500">
              {shelfOf(p) === "viewOnly" && <EyeIcon size={14} />}
              {meta}
              {p.memberCount > 1 &&
                shelfOf(p) === "mine" &&
                ` · ${t("home.people", { count: p.memberCount })}`}
            </span>
          </span>
        </button>
        <button
          type="button"
          className="icon-btn md:absolute md:end-1 md:bottom-1.5"
          aria-label={t("home.actionsFor", { name: p.name })}
          aria-haspopup="menu"
          onClick={(e) => openMenu(p, e, false)}
        >
          <MoreIcon />
        </button>
      </li>
    );
  };

  const loaded = projects !== null;
  const empty = loaded && projects.length === 0 && filter !== "archived";

  return (
    <div className="relative h-full overflow-y-auto bg-slate-50">
      <main className="mx-auto max-w-[1280px] pb-28 md:px-10 md:py-6">
        <div className="flex flex-wrap items-center gap-3 px-4 pt-4 md:px-0 md:pt-0">
          <h1 className="m-0 flex-1 text-[26px] font-semibold tracking-tight">{t("home.title")}</h1>
          <label className="field order-last w-full md:order-none md:w-80">
            <SearchIcon size={18} />
            <input
              type="search"
              aria-label={t("home.search")}
              placeholder={t("home.search")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          {canCreate && (
            <button
              type="button"
              className="btn btn-pri hidden md:inline-flex"
              onClick={() => setDialog({ kind: "new" })}
            >
              <PlusIcon />
              {t("home.new")}
            </button>
          )}
        </div>
        <div
          role="tablist"
          aria-label={t("home.filter")}
          className="mt-3 flex gap-2 overflow-x-auto px-4 pb-1 md:mt-4 md:px-0"
        >
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className="chip"
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        {notice && (
          <p
            role="status"
            className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 md:mx-0"
          >
            <span className="flex-1">{notice}</span>
            <button type="button" className="btn btn-ghost min-h-8" onClick={() => setNotice(null)}>
              {t("common.dismiss")}
            </button>
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 md:mx-0"
          >
            {error}
          </p>
        )}
        {!loaded && !error && <p className="px-4 py-6 text-slate-500 md:px-0">{t("common.loading")}</p>}
        {empty && (
          <div className="mx-4 mt-8 rounded-2xl border-2 border-dashed border-slate-300 bg-white p-8 text-center md:mx-0">
            <h2 className="text-lg font-semibold">{t("home.emptyTitle")}</h2>
            <p className="mt-1 text-slate-500">{canCreate ? t("home.emptyCreate") : t("home.emptyViewer")}</p>
            {canCreate && (
              <button type="button" className="btn btn-pri mt-4" onClick={() => setDialog({ kind: "new" })}>
                <PlusIcon />
                {t("home.new")}
              </button>
            )}
          </div>
        )}
        {loaded &&
          !empty &&
          shelves.map(({ shelf, title, items }) => {
            const showNew = shelf === "mine" && canCreate && !needle;
            if (items.length === 0 && !showNew && filter === "all") return null;
            return (
              <section key={shelf} aria-label={t(title)} className="mt-5">
                <h2 className="caps mb-2 px-4 md:px-0">{t(title)}</h2>
                <ul className="m-0 grid list-none grid-cols-1 border-t border-slate-200 p-0 md:grid-cols-3 md:gap-3.5 md:border-0 xl:grid-cols-4">
                  {showNew && (
                    <li className="hidden md:block">
                      <button
                        type="button"
                        className="flex h-full min-h-[150px] w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-300 bg-white font-semibold text-blue-700 hover:bg-blue-50"
                        onClick={() => setDialog({ kind: "new" })}
                      >
                        <PlusIcon size={28} />
                        {t("home.new")}
                      </button>
                    </li>
                  )}
                  {items.map(card)}
                  {items.length === 0 && !showNew && (
                    <li className="px-4 py-3 text-sm text-slate-500 md:px-0">{t("home.none")}</li>
                  )}
                </ul>
              </section>
            );
          })}
      </main>

      {canCreate && (
        <button
          type="button"
          className="fixed end-4 bottom-6 z-10 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-700 text-white shadow-lg shadow-blue-700/35 md:hidden"
          aria-label={t("home.new")}
          onClick={() => setDialog({ kind: "new" })}
        >
          <PlusIcon size={26} />
        </button>
      )}

      {menu && !menu.sheet && (
        <Popover
          at={menu.at}
          label={t("home.actionsFor", { name: menu.project.name })}
          onClose={() => setMenu(null)}
        >
          {actions(menu.project)}
        </Popover>
      )}
      {menu?.sheet && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-slate-900/35"
            onClick={() => setMenu(null)}
            aria-hidden="true"
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white pb-3 shadow-2xl">
            <div className="mx-auto mt-2 mb-2 h-1.5 w-10 rounded-full bg-slate-300" aria-hidden="true" />
            <div className="flex items-center gap-3 border-b border-slate-200 px-4 pb-2">
              <span className="avatar">{initials(menu.project.name)}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{menu.project.name}</div>
                <div className="text-xs text-slate-500">{t("home.longPress")}</div>
              </div>
            </div>
            <div
              role="menu"
              aria-label={t("home.actionsFor", { name: menu.project.name })}
              className="px-3 pt-1"
            >
              {actions(menu.project)}
            </div>
          </div>
        </div>
      )}

      {dialog?.kind === "new" && (
        <NewProjectDialog
          api={api}
          projects={projects ?? []}
          onClose={() => setDialog(null)}
          onCreated={(p) => {
            setDialog(null);
            onOpen(p, true);
          }}
        />
      )}
      {dialog?.kind === "rename" && (
        <RenameDialog
          api={api}
          project={dialog.project}
          onClose={() => setDialog(null)}
          onDone={(p) => {
            replace(p);
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "share" && (
        <ShareDialog
          api={api}
          project={dialog.project}
          meId={meId}
          focus={dialog.focus}
          onChanged={replace}
          onLeft={() => {
            setDialog(null);
            reload();
          }}
          onClose={() => {
            setDialog(null);
            reload();
          }}
        />
      )}
      {dialog?.kind === "delete" && (
        <DeleteDialog
          api={api}
          project={dialog.project}
          onClose={() => setDialog(null)}
          onArchived={() => {
            setDialog(null);
            reload();
          }}
          onDeleted={() => {
            setDialog(null);
            setNotice(t("home.deletedNotice", { name: dialog.project.name }));
            reload();
          }}
        />
      )}
    </div>
  );
}
