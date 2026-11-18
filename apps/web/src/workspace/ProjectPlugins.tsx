import { useState } from "react";
import { Dialog } from "../shell/Dialog";
import { useI18n } from "../i18n/i18n";
import type { MessageKey } from "../i18n/messages";
import type { ProjectPlugin } from "../plugins/registry";

/** Plain words for what a plugin may read or write (ADR-0036 §5). */
export const PERMISSION_LABELS: Record<string, MessageKey> = {
  "read:network": "plugins.perm.readNetwork",
  "read:timetable": "plugins.perm.readTimetable",
  "read:fleet": "plugins.perm.readFleet",
  "read:geodata": "plugins.perm.readGeodata",
  "read:results": "plugins.perm.readResults",
  "write:results": "plugins.perm.writeResults",
  "write:scenario": "plugins.perm.writeScenario",
};

/** Purpose: what a plugin adds, as one line: modes, tools, calculations, map layers, basemaps and parameters. */
export function addsLine(
  c: ProjectPlugin["contributes"],
  t: (k: MessageKey, v?: Record<string, string | number>) => string,
) {
  const parts = [
    ...c.modes,
    ...c.tools.filter((x) => !c.modes.includes(x)),
    ...c.calculations,
    ...c.mapLayers,
    ...(c.basemaps ?? []),
    ...(c.importers ?? []),
    ...(c.exporters ?? []),
    ...(c.tabs ?? []),
  ];
  if (c.parameters > 0) parts.push(t("plugins.parameters", { count: c.parameters }));
  return [...new Set(parts)].join(" · ");
}

/**
 * Plugins section of Project Preferences (ADR-0036 §9): every plugin of this MobSimLab, bundled or installed by an
 * Admin, as a short list by name with a switch to use it in this project. Clicking a plugin opens its window: what
 * it does and adds, what it reads and its version. A plugin's own settings (such as Esri's API key) are only in
 * Administration → Plugins. Only the project's Owner turns plugins on or off; turning one off hides its tools and
 * keeps what was drawn.
 */
export function ProjectPlugins({
  plugins,
  manage,
  onSet,
}: {
  plugins: readonly ProjectPlugin[] | null;
  /** The caller owns the project. */
  manage: boolean;
  /** Turn a plugin on or off, with a version for installed plugins; resolves to the new list. */
  onSet: (pluginId: string, enabled: boolean, version?: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const run = async (id: string, enabled: boolean, version?: string) => {
    setBusy(id);
    setError(null);
    try {
      await onSet(id, enabled, version);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const sorted = plugins ? [...plugins].sort((a, b) => a.name.localeCompare(b.name)) : null;
  const shown = sorted?.find((p) => p.id === open) ?? null;
  return (
    <section
      aria-labelledby="pp-plugins"
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 md:p-6"
    >
      <h2 id="pp-plugins" className="caps m-0">
        {t("plugins.title")}
      </h2>
      <p className="mt-1 text-sm text-slate-600">{t("plugins.intro")}</p>
      {error && (
        <p role="alert" className="mt-2 rounded bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {sorted === null ? (
        <p className="mt-3 text-sm text-slate-500">{t("common.loading")}</p>
      ) : (
        <ul className="m-0 mt-2 list-none p-0">
          {sorted.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-3 border-t border-slate-100 py-1 first:border-t-0"
            >
              <button
                type="button"
                className="flex min-h-11 min-w-0 flex-1 flex-col items-start justify-center rounded-lg px-2 text-start hover:bg-slate-50"
                aria-haspopup="dialog"
                onClick={() => setOpen(p.id)}
              >
                <span className="font-semibold">{p.name}</span>
                <span className="w-full truncate text-xs text-slate-500">{addsLine(p.contributes, t)}</span>
                {p.missing && (
                  <span className="text-xs text-amber-800">
                    {t("plugins.missing", { version: p.version })}
                  </span>
                )}
              </button>
              <input
                type="checkbox"
                role="switch"
                className="h-5 w-5 shrink-0"
                aria-label={t("plugins.useIn", { name: p.name })}
                checked={p.enabled}
                disabled={!manage || busy !== null || (!p.bundled && p.versions.length === 0)}
                onChange={(e) =>
                  void run(
                    p.id,
                    e.target.checked,
                    p.bundled || !p.versions.includes(p.version) ? undefined : p.version,
                  )
                }
              />
            </li>
          ))}
        </ul>
      )}
      {!manage && <p className="mt-3 text-sm text-slate-500">{t("plugins.ownerOnly")}</p>}
      {shown && (
        <Dialog
          title={shown.name}
          subtitle={`${shown.bundled ? t("plugins.bundled") : t("plugins.by", { publisher: shown.publisher.name })} · ${t("plugins.versionN", { version: shown.version })}`}
          onClose={() => setOpen(null)}
        >
          <div className="flex flex-col gap-3 text-sm">
            {shown.description && <p className="m-0 text-slate-700">{shown.description}</p>}
            <p className="m-0 text-xs text-slate-500">
              {t("plugins.adds", { list: addsLine(shown.contributes, t) })}
            </p>
            {shown.permissions.length > 0 && (
              <p className="m-0 text-xs text-slate-500">
                {t("plugins.uses", {
                  list: shown.permissions
                    .map((x) => (PERMISSION_LABELS[x] ? t(PERMISSION_LABELS[x]) : x))
                    .join(", "),
                })}
              </p>
            )}
            {shown.missing && (
              <p className="m-0 text-amber-800">{t("plugins.missing", { version: shown.version })}</p>
            )}
            {!shown.bundled && shown.versions.length > 0 && (
              <select
                aria-label={t("plugins.versionOf", { name: shown.name })}
                className="input w-full"
                disabled={!manage || busy !== null}
                value={shown.versions.includes(shown.version) ? shown.version : ""}
                onChange={(e) => void run(shown.id, shown.enabled, e.target.value)}
              >
                {!shown.versions.includes(shown.version) && <option value="">{shown.version}</option>}
                {[...shown.versions].reverse().map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            )}
            <label className="flex items-center gap-2 font-medium">
              <input
                type="checkbox"
                role="switch"
                className="h-5 w-5"
                checked={shown.enabled}
                disabled={!manage || busy !== null || (!shown.bundled && shown.versions.length === 0)}
                onChange={(e) =>
                  void run(
                    shown.id,
                    e.target.checked,
                    shown.bundled || !shown.versions.includes(shown.version) ? undefined : shown.version,
                  )
                }
              />
              {t("plugins.useIn", { name: shown.name })}
            </label>
          </div>
        </Dialog>
      )}
    </section>
  );
}
