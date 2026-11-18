import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import { formatDateTime, useI18n } from "../i18n/i18n";
import type { MessageKey } from "../i18n/messages";
import { refreshServerBasemaps } from "../map/basemaps";
import type { ProjectPlugin } from "../plugins/registry";
import { get, send } from "../session/api";
import { Dialog } from "../shell/Dialog";
import {
  BoltIcon,
  BusIcon,
  CableIcon,
  CameraIcon,
  CargoBikeIcon,
  FerryIcon,
  GlobeIcon,
  LayersIcon,
  PuzzleIcon,
  SatelliteIcon,
  ShieldIcon,
  SoundIcon,
  TableIcon,
  TrainIcon,
} from "../shell/icons";
import { addsLine, PERMISSION_LABELS } from "../workspace/ProjectPlugins";
import { EsriImageryConfig, type EsriStatus } from "./EsriImageryAdmin";
import { MapLayersConfig } from "./MapLayersAdmin";
import { PluginWindow, type ServiceLink, Switch, useWindowRun } from "./PluginWindow";

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
  /** Plugins turned off for the whole instance (older servers leave it out). */
  off?: string[];
}

interface Inspection {
  plugin: PluginRow | null;
  signature: "trusted" | "unsigned" | "untrusted" | null;
  signer: string | null;
  sha256: string;
  problems: string[];
}

/** One plugin in the list: a bundled plugin, or the installed versions of one plugin, newest first. */
interface Item {
  id: string;
  name: string;
  bundled: boolean;
  versions: PluginRow[];
}

const ESRI = "org.mobsimlab.esri-imagery";
const OGC = "org.mobsimlab.ogc-layers";

/** The logo of each bundled plugin; installed plugins show a puzzle piece. */
const LOGOS: Record<string, { icon: ReactNode; tint: string }> = {
  [ESRI]: { icon: <GlobeIcon size={22} />, tint: "bg-sky-100 text-sky-800" },
  "org.mobsimlab.nasa-gibs": { icon: <SatelliteIcon size={22} />, tint: "bg-indigo-100 text-indigo-800" },
  "org.mobsimlab.panoramax": { icon: <CameraIcon size={22} />, tint: "bg-orange-100 text-orange-800" },
  [OGC]: { icon: <LayersIcon size={22} />, tint: "bg-teal-100 text-teal-800" },
  "org.mobsimlab.aerial-lift": { icon: <CableIcon size={22} />, tint: "bg-violet-100 text-violet-800" },
  "org.mobsimlab.cargo-bike": { icon: <CargoBikeIcon size={22} />, tint: "bg-lime-100 text-lime-800" },
  "org.mobsimlab.energy": { icon: <BoltIcon size={22} />, tint: "bg-amber-100 text-amber-800" },
  "org.mobsimlab.ferry": { icon: <FerryIcon size={22} />, tint: "bg-blue-100 text-blue-800" },
  "org.mobsimlab.gtfs": { icon: <TableIcon size={22} />, tint: "bg-emerald-100 text-emerald-800" },
  "org.mobsimlab.noise": { icon: <SoundIcon size={22} />, tint: "bg-rose-100 text-rose-800" },
  "org.mobsimlab.on-demand-bus": { icon: <BusIcon size={22} />, tint: "bg-cyan-100 text-cyan-800" },
  "org.mobsimlab.people-mover": { icon: <TrainIcon size={22} />, tint: "bg-fuchsia-100 text-fuchsia-800" },
};

/** The outside services each bundled plugin uses (Esri's come with its key status, map layers' from the list). */
const SERVICES: Record<string, ServiceLink[]> = {
  "org.mobsimlab.nasa-gibs": [
    { label: "NASA GIBS", url: "https://www.earthdata.nasa.gov/gibs" },
    { label: "NASA Worldview", url: "https://worldview.earthdata.nasa.gov" },
  ],
  "org.mobsimlab.panoramax": [
    { label: "Panoramax", url: "https://panoramax.fr" },
    { label: "Panoramax API", url: "https://api.panoramax.xyz" },
  ],
};

