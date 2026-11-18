import { useState } from "react";
import { formatDateTime, useI18n } from "../i18n/i18n";
import { refreshServerBasemaps } from "../map/basemaps";
import { send } from "../session/api";
import { PluginWindow, type ServiceLink, useWindowRun } from "./PluginWindow";

/** The Esri key's status as `GET /api/admin/basemaps` gives it; the key itself never comes back. */
export interface EsriStatus {
  configured: boolean;
  keyEnd: string | null;
  termsAcceptedAt: string | null;
  termsAcceptedBy: string | null;
  termsUrl: string;
}

/** Purpose: the outside services Esri World Imagery uses, with Esri's terms. */
export const esriLinks = (status: EsriStatus): ServiceLink[] => [
  {
    label: "Esri World Imagery",
    url: "https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9",
  },
  { label: "ArcGIS Location Platform", url: "https://location.arcgis.com" },
  { label: "Esri terms of use", url: status.termsUrl },
];

/**
 * Configure window of Esri World Imagery in Administration → Plugins (docs/architecture/06-gis.md §8): an Admin
 * saves the ArcGIS API key after accepting Esri's terms, or removes it, and accepts the change. MobSimLab fetches
 * the tiles with it, so browsers never see it; only its last four characters are shown.
 */
export function EsriImageryConfig({
  csrfToken,
  status,
  meta,
  onStatus,
  onClose,
}: {
  csrfToken: string;
  status: EsriStatus;
  meta: string;
  onStatus: (s: EsriStatus) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [run, error] = useWindowRun();
  const [apiKey, setApiKey] = useState("");
  const [accept, setAccept] = useState(false);
  const [removeKey, setRemoveKey] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      return await run(async () => {
        let next: EsriStatus | null = null;
        if (apiKey.trim()) {
          if (!accept) throw new Error(t("padmin.esriTermsFirst"));
          next = (
            await send<{ esri: EsriStatus }>("PUT", "/api/admin/basemaps/esri", csrfToken, {
              apiKey: apiKey.trim(),
              acceptTerms: true,
            })
          ).esri;
        } else if (removeKey && status.configured) {
          next = (await send<{ esri: EsriStatus }>("DELETE", "/api/admin/basemaps/esri", csrfToken)).esri;
        }
        if (next) {
          onStatus(next);
          // Open maps offer Esri World Imagery, or stop offering it, at once without a reload.
          void refreshServerBasemaps();
        }
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <PluginWindow
      title={t("esri.title")}
      intro={t("esri.intro")}
      meta={meta}
      error={error}
      busy={busy}
      links={esriLinks(status)}
      onAccept={save}
      onClose={onClose}
    >
      <div className="flex flex-col gap-3">
        {status.configured ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
            <p
              className={`m-0 min-w-0 flex-1 ${removeKey ? "text-slate-400 line-through" : ""}`}
              role="status"
            >
              {t("esri.saved", {
                end: status.keyEnd ?? "",
                name: status.termsAcceptedBy ?? "",
                date: status.termsAcceptedAt ? formatDateTime(status.termsAcceptedAt) : "",
              })}
            </p>
            <button
              type="button"
              className="btn min-h-9 px-3"
              aria-pressed={removeKey}
              onClick={() => setRemoveKey((r) => !r)}
            >
              {removeKey ? t("padmin.undo") : t("esri.remove")}
            </button>
            {removeKey && <p className="m-0 w-full text-xs text-amber-800">{t("padmin.removedOnAccept")}</p>}
          </div>
        ) : (
          <p className="m-0 text-slate-500">{t("esri.none")}</p>
        )}
        <label className="flex flex-col gap-1 font-medium">
          {t("esri.key")}
          <input
            type="password"
            minLength={20}
            maxLength={1000}
            autoComplete="off"
            spellCheck={false}
            placeholder={status.configured ? t("padmin.keyReplace") : ""}
            className="input w-full font-mono text-xs font-normal"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              if (e.target.value) setRemoveKey(false);
            }}
          />
        </label>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={accept}
            onChange={(e) => setAccept(e.target.checked)}
          />
          <span>
            {t("esri.accept")} (
            <a
              href={status.termsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-700 underline"
            >
              {t("esri.terms")}
            </a>
            )
          </span>
        </label>
      </div>
    </PluginWindow>
  );
}
