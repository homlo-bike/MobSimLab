import { useEffect, useRef } from "react";
import { useI18n } from "../../i18n/i18n";
import type { Plugin, PluginTab } from "../registry";
import { pluginRuntime } from "./context";
import type { PluginProjectData } from "./inputs";
import { runCalculation } from "./PluginCalculations";
import type { WorkerFactory } from "./runtime";
import { isDark } from "../../shell/theme";

/** A message from a tab page: `{ mobsimlab: 1, id, method, params }`. */
interface Request {
  mobsimlab: 1;
  id: number;
  method: string;
  params?: { calculation?: unknown; options?: unknown; kind?: unknown };
}

/**
 * Purpose: answer one message of a plugin's tab page (ADR-0036 §6). Methods: `context` (who the page is and the
 * app's language and theme), `run` (one of the calculations the tab lists, on the project's data), `data` (one
 * kind of the project's data the plugin's permissions allow: `timetable` needs read:timetable, `street_lines`
 * read:network). Output: the result; throws Error with a message for the page.
 */
export async function answer(
  plugin: Plugin,
  tab: PluginTab,
  req: Request,
  data: PluginProjectData,
  env: { language: string; theme: "light" | "dark" },
  createWorker?: WorkerFactory,
): Promise<unknown> {
  const allowed = (tab.calculations ?? []).filter((id) =>
    (plugin.calculations ?? []).some((c) => c.id === id && c.runtime === "component"),
  );
  switch (req.method) {
    case "context":
      return {
        plugin: { id: plugin.id, name: plugin.name, version: plugin.version },
        tab: tab.id,
        language: env.language,
        theme: env.theme,
        permissions: plugin.permissions,
        calculations: allowed,
      };
    case "run": {
      const id = req.params?.calculation;
      if (typeof id !== "string" || !allowed.includes(id))
        throw new Error("this tab may not run that calculation");
      const calc = plugin.calculations!.find((c) => c.id === id)!;
      return (await runCalculation({ ...calc, plugin }, data, req.params?.options ?? {}, createWorker))
        .output;
    }
    case "data": {
      const kind = req.params?.kind;
      if (kind === "timetable" && plugin.permissions.includes("read:timetable")) return data.timetable;
      if (kind === "street_lines" && plugin.permissions.includes("read:network")) return data.streetLines;
      throw new Error("the plugin's permissions do not cover that data");
    }
    default:
      throw new Error("unknown method");
  }
}

/**
 * Purpose: an installed plugin's tab: its own page in a sandboxed frame (`sandbox="allow-scripts"`, no
 * same-origin, so it gets no cookies, storage or access to the app; the API serves it with a CSP that blocks
 * every connection). The page talks to the app only through `postMessage`, answered by `answer` above, one
 * request at a time. A line under the frame names the plugin, so its page cannot pass for MobSimLab's own.
 */
export function PluginFrame({
  plugin,
  tab,
  data,
  createWorker,
}: {
  plugin: Plugin;
  tab: PluginTab;
  data: PluginProjectData;
  createWorker?: WorkerFactory;
}) {
  const { t, language } = useI18n();
  const frame = useRef<HTMLIFrameElement>(null);
  const live = useRef({ data, language });
  live.current = { data, language };
  const sha = pluginRuntime().packages[plugin.id];

  useEffect(() => {
    let busy = false;
    const onMessage = async (e: MessageEvent) => {
      const win = frame.current?.contentWindow;
      if (!win || e.source !== win) return;
      const req = e.data as Request;
      if (!req || req.mobsimlab !== 1 || typeof req.id !== "number" || typeof req.method !== "string") return;
      const reply = (body: { result: unknown } | { error: string }) =>
        win.postMessage({ mobsimlab: 1, id: req.id, ...body }, "*");
      if (busy) return reply({ error: "busy: wait for the last request" });
      busy = true;
      try {
        const theme = isDark() ? "dark" : "light";
        reply({
          result: await answer(
            plugin,
            tab,
            req,
            live.current.data,
            { language: live.current.language, theme },
            createWorker,
          ),
        });
      } catch (err) {
        reply({ error: (err instanceof Error ? err.message : String(err)).slice(0, 500) });
      } finally {
        busy = false;
      }
    };
    const handler = (e: MessageEvent) => void onMessage(e);
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [plugin, tab, createWorker]);

  if (!sha || !tab.ui) return null;
  const src = `/api/plugin-ui/${sha}/${tab.ui.split("/").map(encodeURIComponent).join("/")}`;
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <iframe
        ref={frame}
        src={src}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        title={t("pcode.frameTitle", { tab: tab.label, plugin: plugin.name })}
        className="min-h-0 w-full flex-1 border-0"
      />
      <p className="m-0 border-t border-slate-200 px-4 py-1.5 text-xs text-slate-500">
        {t("pcode.frameNote", { plugin: plugin.name, publisher: plugin.publisher.name })}
      </p>
    </div>
  );
}