function Logo({ id }: { id: string }) {
  const l = LOGOS[id] ?? { icon: <PuzzleIcon size={22} />, tint: "bg-slate-100 text-slate-700" };
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${l.tint}`}
    >
      {l.icon}
    </span>
  );
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

type Open = { kind: "plugin"; id: string } | { kind: "install" } | { kind: "publishers" } | null;

/**
 * Plugins tab of Administration (ADR-0036 §9): every plugin of this MobSimLab as a list, each with its logo and
 * name, a Configure button that opens its window (what it does, its fields, Accept changes, and links to the
 * services it uses) and a switch that turns it on or off for the whole MobSimLab. Installing a signed `.msplugin`
 * package and the publisher keys and code limits are in their own windows.
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
  const [esri, setEsri] = useState<EsriStatus | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(
    () =>
      run(async () => {
        const [d, b] = await Promise.all([
          get<AdminPlugins>("/api/admin/plugins"),
          get<{ esri: EsriStatus }>("/api/admin/basemaps"),
        ]);
        setData(d);
        setEsri(b.esri);
      }),
    [run],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!data) return null;

  const off = new Set(data.off ?? []);
  const items: Item[] = [
    ...data.bundled.map((p) => ({ id: p.id, name: p.name, bundled: true, versions: [p] })),
    ...Object.values(
      data.installed.reduce<Record<string, PluginRow[]>>((acc, p) => {
        (acc[p.id] ??= []).push(p);
        return acc;
      }, {}),
    ).map((versions) => ({ id: versions[0]!.id, name: versions[0]!.name, bundled: false, versions })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  const setOn = (id: string, on: boolean) => {
    setBusy(id);
    void run(async () => {
      try {
        const r = await send<{ off: string[] }>(
          "PUT",
          `/api/admin/plugins/${encodeURIComponent(id)}/enabled`,
          csrfToken,
          { enabled: on },
        );
        setData((d) => (d ? { ...d, off: r.off } : d));
        // Open maps stop or start offering its basemaps and layers at once.
        void refreshServerBasemaps();
      } finally {
        setBusy(null);
      }
    });
  };

  const meta = (p: PluginRow) =>
    [
      p.bundled ? t("plugins.bundled") : t("plugins.by", { publisher: p.publisher.name }),
      t("plugins.versionN", { version: p.version }),
      t("plugins.inProjects", { count: p.projects }),
    ].join(" · ");

  /** A short line under the name: only what needs the Admin. */
  const status = (it: Item): { text: string; warn: boolean } | null => {
    if (off.has(it.id)) return { text: t("padmin.offEverywhere"), warn: false };
    if (it.id === ESRI && esri && !esri.configured) return { text: t("padmin.needsKey"), warn: true };
    return null;
  };

  const shown = open?.kind === "plugin" ? items.find((i) => i.id === open.id) : undefined;
  const close = () => setOpen(null);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="m-0 w-full text-slate-600 md:w-auto md:min-w-0 md:flex-1">{t("padmin.intro")}</p>
        <button
          type="button"
          className="btn flex-1 md:flex-none"
          onClick={() => setOpen({ kind: "publishers" })}
        >
          <ShieldIcon size={18} />
          {t("padmin.publishers")}
        </button>
        <button
          type="button"
          className="btn btn-dark flex-1 md:flex-none"
          onClick={() => setOpen({ kind: "install" })}
        >
          {t("plugins.installTitle")}
        </button>
      </div>
      <ul className="m-0 list-none divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white p-0">
        {items.map((it) => {
          const s = status(it);
          const on = !off.has(it.id);
          return (
            <li key={it.id} className="flex items-center gap-3 px-3 py-2.5 md:px-4">
              <Logo id={it.id} />
              <div className="min-w-0 flex-1">
                <p className={`m-0 font-semibold ${on ? "" : "text-slate-500"}`}>{it.name}</p>
                {s && (
                  <p className={`m-0 text-xs ${s.warn ? "text-amber-800" : "text-slate-500"}`}>{s.text}</p>
                )}
              </div>
              <button
                type="button"
                className="btn min-h-9 shrink-0 px-3"
                aria-haspopup="dialog"
                aria-label={t("padmin.configureName", { name: it.name })}
                onClick={() => setOpen({ kind: "plugin", id: it.id })}
              >
                {t("padmin.configure")}
              </button>
              <Switch
                checked={on}
                disabled={busy !== null}
                label={t("padmin.useName", { name: it.name })}
                onChange={(v) => setOn(it.id, v)}
              />
            </li>
          );
        })}
      </ul>

      {shown?.id === ESRI && esri && (
        <EsriImageryConfig
          csrfToken={csrfToken}
          status={esri}
          meta={meta(shown.versions[0]!)}
          onStatus={setEsri}
          onClose={close}
        />
      )}
      {shown?.id === OGC && (
        <MapLayersConfig csrfToken={csrfToken} meta={meta(shown.versions[0]!)} onClose={close} />
      )}
      {shown && shown.id !== ESRI && shown.id !== OGC && (
        <PluginConfig item={shown} csrfToken={csrfToken} meta={meta} onChanged={load} onClose={close} />
      )}
      {open?.kind === "install" && <InstallWindow csrfToken={csrfToken} onInstalled={load} onClose={close} />}
      {open?.kind === "publishers" && (
        <PublishersWindow
          data={data}
          csrfToken={csrfToken}
          actorRole={actorRole}
          onChanged={load}
          onClose={close}
        />
      )}
    </div>
  );
}

/**
 * Configure window of a plugin with no settings of its own: what it does and adds, and for an installed plugin
 * what it may read, its licences and signature, and its versions with a Remove button each.
 */
function PluginConfig({
  item,
  csrfToken,
  meta,
  onChanged,
  onClose,
}: {
  item: Item;
  csrfToken: string;
  meta: (p: PluginRow) => string;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [run, error] = useWindowRun();
  const p = item.versions[0]!;
  const adds = addsLine(p.contributes, t);
  const remove = (v: PluginRow) =>
    void run(async () => {
      const path = `/api/admin/plugins/${encodeURIComponent(v.id)}/${encodeURIComponent(v.version)}`;
      if (v.projects > 0 && !window.confirm(t("plugins.removeConfirm", { name: v.name, count: v.projects })))
        return;
      await send("DELETE", path, csrfToken, { force: v.projects > 0 });
      if (item.versions.length === 1) onClose();
      await onChanged();
    });
  return (
    <PluginWindow
      title={item.name}
      intro={p.description}
      meta={meta(p)}
      error={error}
      links={SERVICES[item.id] ?? []}
      onAccept={async () => true}
      onClose={onClose}
    >
      <div className="flex flex-col gap-1 text-xs text-slate-500">
        {adds && <p className="m-0">{t("plugins.adds", { list: adds })}</p>}
        {p.runsCode && <p className="m-0 font-semibold text-slate-700">{t("pcode.runsCode")}</p>}
        {p.permissions.length > 0 && (
          <p className="m-0">
            {t("plugins.uses", {
              list: p.permissions.map((x) => (PERMISSION_LABELS[x] ? t(PERMISSION_LABELS[x]) : x)).join(", "),
            })}
          </p>
        )}
        {!item.bundled && (
          <p className="m-0">{t("plugins.licences", { code: p.license, data: p.dataLicense })}</p>
        )}
      </div>
      {item.bundled ? (
        <p className="m-0 rounded-lg bg-slate-50 px-3 py-2 text-slate-600">{t("padmin.nothingToSet")}</p>
      ) : (
        <section aria-labelledby="pc-versions" className="flex flex-col gap-1">
          <h3 id="pc-versions" className="caps m-0">
            {t("padmin.versions")}
          </h3>
          <ul className="m-0 flex list-none flex-col p-0">
            {item.versions.map((v) => (
              <li
                key={v.version}
                className="flex items-center gap-2 border-t border-slate-100 py-1.5 first:border-t-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="m-0 font-medium">{t("plugins.versionN", { version: v.version })}</p>
                  <p className="m-0 text-xs text-slate-500">
                    {v.signature?.status === "trusted"
                      ? t("plugins.signedBy", { name: v.signature.signer ?? "" })
                      : t("plugins.unsigned")}
                    {" · "}
                    {t("plugins.inProjects", { count: v.projects })}
                    {v.installedAt && ` · ${formatDateTime(v.installedAt)}`}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn min-h-9 shrink-0 px-3"
                  aria-label={t("plugins.removeOne", { name: v.name, version: v.version })}
                  onClick={() => remove(v)}
                >
                  {t("kit.remove")}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PluginWindow>
  );
}

/** Install a signed `.msplugin` package after seeing what it adds and what it may read. */
function InstallWindow({
  csrfToken,
  onInstalled,
  onClose,
}: {
  csrfToken: string;
  onInstalled: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [run, error] = useWindowRun();
  const [file, setFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
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
      await onInstalled();
      onClose();
    });
  const sigText = (s: Inspection["signature"], signer: string | null) =>
    s === "trusted"
      ? t("plugins.signedBy", { name: signer ?? "" })
      : s === "untrusted"
        ? t("plugins.untrusted")
        : t("plugins.unsigned");
  const p = inspection?.plugin;
  return (
    <Dialog title={t("plugins.installTitle")} onClose={onClose}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="m-0 text-slate-600">{t("pcode.installIntro")}</p>
        <label className="flex flex-col gap-1 font-medium">
          {t("plugins.choose")}
          <input
            type="file"
            accept=".msplugin,application/zip"
            className="font-normal"
            onChange={(e) => choose(e.target.files?.[0] ?? null)}
          />
        </label>
        {inspection && (
          <div className="flex flex-col gap-1 rounded-lg border border-slate-200 p-3">
            {p && (
              <>
                <div className="flex items-center gap-2">
                  <Logo id={p.id} />
                  <span className="font-semibold">{p.name}</span>
                </div>
                <p className="m-0 text-xs text-slate-500">
                  {p.id} · {t("plugins.versionN", { version: p.version })} ·{" "}
                  {t("plugins.by", { publisher: p.publisher.name })}
                </p>
                {p.description && <p className="m-0 text-slate-600">{p.description}</p>}
                <p className="m-0 text-xs text-slate-500">
                  {t("plugins.adds", { list: addsLine(p.contributes, t) })}
                </p>
                {p.runsCode && (
                  <p className="m-0 text-xs font-semibold text-slate-700">{t("pcode.runsCode")}</p>
                )}
                {p.permissions.length > 0 && (
                  <p className="m-0 text-xs text-slate-500">
                    {t("plugins.uses", {
                      list: p.permissions
                        .map((x) => (PERMISSION_LABELS[x] ? t(PERMISSION_LABELS[x]) : x))
                        .join(", "),
                    })}
                  </p>
                )}
                <p className="m-0 text-xs text-slate-500">
                  {t("plugins.licences", { code: p.license, data: p.dataLicense })}
                </p>
              </>
            )}
            <p className="m-0 text-xs">{sigText(inspection.signature, inspection.signer)}</p>
            <p className="m-0 font-mono text-xs break-all text-slate-500">SHA-256 {inspection.sha256}</p>
            {inspection.problems.length > 0 ? (
              <div role="alert" className="rounded bg-red-50 p-2 text-red-800">
                {t("plugins.problems")}
                <ul className="m-0 ps-5">
                  {inspection.problems.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <button type="button" className="btn btn-pri mt-1 self-start" onClick={install}>
                {t("plugins.install")}
              </button>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="m-0 rounded-lg bg-red-50 px-3 py-2 text-red-800">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/** The publisher keys this MobSimLab trusts, the limits of plugin code, and (Owners, development) unsigned plugins. */
function PublishersWindow({
  data,
  csrfToken,
  actorRole,
  onChanged,
  onClose,
}: {
  data: AdminPlugins;
  csrfToken: string;
  actorRole: string;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [run, error] = useWindowRun();
  const [keyName, setKeyName] = useState("");
  const [keyPem, setKeyPem] = useState("");
  const [limits, setLimits] = useState(
    data.limits ? { memoryMb: String(data.limits.memoryMb), timeS: String(data.limits.timeS) } : null,
  );
  const [limitsSaved, setLimitsSaved] = useState(false);
  const addKey = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await send("POST", "/api/admin/plugin-keys", csrfToken, { name: keyName.trim(), publicKey: keyPem });
      setKeyName("");
      setKeyPem("");
      await onChanged();
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
  const heading = (id: string, key: MessageKey) => (
    <h3 id={id} className="m-0 font-semibold">
      {t(key)}
    </h3>
  );
  return (
    <Dialog title={t("padmin.publishers")} onClose={onClose}>
      <div className="flex flex-col gap-5 text-sm">
        <section aria-labelledby="pw-keys" className="flex flex-col gap-2">
          {heading("pw-keys", "plugins.keys")}
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
                  className="btn ms-auto min-h-9 px-3"
                  aria-label={t("plugins.removeKey", { name: k.name })}
                  onClick={() =>
                    void run(async () => {
                      await send("DELETE", `/api/admin/plugin-keys/${k.id}`, csrfToken);
                      await onChanged();
                    })
                  }
                >
                  {t("kit.remove")}
                </button>
              </li>
            ))}
          </ul>
          <form onSubmit={addKey} className="flex flex-col gap-2" aria-label={t("plugins.addKey")}>
            <label className="flex flex-col gap-1 font-medium">
              {t("plugins.keyName")}
              <input
                required
                maxLength={200}
                className="input font-normal"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 font-medium">
              {t("plugins.keyPem")}
              <textarea
                required
                rows={4}
                maxLength={4000}
                placeholder="-----BEGIN PUBLIC KEY-----"
                className="input py-2 font-mono text-xs font-normal"
                value={keyPem}
                onChange={(e) => setKeyPem(e.target.value)}
              />
            </label>
            <button type="submit" className="btn btn-dark self-start">
              {t("plugins.addKey")}
            </button>
          </form>
        </section>
        {limits && (
          <form
            onSubmit={saveLimits}
            className="flex flex-col gap-2 border-t border-slate-200 pt-4"
            aria-labelledby="pw-limits"
          >
            {heading("pw-limits", "pcode.limits")}
            <p className="m-0 text-slate-500">{t("pcode.limitsIntro")}</p>
            <div className="flex flex-wrap gap-3">
              <label className="flex flex-col gap-1 font-medium">
                {t("pcode.memory")}
                <input
                  type="number"
                  required
                  min={16}
                  max={2048}
                  step={1}
                  className="input w-28 font-normal"
                  value={limits.memoryMb}
                  onChange={(e) => setLimits({ ...limits, memoryMb: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1 font-medium">
                {t("pcode.time")}
                <input
                  type="number"
                  required
                  min={1}
                  max={600}
                  step={1}
                  className="input w-28 font-normal"
                  value={limits.timeS}
                  onChange={(e) => setLimits({ ...limits, timeS: e.target.value })}
                />
              </label>
            </div>
            <div className="flex items-center gap-2">
              <button type="submit" className="btn btn-dark">
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
          <label className="flex items-center gap-2 border-t border-slate-200 pt-4">
            <input
              type="checkbox"
              checked={data.allowUnsigned}
              onChange={(e) =>
                void run(async () => {
                  await send("PUT", "/api/admin/plugin-settings", csrfToken, {
                    allowUnsigned: e.target.checked,
                  });
                  await onChanged();
                })
              }
            />
            {t("plugins.allowUnsigned")}
          </label>
        )}
        {error && (
          <p role="alert" className="m-0 rounded-lg bg-red-50 px-3 py-2 text-red-800">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
