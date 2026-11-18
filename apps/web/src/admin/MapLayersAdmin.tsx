import { type FormEvent, useCallback, useEffect, useState } from "react";
import { formatDateTime, useI18n } from "../i18n/i18n";
import type { MessageKey } from "../i18n/messages";
import { refreshServerBasemaps } from "../map/basemaps";
import { get, send } from "../session/api";

type Kind = "wms" | "wmts" | "xyz";
type AuthType = "none" | "basic" | "query" | "header";
type ShowAs = "basemap" | "overlay";

/** A service as `GET /api/admin/map-layers` lists it; its password or key never comes back. */
export interface MapLayerService {
  id: string;
  kind: Kind;
  name: string;
  address: string;
  auth: { type: AuthType; name: string | null };
  showAs: ShowAs;
  attribution: string;
  layers: { id: string; title: string }[];
  addedAt: string;
  addedBy: string | null;
}

/** What `POST /api/admin/map-layers/inspect` reads from a service. */
interface Inspection {
  title: string;
  attribution: string;
  layers: { id: string; title: string; problem?: string }[];
}

const AUTH_LABELS: Record<AuthType, MessageKey> = {
  none: "maplayers.authNone",
  basic: "maplayers.authBasic",
  query: "maplayers.authQuery",
  header: "maplayers.authHeader",
};

/**
 * WMS, WMTS and XYZ map layers in Administration → Plugins (bundled plugin `org.mobsimlab.ogc-layers`): an Admin adds
 * a service with its sign-in details when it needs them, reads its layers and picks those to offer as a basemap
 * or as overlays, or removes a service. MobSimLab fetches the tiles with the sign-in details, so browsers never
 * see them, and the password or key is never shown again.
 */
