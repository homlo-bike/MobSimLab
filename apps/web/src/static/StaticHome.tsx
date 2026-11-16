import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n/i18n";
import { edited, Thumb } from "../projects/ProjectsHome";
import { EyeIcon, SearchIcon } from "../shell/icons";
import { PROJECTS_PATH, type StaticProjectEntry } from "./shim";

/**
 * The static viewer's first page: the projects in the site's `/projects` folder (written by
 * tools/static-site/add-projects.mjs). Opening one shows its Simulator, Schematic, Tables and Project
 * preferences, read-only.
 */
export function StaticHome({ onOpen }: { onOpen: (id: string) => void }) {
  const { t, language } = useI18n();
  const [projects, setProjects] = useState<StaticProjectEntry[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    let live = true;
    fetch(`${PROJECTS_PATH}/index.json`)
      .then(async (r) =>
        r.ok && !(r.headers.get("Content-Type") ?? "").includes("text/html")
          ? (((await r.json()) as { projects?: StaticProjectEntry[] }).projects ?? [])
          : [],
      )
      .catch(() => [])
      .then((list) => live && setProjects(list));
    return () => {
      live = false;
    };
  }, []);
  const needle = q.trim().toLocaleLowerCase(language);
  const shown = useMemo(
    () =>
      (projects ?? [])
        .filter(
          (p) =>
            !needle ||
            p.name.toLocaleLowerCase(language).includes(needle) ||
            (p.areaName ?? "").toLocaleLowerCase(language).includes(needle),
        )
        .sort((a, b) => a.name.localeCompare(b.name, language)),
    [projects, needle, language],
  );

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
        </div>
        {projects === null && <p className="px-4 py-6 text-slate-500 md:px-0">{t("common.loading")}</p>}
        {projects?.length === 0 && (
          <div className="mx-4 mt-8 rounded-2xl border-2 border-dashed border-slate-300 bg-white p-8 text-center md:mx-0">
            <h2 className="text-lg font-semibold">{t("home.emptyTitle")}</h2>
            <p className="mt-1 text-slate-500">{t("static.empty")}</p>
          </div>
        )}
        {projects !== null && projects.length > 0 && shown.length === 0 && (
          <p className="px-4 py-6 text-slate-500 md:px-0">{t("home.none")}</p>
        )}
        {shown.length > 0 && (
          <ul className="m-0 mt-5 grid list-none grid-cols-1 border-t border-slate-200 p-0 md:grid-cols-3 md:gap-3.5 md:border-0 xl:grid-cols-4">
            {shown.map((p) => (
              <li
                key={p.id}
                className="relative flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-1.5 md:block md:overflow-hidden md:rounded-xl md:border md:p-0"
              >
                <a
                  href={`/projects/${p.id}/simulator`}
                  className="flex min-h-15 min-w-0 flex-1 items-center gap-3 text-start text-inherit no-underline focus-visible:outline-2 focus-visible:outline-blue-700 md:block md:w-full"
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                    e.preventDefault();
                    onOpen(p.id);
                  }}
                  aria-describedby={`meta-${p.id}`}
                >
                  <Thumb
                    id={p.id}
                    className="h-10 w-14 shrink-0 rounded-lg md:h-24 md:w-full md:rounded-none"
                  />
                  <span className="block min-w-0 md:px-3 md:pt-2.5 md:pb-3">
                    <span className="block truncate font-semibold">{p.name}</span>
                    {p.areaName && (
                      <span className="block truncate text-sm text-slate-600">{p.areaName}</span>
                    )}
                    <span
                      id={`meta-${p.id}`}
                      className="flex items-center gap-1 truncate text-xs text-slate-500"
                    >
                      <EyeIcon size={14} />
                      {t("home.viewOnly")} · {edited(p.updatedAt, language, t)}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
