import { useI18n } from "../i18n/i18n";
import type { MessageKey } from "../i18n/messages";
import { GITHUB_URL } from "./about";
import { InfoIcon, LockIcon } from "./icons";
import { LanguageMenu } from "./LanguagePicker";

const REFUSALS = [
  "setup_in_progress",
  "not_bootstrap_owner",
  "pending_approval",
  "account_deleted",
  "expired",
  "invalid_request",
  "provider_error",
] as const;

/** Purpose: the message key for a `/?signin=<reason>` refusal; unknown reasons read as a failed request. */
export function refusalKey(reason: string): MessageKey {
  const r = REFUSALS.find((x) => x === reason) ?? "invalid_request";
  return `signin.${r}` as MessageKey;
}

/**
 * The sign-in page (mockup "Sign in"): one button to the organisation's OpenID Connect provider, the reason a
 * previous sign-in was refused, a note that new accounts may wait for approval, and the language menu.
 */
export function SignIn({
  instanceName,
  available,
  refusal,
  onAbout,
}: {
  instanceName: string;
  available: boolean;
  refusal: string | null;
  onAbout: () => void;
}) {
  const { t } = useI18n();
  const pending = refusal === "pending_approval";
  return (
    <div className="flex h-full overflow-y-auto bg-white">
      <div className="relative hidden flex-1 overflow-hidden bg-slate-900 p-12 text-white md:block">
        <svg
          viewBox="0 0 640 800"
          aria-hidden="true"
          className="absolute inset-0 h-full w-full"
          preserveAspectRatio="xMidYMid slice"
        >
          <g fill="none" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" opacity=".9">
            <path d="M-20 520 H200 L300 420 H660" stroke="#1d4ed8" />
            <path d="M300 -20 V300 L380 380 V820" stroke="#c81e1e" />
            <path d="M-20 300 H120 L240 420 V820" stroke="#c2410c" />
            <path d="M660 600 H460 L380 520" stroke="#0f766e" />
          </g>
          <g fill="#0f172a" stroke="#fff" strokeWidth="5">
            <circle cx="300" cy="420" r="13" />
            <circle cx="240" cy="520" r="11" />
            <circle cx="380" cy="520" r="11" />
            <circle cx="300" cy="300" r="11" />
            <circle cx="120" cy="300" r="11" />
          </g>
        </svg>
        <div className="relative text-xl font-bold">{instanceName}</div>
        <div className="absolute end-12 bottom-12 start-12">
          <p className="max-w-md text-[34px] leading-tight font-bold tracking-tight">{t("signin.tagline")}</p>
          <p className="mt-2.5 text-slate-300">{t("signin.openSource")}</p>
        </div>
      </div>
      <main className="flex w-full flex-col justify-center px-6 py-10 md:w-[560px] md:flex-none md:px-[72px]">
        <div className="mb-8 text-lg font-bold md:hidden">{instanceName}</div>
        <h1 className="text-[28px] font-semibold tracking-tight">{t("signin.title")}</h1>
        <p className="mt-1.5 text-slate-500">{t("signin.subtitle")}</p>
        {refusal && (
          <p
            role="status"
            className={`mt-5 rounded-xl border px-3.5 py-3 text-sm ${pending ? "border-blue-200 bg-blue-50 text-blue-950" : "border-amber-300 bg-amber-50 text-amber-950"}`}
          >
            {t(refusalKey(refusal))}
          </p>
        )}
        {available ? (
          <a href="/api/auth/login" className="btn btn-pri mt-7 min-h-[52px] text-base no-underline">
            <LockIcon />
            {t("signin.continue")}
          </a>
        ) : (
          <p
            role="status"
            className="mt-7 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm"
          >
            {t("signin.notConfigured")}
          </p>
        )}
        {available && <p className="mt-2.5 text-xs text-slate-500">{t("signin.redirectNote")}</p>}
        <div className="mt-7 flex gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3">
          <span className="text-amber-700">
            <InfoIcon />
          </span>
          <p className="text-xs text-amber-950">{t("signin.approvalNote")}</p>
        </div>
        <div className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <button type="button" className="text-slate-700 underline" onClick={onAbout}>
            {t("about.short")}
          </button>
          <a className="text-slate-700 underline" href={`${GITHUB_URL}/blob/main/LICENSE`}>
            {t("about.licenceLink")}
          </a>
          <a className="text-slate-700 underline" href={GITHUB_URL}>
            {t("about.source")}
          </a>
          <span className="flex-1" />
          <LanguageMenu />
        </div>
      </main>
    </div>
  );
}
