import { useState } from "react";
import { useI18n } from "../i18n/i18n";
import {
  APP_BUILD,
  APP_VERSION,
  COMPONENTS,
  DOCS_URL,
  GITHUB_URL,
  ISSUES_URL,
  LICENCE_URL,
  SECURITY_URL,
} from "./about";
import { Dialog } from "./Dialog";
import { DocIcon, GithubIcon, InfoIcon, ShieldIcon } from "./icons";

/** The About (!) dialog: version, licence, this instance, map data, links, and open-source components. */
export function AboutDialog({ instanceName, onClose }: { instanceName: string; onClose: () => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const info = `MobSimLab ${APP_VERSION} (build ${APP_BUILD}) · ${instanceName} · ${navigator.userAgent}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(info);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const row =
    "grid min-h-10 grid-cols-[120px_1fr] items-center gap-2 border-b border-slate-200 py-1.5 md:grid-cols-[140px_1fr]";
  const link =
    "flex min-h-12 items-center gap-2.5 rounded-[10px] border border-slate-200 px-3 font-medium text-slate-900 no-underline hover:bg-slate-50";
  return (
    <Dialog
      title={t("about.title")}
      subtitle={t("about.subtitle")}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn mr-auto" onClick={() => void copy()}>
            {copied ? t("about.copied") : t("about.copy")}
          </button>
          <button type="button" className="btn btn-dark" onClick={onClose}>
            {t("common.close")}
          </button>
        </>
      }
    >
      <dl className="m-0">
        <div className={row}>
          <dt className="text-slate-500">{t("about.version")}</dt>
          <dd className="m-0 tabular-nums">
            {APP_VERSION} <span className="text-xs text-slate-500">· build {APP_BUILD}</span>
          </dd>
        </div>
        <div className={row}>
          <dt className="text-slate-500">{t("about.licence")}</dt>
          <dd className="m-0">
            <a href={LICENCE_URL} className="text-blue-700 underline">
              GNU AGPL-3.0-or-later
            </a>
          </dd>
        </div>
        <div className={row}>
          <dt className="text-slate-500">{t("about.instance")}</dt>
          <dd className="m-0">{instanceName}</dd>
        </div>
        <div className={row}>
          <dt className="text-slate-500">{t("about.mapData")}</dt>
          <dd className="m-0">© OpenStreetMap contributors (ODbL)</dd>
        </div>
      </dl>
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <a className={link} href={GITHUB_URL} target="_blank" rel="noreferrer">
          <GithubIcon />
          {t("about.source")}
        </a>
        <a className={link} href={DOCS_URL} target="_blank" rel="noreferrer">
          <DocIcon />
          {t("about.docs")}
        </a>
        <a className={link} href={ISSUES_URL} target="_blank" rel="noreferrer">
          <InfoIcon />
          {t("about.report")}
        </a>
        <a className={link} href={SECURITY_URL} target="_blank" rel="noreferrer">
          <ShieldIcon />
          {t("about.security")}
        </a>
      </div>
      <div className="caps mt-5 mb-2">{t("about.components")}</div>
      <p className="text-xs leading-relaxed text-slate-700">
        {COMPONENTS.map(([n, l]) => `${n} (${l})`).join(" · ")} · {t("about.andOthers")}
      </p>
    </Dialog>
  );
}
