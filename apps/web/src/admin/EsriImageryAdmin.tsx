import { type FormEvent, useCallback, useEffect, useState } from "react";
import { formatDateTime, useI18n } from "../i18n/i18n";
import { get, send } from "../session/api";
import { refreshServerBasemaps } from "../map/basemaps";

/** The Esri key's status as `GET /api/admin/basemaps` gives it; the key itself never comes back. */
export interface EsriStatus {
  configured: boolean;
  keyEnd: string | null;
  termsAcceptedAt: string | null;
  termsAcceptedBy: string | null;
  termsUrl: string;
}

/**
 * Esri World Imagery in Administration → Plugins (docs/architecture/06-gis.md §8): an Admin saves the ArcGIS API
 * key after accepting Esri's terms, or removes it. MobSimLab fetches the tiles with it, so browsers never see it.
 */
export function EsriImageryAdmin({
  csrfToken,
  run,
}: {
  csrfToken: string;
  run: (f: () => Promise<unknown>) => Promise<void>;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<EsriStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [accept, setAccept] = useState(false);
  const load = useCallback(
    () => run(async () => setStatus((await get<{ esri: EsriStatus }>("/api/admin/basemaps")).esri)),
    [run],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!status) return null;

  const save = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await send<{ esri: EsriStatus }>("PUT", "/api/admin/basemaps/esri", csrfToken, {
        apiKey: apiKey.trim(),
        acceptTerms: true,
      });
      setStatus(r.esri);
      setApiKey("");
      setAccept(false);
      // Open maps offer Esri World Imagery at once, without a reload.
      void refreshServerBasemaps();
    });
  };
  const remove = () =>
    void run(async () => {
      const r = await send<{ esri: EsriStatus }>("DELETE", "/api/admin/basemaps/esri", csrfToken);
      setStatus(r.esri);
      void refreshServerBasemaps();
    });

  return (
    <section aria-labelledby="ap-esri" className="flex flex-col gap-2">
      <h3 id="ap-esri" className="font-semibold">
        {t("esri.title")}
      </h3>
      <p className="m-0 text-slate-500">{t("esri.intro")}</p>
      {status.configured ? (
        <div className="flex items-center gap-2">
          <p className="m-0" role="status">
            {t("esri.saved", {
              end: status.keyEnd ?? "",
              name: status.termsAcceptedBy ?? "",
              date: status.termsAcceptedAt ? formatDateTime(status.termsAcceptedAt) : "",
            })}
          </p>
          <button type="button" className="ms-auto rounded border border-slate-300 px-2" onClick={remove}>
            {t("esri.remove")}
          </button>
        </div>
      ) : (
        <p className="m-0 text-slate-500">{t("esri.none")}</p>
      )}
      <form onSubmit={save} className="flex flex-col gap-2" aria-label={t("esri.save")}>
        <label className="flex flex-col gap-1">
          {t("esri.key")}
          <input
            type="password"
            required
            minLength={20}
            maxLength={1000}
            autoComplete="off"
            className="rounded border border-slate-300 px-2 py-1 font-mono text-xs"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" required checked={accept} onChange={(e) => setAccept(e.target.checked)} />
          <span>
            {t("esri.accept")} (
            <a href={status.termsUrl} target="_blank" rel="noopener noreferrer" className="underline">
              {t("esri.terms")}
            </a>
            )
          </span>
        </label>
        <button
          type="submit"
          disabled={!accept}
          className="w-28 rounded bg-slate-800 px-2 py-1 text-white disabled:opacity-50"
        >
          {t("esri.save")}
        </button>
      </form>
    </section>
  );
}
