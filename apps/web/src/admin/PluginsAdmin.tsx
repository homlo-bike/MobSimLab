import { type FormEvent, useCallback, useEffect, useState } from "react";
import { formatDateTime, useI18n } from "../i18n/i18n";
import type { ProjectPlugin } from "../plugins/registry";
import { get, send } from "../session/api";
import { addsLine, PERMISSION_LABELS } from "../workspace/ProjectPlugins";
import { EsriImageryAdmin } from "./EsriImageryAdmin";
import { MapLayersAdmin } from "./MapLayersAdmin";

/** One plugin version as `GET /api/admin/plugins` lists it. */
interface PluginRow {
  id: string;
  name: string;
  description: string;
  version: string;
  publisher: { name: string; url?: string };
  license: string;
  dataLicense: string;
  bundled: boolean;
  tiers: string[];
  permissions: string[];
  contributes: ProjectPlugin["contributes"];
  /** It brings code or tab pages of its own, which run in the sandbox. */
  runsCode?: boolean;
  signature?: { status: "trusted" | "unsigned"; signer: string | null };
  sha256?: string;
  installedAt?: string;
  installedBy?: string | null;
  projects: number;
}

interface KeyRow {
  id: string;
  name: string;
  fingerprint: string;
  addedAt: string;
}

interface AdminPlugins {
  bundled: PluginRow[];
  installed: PluginRow[];
  keys: KeyRow[];
  developmentMode: boolean;
  allowUnsigned: boolean;
  /** Memory and time of one call of plugin code. */
  limits?: { memoryMb: number; timeS: number };
}

interface Inspection {
  plugin: PluginRow | null;
  signature: "trusted" | "unsigned" | "untrusted" | null;
  signer: string | null;
  sha256: string;
  problems: string[];
}

/**
 * Purpose: upload a package as the raw file. Output: the parsed JSON answer; a 400 with `problems` is returned,
 * not thrown, so the install screen can list them.
 */
async function upload<T>(path: string, csrfToken: string, file: Blob): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/octet-stream", "X-CSRF-Token": csrfToken },
    body: file,
  });
  const body = (await res.json().catch(() => ({}))) as T & {
    message?: string | string[];
    problems?: string[];
  };
  if (!res.ok && !body.problems)
    throw new Error(
      Array.isArray(body.message) ? body.message.join("; ") : (body.message ?? `${path}: ${res.status}`),
    );
  return body;
}

/**
 * Plugins tab of Administration (ADR-0036 §9): install a signed `.msplugin` package after seeing what it adds and
 * what it may read, remove installed versions, and manage the publisher keys this instance trusts. An Owner can
 * allow unsigned plugins while the instance runs in development mode.
 */
