import type { Map as MapLibreMap } from "maplibre-gl";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { formatDateTime, tNow, useI18n } from "../i18n/i18n";
import { get, send } from "../session/api";
import { clearScenario, type ScenarioView, showScenario } from "./scenarioLayer";

interface Info {
  mcpUrl: string;
  scopes: { id: string; label: string }[];
}

interface Connection {
  id: string;
  kind: "oauth" | "pat";
  name: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  recentActions: { at: string; action: string; tool: string | null }[];
}

interface ScenarioRow {
  id: string;
  name: string;
  description: string;
  origin: "agent" | "user";
  client_name: string | null;
  version: number;
  updated_at: string;
}

interface Coverage {
  report: { headline: string; covered_share_pct: number; crow_flies_share_pct: number; demand: string };
  layer: object;
}

const when = (s: string | null) => (s ? formatDateTime(s) : tNow("agents.never"));

/**
 * AI agents (ADR-0035): how to connect Claude or another MCP client, the connected agents with their recent
 * actions and a disconnect button, personal access tokens, the scenarios agents made (shown on the map with
 * their 15-minute walk catchment), and for Admins the client registration switch.
 */
export function AgentsPanel({
  role,
  csrfToken,
  map,
  onClose,
}: {
  role: string;
  csrfToken: string;
  map: MapLibreMap | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [info, setInfo] = useState<Info | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [scenarios, setScenarios] = useState<ScenarioRow[]>([]);
  const [registration, setRegistration] = useState<boolean | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [shown, setShown] = useState<{ id: string; coverage: Coverage | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const admin = role === "owner" || role === "admin";
  const allowed = admin || role === "user";

  const run = useCallback(async (f: () => Promise<unknown>) => {
    setError(null);
    try {
      await f();
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  const reload = useCallback(
    () =>
      run(async () => {
        setInfo(await get<Info>("/api/agents/info"));
        setConnections((await get<{ connections: Connection[] }>("/api/agents/connections")).connections);
        setScenarios((await get<{ scenarios: ScenarioRow[] }>("/api/agents/scenarios")).scenarios);
        if (admin)
          setRegistration(
            (await get<{ dynamicRegistration: boolean }>("/api/agents/settings")).dynamicRegistration,
          );
      }),
    [run, admin],
  );
  useEffect(() => {
    if (allowed) void reload();
  }, [allowed, reload]);

  const createToken = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const scopes = info?.scopes.map((s) => s.id).filter((id) => f.get(`scope-${id}`) === "on") ?? [];
    void run(async () => {
      const r = await send<{ token: string }>("POST", "/api/agents/tokens", csrfToken, {
        name: String(f.get("name") ?? ""),
        scopes,
        expiresInDays: Number(f.get("days") ?? 30),
      });
      setNewToken(r.token);
      await reload();
    });
  };

  const show = (id: string) =>
    run(async () => {
      const s = await get<ScenarioView>(`/api/agents/scenarios/${id}`);
      setShown({ id, coverage: null });
      if (map) showScenario(map, s, null);
      const c = await get<Coverage>(`/api/agents/scenarios/${id}/coverage`).catch((e: Error) => {
        setError(tNow("agents.noCoverage", { error: e.message }));
        return null;
      });
      setShown({ id, coverage: c });
      if (map && c) showScenario(map, s, c.layer);
    });

  const close = () => {
    if (map) clearScenario(map);
    onClose();
  };

  return (
    <section
      aria-label={t("agents.title")}
      className="absolute inset-y-4 start-4 z-20 flex w-[34rem] max-w-[calc(100%-2rem)] flex-col rounded border border-slate-300 bg-white text-sm shadow-lg"
    >
      <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-2">
        <h2 className="font-semibold">{t("agents.title")}</h2>
        <button type="button" className="ms-auto rounded border border-slate-300 px-2 py-0.5" onClick={close}>
          {t("agents.close")}
        </button>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-3">
        {error && (
          <p role="alert" className="rounded border border-red-300 bg-red-50 px-2 py-1 text-red-800">
            {error}
          </p>
        )}
        {!allowed && <p>{t("agents.notAllowed")}</p>}
        {allowed && info && (
          <section aria-label={t("agents.connect")}>
            <h3 className="mb-1 font-medium">{t("agents.connectTitle")}</h3>
            <p className="mb-1">{t("agents.connectHelp")}</p>
            <code className="block rounded bg-slate-100 px-2 py-1 select-all">{info.mcpUrl}</code>
          </section>
        )}
        {allowed && (
          <section aria-label={t("agents.connected")}>
            <h3 className="mb-1 font-medium">{t("agents.connectedTitle")}</h3>
            {connections.length === 0 && <p className="text-slate-600">{t("agents.nothing")}</p>}
            <ul className="space-y-2">
              {connections.map((c) => (
                <li key={c.id} className="rounded border border-slate-200 px-2 py-1">
                  <div className="flex items-center gap-2">
                    <strong>{c.name}</strong>
                    <span className="text-slate-500">
                      {t(c.kind === "pat" ? "agents.kindToken" : "agents.kindApp")}
                    </span>
                    <button
                      type="button"
                      className="ms-auto rounded border border-slate-300 px-2 py-0.5"
                      onClick={() =>
                        void run(async () => {
                          await send("DELETE", `/api/agents/connections/${c.id}`, csrfToken);
                          await reload();
                        })
                      }
                    >
                      {t("agents.disconnect")}
                    </button>
                  </div>
                  <div className="text-slate-600">
                    {t("agents.lastUsed", { scopes: c.scopes.join(", "), when: when(c.lastUsedAt) })}
                    {c.expiresAt && t("agents.expires", { when: when(c.expiresAt) })}
                  </div>
                  {c.recentActions.length > 0 && (
                    <div className="text-slate-600">
                      {t("agents.recent", {
                        list: c.recentActions.map((a) => a.tool ?? a.action).join(", "),
                      })}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {allowed && info && (
          <section aria-label={t("agents.pat")}>
            <h3 className="mb-1 font-medium">{t("agents.patTitle")}</h3>
            {newToken && (
              <p className="mb-2 rounded border border-amber-300 bg-amber-50 px-2 py-1">
                {t("agents.copyNow")} <code className="select-all break-all">{newToken}</code>
              </p>
            )}
            <form onSubmit={createToken} className="flex flex-wrap items-center gap-2">
              <input
                name="name"
                required
                placeholder={t("agents.name")}
                className="rounded border border-slate-300 px-2 py-0.5"
              />
              {info.scopes.map((s) => (
                <label key={s.id} className="flex items-center gap-1" title={s.label}>
                  <input type="checkbox" name={`scope-${s.id}`} defaultChecked />
                  {s.id}
                </label>
              ))}
              <label className="flex items-center gap-1">
                {t("agents.days")}
                <input
                  name="days"
                  type="number"
                  min={1}
                  max={365}
                  defaultValue={30}
                  className="w-16 rounded border border-slate-300 px-1"
                />
              </label>
              <button type="submit" className="rounded bg-slate-800 px-2 py-0.5 text-white">
                {t("agents.create")}
              </button>
            </form>
          </section>
        )}
        {allowed && (
          <section aria-label={t("agents.scenarios")}>
            <h3 className="mb-1 font-medium">{t("agents.scenariosTitle")}</h3>
            {scenarios.length === 0 && <p className="text-slate-600">{t("agents.noScenarios")}</p>}
            <ul className="space-y-1">
              {scenarios.map((s) => (
                <li key={s.id} className="flex items-center gap-2">
                  {s.origin === "agent" && (
                    <span
                      className="rounded bg-violet-100 px-1 text-xs text-violet-800"
                      title={s.client_name ?? ""}
                    >
                      {t("agents.agent")}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate" title={s.description}>
                    {s.name} <span className="text-slate-500">v{s.version}</span>
                  </span>
                  <button
                    type="button"
                    className="rounded border border-slate-300 px-2 py-0.5"
                    onClick={() => void show(s.id)}
                  >
                    {t("agents.show")}
                  </button>
                  <button
                    type="button"
                    className="rounded border border-slate-300 px-2 py-0.5"
                    onClick={() =>
                      void run(async () => {
                        await send("DELETE", `/api/agents/scenarios/${s.id}`, csrfToken);
                        await reload();
                      })
                    }
                  >
                    {t("kit.delete")}
                  </button>
                </li>
              ))}
            </ul>
            {shown?.coverage && (
              <p className="mt-2 rounded border border-slate-200 bg-slate-50 px-2 py-1">
                {t("agents.coverage", {
                  headline: shown.coverage.report.headline,
                  crow: shown.coverage.report.crow_flies_share_pct,
                  demand: shown.coverage.report.demand,
                })}
              </p>
            )}
          </section>
        )}
        {admin && registration !== null && (
          <section aria-label={t("agents.settings")}>
            <h3 className="mb-1 font-medium">{t("agents.settingsTitle")}</h3>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={registration}
                onChange={(e) =>
                  void run(async () => {
                    const r = await send<{ dynamicRegistration: boolean }>(
                      "PUT",
                      "/api/agents/settings",
                      csrfToken,
                      {
                        dynamicRegistration: e.target.checked,
                      },
                    );
                    setRegistration(r.dynamicRegistration);
                  })
                }
              />
              {t("agents.registration")}
            </label>
          </section>
        )}
      </div>
    </section>
  );
}
