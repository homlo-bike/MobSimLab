import { useState } from "react";
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

/** Purpose: what a plugin adds, as one line: modes, tools, calculations, map layers and parameters. */
export function addsLine(c: ProjectPlugin["contributes"], t: (k: MessageKey, v?: Record<string, string | number>) => string) {
  const parts = [...c.modes, ...c.tools.filter((x) => !c.modes.includes(x)), ...c.calculations, ...c.mapLayers];
  if (c.parameters > 0) parts.push(t("plugins.parameters", { count: c.parameters }));
  return [...new Set(parts)].join(" · ");
}

/**
 * Plugins section of Project Preferences (ADR-0036 §9): every plugin of this MobSimLab, bundled or installed by an
 * Admin, with a switch to use it in this project and, for installed plugins, the version. Only the project's
 * Owner changes them; turning a plugin off hides its tools and keeps what was drawn with it.
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
  return (
    <section aria-labelledby="pp-plugins" className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 md:p-6">
      <h2 id="pp-plugins" className="caps m-0">
        {t("plugins.title")}
      </h2>
      <p className="mt-1 text-sm text-slate-600">{t("plugins.intro")}</p>
      {error && (
        <p role="alert" className="mt-2 rounded bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {plugins === null ? (
        <p className="mt-3 text-sm text-slate-500">{t("common.loading")}</p>
      ) : (
        <ul className="m-0 mt-2 list-none p-0">
          {plugins.map((p) => {
            const switchId = `pp-plugin-${p.id}`;
            return (
              <li key={p.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 border-t border-slate-100 py-3 first:border-t-0">
                <div className="min-w-48 flex-1">
                  <label htmlFor={switchId} className="font-semibold">
                    {p.name}
                  </label>
                  <div className="text-xs text-slate-500">
                    {p.bundled ? t("plugins.bundled") : t("plugins.by", { publisher: p.publisher.name })}
                    {" · "}
                    {t("plugins.versionN", { version: p.version })}
                  </div>
                  {p.description && <p className="m-0 mt-1 text-sm text-slate-600">{p.description}</p>}
                  <p className="m-0 mt-1 text-xs text-slate-500">{t("plugins.adds", { list: addsLine(p.contributes, t) })}</p>
                  {p.permissions.length > 0 && (
                    <p className="m-0 mt-0.5 text-xs text-slate-500">
                      {t("plugins.uses", {
                        list: p.permissions.map((x) => (PERMISSION_LABELS[x] ? t(PERMISSION_LABELS[x]) : x)).join(", "),
                      })}
                    </p>
                  )}
                  {p.missing && (
                    <p className="m-0 mt-1 text-sm text-amber-800">{t("plugins.missing", { version: p.version })}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {!p.bundled && p.versions.length > 0 && (
                    <select
                      aria-label={t("plugins.versionOf", { name: p.name })}
                      className="min-h-10 rounded-[10px] border border-slate-300 bg-white px-2"
                      disabled={!manage || busy !== null}
                      value={p.versions.includes(p.version) ? p.version : ""}
                      onChange={(e) => void run(p.id, p.enabled, e.target.value)}
                    >
                      {!p.versions.includes(p.version) && <option value="">{p.version}</option>}
                      {[...p.versions].reverse().map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  )}
                  <input
                    id={switchId}
                    type="checkbox"
                    role="switch"
                    className="h-5 w-5"
                    aria-label={t("plugins.useIn", { name: p.name })}
                    checked={p.enabled}
                    disabled={!manage || busy !== null || (!p.bundled && p.versions.length === 0)}
                    onChange={(e) =>
                      void run(p.id, e.target.checked, p.bundled || !p.versions.includes(p.version) ? undefined : p.version)
                    }
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {!manage && <p className="mt-3 text-sm text-slate-500">{t("plugins.ownerOnly")}</p>}
    </section>
  );
}