export function PluginsAdmin({
  csrfToken,
  run,
  actorRole,
}: {
  csrfToken: string;
  run: (f: () => Promise<unknown>) => Promise<void>;
  actorRole: string;
}) {
  const { t } = useI18n();
  const [data, setData] = useState<AdminPlugins | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [keyName, setKeyName] = useState("");
  const [keyPem, setKeyPem] = useState("");
  const [limits, setLimits] = useState<{ memoryMb: string; timeS: string } | null>(null);
  const [limitsSaved, setLimitsSaved] = useState(false);
  const load = useCallback(
    () =>
      run(async () => {
        const d = await get<AdminPlugins>("/api/admin/plugins");
        setData(d);
        if (d.limits) setLimits({ memoryMb: String(d.limits.memoryMb), timeS: String(d.limits.timeS) });
      }),
    [run],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!data) return null;

  const choose = (f: File | null) => {
    setFile(f);
    setInspection(null);
    if (f)
      void run(async () =>
        setInspection(
          (await upload<{ inspection: Inspection }>("/api/admin/plugins/inspect", csrfToken, f)).inspection,
        ),
      );
  };
  const install = () =>
    void run(async () => {
      if (!file) return;
      const r = await upload<{ problems?: string[] }>("/api/admin/plugins", csrfToken, file);
      if (r.problems) {
        setInspection((i) => (i ? { ...i, problems: r.problems! } : i));
        return;
      }
      setFile(null);
      setInspection(null);
      await load();
    });
  const remove = (p: PluginRow) =>
    void run(async () => {
      const path = `/api/admin/plugins/${encodeURIComponent(p.id)}/${encodeURIComponent(p.version)}`;
      if (p.projects > 0 && !window.confirm(t("plugins.removeConfirm", { name: p.name, count: p.projects })))
        return;
      await send("DELETE", path, csrfToken, { force: p.projects > 0 });
      await load();
    });
  const addKey = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await send("POST", "/api/admin/plugin-keys", csrfToken, { name: keyName.trim(), publicKey: keyPem });
      setKeyName("");
      setKeyPem("");
      await load();
    });
  };
  const saveLimits = (e: FormEvent) => {
    e.preventDefault();
    if (!limits) return;
    setLimitsSaved(false);
    void run(async () => {
      await send("PUT", "/api/admin/plugin-limits", csrfToken, {
        memoryMb: Number(limits.memoryMb),
        timeS: Number(limits.timeS),
      });
      setLimitsSaved(true);
    });
  };
  const sigText = (s: Inspection["signature"], signer: string | null) =>
    s === "trusted"
      ? t("plugins.signedBy", { name: signer ?? "" })
      : s === "untrusted"
        ? t("plugins.untrusted")
        : t("plugins.unsigned");

  const details = (p: PluginRow) => (
    <>
      <div className="text-xs text-slate-500">
        {p.id} · {t("plugins.versionN", { version: p.version })} ·{" "}
        {p.bundled ? t("plugins.bundled") : t("plugins.by", { publisher: p.publisher.name })}
      </div>
      {p.description && <p className="m-0 text-slate-600">{p.description}</p>}
      <p className="m-0 text-xs text-slate-500">{t("plugins.adds", { list: addsLine(p.contributes, t) })}</p>
      {p.runsCode && <p className="m-0 text-xs font-semibold text-slate-700">{t("pcode.runsCode")}</p>}
      {p.permissions.length > 0 && (
        <p className="m-0 text-xs text-slate-500">
          {t("plugins.uses", {
            list: p.permissions.map((x) => (PERMISSION_LABELS[x] ? t(PERMISSION_LABELS[x]) : x)).join(", "),
          })}
        </p>
      )}
      <p className="m-0 text-xs text-slate-500">
        {t("plugins.licences", { code: p.license, data: p.dataLicense })}
      </p>
    </>
  );

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="flex flex-col gap-4">
        <section aria-labelledby="ap-install" className="flex flex-col gap-2">
          <h3 id="ap-install" className="font-semibold">
            {t("plugins.installTitle")}
          </h3>
          <p className="m-0 text-slate-500">{t("pcode.installIntro")}</p>
          <label className="flex flex-col gap-1">
            {t("plugins.choose")}
            <input
              type="file"
              accept=".msplugin,application/zip"
              onChange={(e) => choose(e.target.files?.[0] ?? null)}
            />
          </label>
          {inspection && (
            <div className="flex flex-col gap-1 rounded border border-slate-200 p-3">
              {inspection.plugin && (
                <>
                  <div className="font-semibold">{inspection.plugin.name}</div>
                  {details(inspection.plugin)}
                </>
              )}
              <p className="m-0 text-xs">{sigText(inspection.signature, inspection.signer)}</p>
              <p className="m-0 font-mono text-xs break-all text-slate-500">SHA-256 {inspection.sha256}</p>
              {inspection.problems.length > 0 ? (
                <div role="alert" className="rounded bg-red-50 p-2 text-red-800">
                  {t("plugins.problems")}
                  <ul className="m-0 ps-5">
                    {inspection.problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <button
                  type="button"
                  className="w-28 rounded bg-slate-800 px-2 py-1 text-white"
                  onClick={install}
                >
                  {t("plugins.install")}
                </button>
              )}
            </div>
          )}
        </section>
        <section aria-labelledby="ap-installed" className="flex flex-col gap-2">
          <h3 id="ap-installed" className="font-semibold">
            {t("plugins.installed")}
          </h3>
          {data.installed.length === 0 && <p className="m-0 text-slate-500">{t("plugins.none")}</p>}
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {data.installed.map((p) => (
              <li
                key={`${p.id}@${p.version}`}
                className="flex flex-col gap-0.5 border-t border-slate-100 pt-2"
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{p.name}</span>
                  <button
                    type="button"
                    className="ms-auto rounded border border-slate-300 px-2"
                    aria-label={t("plugins.removeOne", { name: p.name, version: p.version })}
                    onClick={() => remove(p)}
                  >
                    {t("kit.remove")}
                  </button>
                </div>
                {details(p)}
                <p className="m-0 text-xs text-slate-500">
                  {sigText(p.signature?.status ?? "unsigned", p.signature?.signer ?? null)} ·{" "}
                  {t("plugins.inProjects", { count: p.projects })}
                  {p.installedAt && ` · ${formatDateTime(p.installedAt)}`}
                </p>
              </li>
            ))}
          </ul>
          <h3 className="mt-2 font-semibold">{t("plugins.bundledTitle")}</h3>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {data.bundled.map((p) => (
              <li key={p.id} className="flex flex-col gap-0.5 border-t border-slate-100 pt-2">
                <span className="font-semibold">{p.name}</span>
                {details(p)}
                <p className="m-0 text-xs text-slate-500">{t("plugins.inProjects", { count: p.projects })}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <section aria-labelledby="ap-keys" className="flex flex-col gap-2">
        <h3 id="ap-keys" className="font-semibold">
          {t("plugins.keys")}
        </h3>
        <p className="m-0 text-slate-500">{t("plugins.keysIntro")}</p>
        {data.keys.length === 0 && <p className="m-0 text-slate-500">{t("plugins.noKeys")}</p>}
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {data.keys.map((k) => (
            <li key={k.id} className="flex items-center gap-2">
              <span className="font-semibold">{k.name}</span>
              <span className="truncate font-mono text-xs text-slate-500" title={k.fingerprint}>
                {k.fingerprint.slice(0, 16)}…
              </span>
              <button
                type="button"
                className="ms-auto rounded border border-slate-300 px-2"
                aria-label={t("plugins.removeKey", { name: k.name })}
                onClick={() =>
                  void run(async () => {
                    await send("DELETE", `/api/admin/plugin-keys/${k.id}`, csrfToken);
                    await load();
                  })
                }
              >
                {t("kit.remove")}
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={addKey} className="flex flex-col gap-2" aria-label={t("plugins.addKey")}>
          <label className="flex flex-col gap-1">
            {t("plugins.keyName")}
            <input
              required
              maxLength={200}
              className="rounded border border-slate-300 px-2 py-1"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            {t("plugins.keyPem")}
            <textarea
              required
              rows={4}
              maxLength={4000}
              placeholder="-----BEGIN PUBLIC KEY-----"
              className="rounded border border-slate-300 px-2 py-1 font-mono text-xs"
              value={keyPem}
              onChange={(e) => setKeyPem(e.target.value)}
            />
          </label>
          <button type="submit" className="w-28 rounded bg-slate-800 px-2 py-1 text-white">
            {t("plugins.addKey")}
          </button>
        </form>
        {limits && (
          <form onSubmit={saveLimits} className="mt-4 flex flex-col gap-2" aria-labelledby="ap-limits">
            <h3 id="ap-limits" className="font-semibold">
              {t("pcode.limits")}
            </h3>
            <p className="m-0 text-slate-500">{t("pcode.limitsIntro")}</p>
            <div className="flex flex-wrap gap-3">
              <label className="flex flex-col gap-1">
                {t("pcode.memory")}
                <input
                  type="number"
                  required
                  min={16}
                  max={2048}
                  step={1}
                  className="w-28 rounded border border-slate-300 px-2 py-1"
                  value={limits.memoryMb}
                  onChange={(e) => setLimits({ ...limits, memoryMb: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1">
                {t("pcode.time")}
                <input
                  type="number"
                  required
                  min={1}
                  max={600}
                  step={1}
                  className="w-28 rounded border border-slate-300 px-2 py-1"
                  value={limits.timeS}
                  onChange={(e) => setLimits({ ...limits, timeS: e.target.value })}
                />
              </label>
            </div>
            <div className="flex items-center gap-2">
              <button type="submit" className="rounded bg-slate-800 px-2 py-1 text-white">
                {t("pcode.saveLimits")}
              </button>
              {limitsSaved && (
                <span role="status" className="text-slate-600">
                  {t("pcode.saved")}
                </span>
              )}
            </div>
          </form>
        )}
        {data.developmentMode && actorRole === "owner" && (
          <label className="mt-2 flex items-center gap-2">
            <input
              type="checkbox"
              checked={data.allowUnsigned}
              onChange={(e) =>
                void run(async () => {
                  await send("PUT", "/api/admin/plugin-settings", csrfToken, {
                    allowUnsigned: e.target.checked,
                  });
                  await load();
                })
              }
            />
            {t("plugins.allowUnsigned")}
          </label>
        )}
      </section>
      <EsriImageryAdmin csrfToken={csrfToken} run={run} />
      <MapLayersAdmin csrfToken={csrfToken} run={run} />
    </div>
  );
}