export function MapLayersAdmin({
  csrfToken,
  run,
}: {
  csrfToken: string;
  run: (f: () => Promise<unknown>) => Promise<void>;
}) {
  const { t } = useI18n();
  const [services, setServices] = useState<MapLayerService[] | null>(null);
  const [kind, setKind] = useState<Kind>("wms");
  const [url, setUrl] = useState("");
  const [authType, setAuthType] = useState<AuthType>("none");
  const [authName, setAuthName] = useState("");
  const [secret, setSecret] = useState("");
  const [found, setFound] = useState<Inspection | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [attribution, setAttribution] = useState("");
  const [showAs, setShowAs] = useState<ShowAs>("basemap");
  const [busy, setBusy] = useState(false);
  /** XYZ tiles: the deepest zoom level the service has. */
  const [maxzoom, setMaxzoom] = useState("18");

  const load = useCallback(
    () =>
      run(async () =>
        setServices((await get<{ services: MapLayerService[] }>("/api/admin/map-layers")).services),
      ),
    [run],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!services) return null;

  const auth = () =>
    authType === "none" ? { type: "none" } : { type: authType, name: authName.trim(), secret };
  // A change to the service or its sign-in means its layers must be read again.
  const changed =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setFound(null);
      setPicked([]);
    };

  const read = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    void run(async () => {
      try {
        const r = await send<Inspection>("POST", "/api/admin/map-layers/inspect", csrfToken, {
          kind,
          url: url.trim(),
          auth: auth(),
          ...(kind === "xyz" ? { maxzoom: Number(maxzoom) } : {}),
        });
        setFound(r);
        const usable = r.layers.filter((l) => !l.problem);
        setPicked(usable.length === 1 ? [usable[0]!.id] : []);
        setName(r.title || (usable[0]?.title ?? ""));
        setAttribution(r.attribution);
      } finally {
        setBusy(false);
      }
    });
  };

  const save = () => {
    setBusy(true);
    void run(async () => {
      try {
        const r = await send<{ services: MapLayerService[] }>("POST", "/api/admin/map-layers", csrfToken, {
          kind,
          url: url.trim(),
          auth: auth(),
          name: name.trim(),
          attribution: attribution.trim(),
          showAs,
          layers: picked,
          ...(kind === "xyz" ? { maxzoom: Number(maxzoom) } : {}),
        });
        setServices(r.services);
        setUrl("");
        setAuthType("none");
        setAuthName("");
        setSecret("");
        setFound(null);
        setPicked([]);
        // Open maps offer the new layers at once, without a reload.
        void refreshServerBasemaps();
      } finally {
        setBusy(false);
      }
    });
  };

  const remove = (id: string) =>
    void run(async () => {
      const r = await send<{ services: MapLayerService[] }>(
        "DELETE",
        `/api/admin/map-layers/${id}`,
        csrfToken,
      );
      setServices(r.services);
      void refreshServerBasemaps();
    });

  const input = "rounded border border-slate-300 px-2 py-1";
  return (
    <section aria-labelledby="ap-maplayers" className="flex flex-col gap-2">
      <h3 id="ap-maplayers" className="font-semibold">
        {t("maplayers.title")}
      </h3>
      <p className="m-0 text-slate-500">{t("maplayers.intro")}</p>
      {services.length === 0 ? (
        <p className="m-0 text-slate-500">{t("maplayers.none")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {services.map((s) => (
            <li key={s.id} className="flex items-start gap-2 rounded border border-slate-200 p-2">
              <div className="min-w-0 flex-1">
                <p className="m-0 font-medium">
                  {s.name} <span className="tag bg-sky-100 text-sky-900">{s.kind.toUpperCase()}</span>{" "}
                  <span className="tag bg-slate-100 text-slate-700">
                    {t(s.showAs === "basemap" ? "maplayers.asBasemap" : "maplayers.asOverlay")}
                  </span>
                </p>
                <p className="m-0 truncate font-mono text-xs text-slate-500">{s.address}</p>
                <p className="m-0 text-xs text-slate-500">
                  {t("maplayers.layers", { list: s.layers.map((l) => l.title).join(", ") })}
                </p>
                <p className="m-0 text-xs text-slate-500">
                  {t(AUTH_LABELS[s.auth.type])}
                  {s.auth.name ? ` (${s.auth.name})` : ""} ·{" "}
                  {t("maplayers.addedBy", { name: s.addedBy ?? "", date: formatDateTime(s.addedAt) })}
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded border border-slate-300 px-2"
                aria-label={t("maplayers.removeName", { name: s.name })}
                onClick={() => remove(s.id)}
              >
                {t("maplayers.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={read} className="flex flex-col gap-2" aria-label={t("maplayers.add")}>
        <h4 className="m-0 mt-2 font-semibold">{t("maplayers.add")}</h4>
        <div className="flex flex-wrap gap-2">
          <label className="flex flex-col gap-1">
            {t("maplayers.kind")}
            <select className={input} value={kind} onChange={(e) => changed(setKind)(e.target.value as Kind)}>
              <option value="wms">WMS</option>
              <option value="wmts">WMTS</option>
              <option value="xyz">{t("maplayers.xyz")}</option>
            </select>
          </label>
          <label className="flex min-w-60 flex-1 flex-col gap-1">
            {t("maplayers.url")}
            <input
              type="url"
              required
              maxLength={2000}
              placeholder={kind === "xyz" ? "https://tile.example.org/{z}/{x}/{y}.png" : "https://"}
              autoComplete="off"
              className={`${input} font-mono text-xs`}
              value={url}
              onChange={(e) => changed(setUrl)(e.target.value)}
            />
          </label>
          {kind === "xyz" && (
            <label className="flex flex-col gap-1">
              {t("maplayers.maxzoom")}
              <input
                type="number"
                required
                min={0}
                max={22}
                step={1}
                className={`${input} w-24`}
                value={maxzoom}
                onChange={(e) => changed(setMaxzoom)(e.target.value)}
              />
            </label>
          )}
        </div>
        {kind === "xyz" && <p className="m-0 text-xs text-slate-500">{t("maplayers.xyzNote")}</p>}
        <label className="flex flex-col gap-1">
          {t("maplayers.auth")}
          <select
            className={input}
            value={authType}
            onChange={(e) => changed(setAuthType)(e.target.value as AuthType)}
          >
            {(Object.keys(AUTH_LABELS) as AuthType[]).map((a) => (
              <option key={a} value={a}>
                {t(AUTH_LABELS[a])}
              </option>
            ))}
          </select>
        </label>
        {authType !== "none" && (
          <div className="flex flex-wrap gap-2">
            <label className="flex flex-1 flex-col gap-1">
              {t(
                authType === "basic"
                  ? "maplayers.user"
                  : authType === "query"
                    ? "maplayers.param"
                    : "maplayers.header",
              )}
              <input
                type="text"
                required
                maxLength={200}
                autoComplete="off"
                placeholder={authType === "query" ? "token" : authType === "header" ? "X-API-Key" : ""}
                className={input}
                value={authName}
                onChange={(e) => changed(setAuthName)(e.target.value)}
              />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              {t(authType === "basic" ? "maplayers.password" : "maplayers.key")}
              <input
                type="password"
                required
                maxLength={2000}
                autoComplete="new-password"
                className={`${input} font-mono text-xs`}
                value={secret}
                onChange={(e) => changed(setSecret)(e.target.value)}
              />
            </label>
            <p className="m-0 w-full text-xs text-slate-500">{t("maplayers.secretNote")}</p>
          </div>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-36 rounded bg-slate-800 px-2 py-1 text-white disabled:opacity-50"
        >
          {busy && !found ? t("maplayers.reading") : t(kind === "xyz" ? "maplayers.check" : "maplayers.read")}
        </button>
      </form>
      {found && (
        <div className="flex flex-col gap-2 rounded border border-slate-200 p-2">
          <fieldset className="flex flex-col gap-1">
            <legend className="font-medium">{t("maplayers.pick")}</legend>
            {found.layers.every((l) => l.problem) && (
              <p role="alert" className="m-0 text-amber-800">
                {t("maplayers.noUsable")}
              </p>
            )}
            <div className="flex max-h-60 flex-col gap-1 overflow-y-auto">
              {found.layers.map((l) => (
                <label key={l.id} className={`flex items-start gap-2 ${l.problem ? "text-slate-400" : ""}`}>
                  <input
                    type="checkbox"
                    className="mt-1"
                    disabled={Boolean(l.problem) || (!picked.includes(l.id) && picked.length >= 20)}
                    checked={picked.includes(l.id)}
                    onChange={(e) =>
                      setPicked((p) => (e.target.checked ? [...p, l.id] : p.filter((x) => x !== l.id)))
                    }
                  />
                  <span className="min-w-0">
                    {l.title} <span className="font-mono text-xs">{l.id !== l.title ? l.id : ""}</span>
                    {l.problem && <span className="block text-xs">{l.problem}</span>}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex flex-col gap-1">
            {t("maplayers.name")}
            <input
              type="text"
              required
              maxLength={100}
              className={input}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            {t("maplayers.attribution")}
            <input
              type="text"
              required
              maxLength={300}
              className={input}
              value={attribution}
              onChange={(e) => setAttribution(e.target.value)}
            />
          </label>
          <fieldset className="flex flex-wrap items-center gap-3">
            <legend className="mb-1">{t("maplayers.showAs")}</legend>
            {(["basemap", "overlay"] as const).map((v) => (
              <label key={v} className="flex items-center gap-1">
                <input type="radio" name="ogc-show-as" checked={showAs === v} onChange={() => setShowAs(v)} />
                {t(v === "basemap" ? "maplayers.asBasemap" : "maplayers.asOverlay")}
              </label>
            ))}
          </fieldset>
          <p className="m-0 text-xs text-slate-500">
            {t(showAs === "basemap" ? "maplayers.basemapNote" : "maplayers.overlayNote")}
          </p>
          <button
            type="button"
            disabled={busy || picked.length === 0 || !name.trim() || !attribution.trim()}
            className="w-36 rounded bg-slate-800 px-2 py-1 text-white disabled:opacity-50"
            onClick={save}
          >
            {t("maplayers.save")}
          </button>
        </div>
      )}
    </section>
  );
}
