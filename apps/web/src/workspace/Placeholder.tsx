import type { ReactNode } from "react";
import { useI18n } from "../i18n/i18n";
import type { MessageKey } from "../i18n/messages";

/**
 * A tab or panel section whose tools are not built yet: says what it will hold, so the structure is visible and
 * nobody mistakes it for a broken page.
 */
export function Placeholder({
  title,
  intro,
  items,
  children,
  page = false,
}: {
  title: MessageKey;
  intro: MessageKey;
  items: MessageKey[];
  children?: ReactNode;
  page?: boolean;
}) {
  const { t } = useI18n();
  const body = (
    <section aria-label={t(title)} className={page ? "mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12" : ""}>
      <h2 className={page ? "text-2xl font-semibold tracking-tight" : "text-lg font-semibold"}>{t(title)}</h2>
      <p className="mt-1 text-slate-600">{t(intro)}</p>
      <p className="tag mt-3 bg-amber-100 text-amber-900">{t("placeholder.comingSoon")}</p>
      <ul className={`mt-4 grid list-none gap-2 p-0 ${page ? "sm:grid-cols-2" : ""}`}>
        {items.map((k) => (
          <li
            key={k}
            className="rounded-xl border border-dashed border-slate-300 bg-white px-3.5 py-3 text-sm text-slate-700"
          >
            {t(k)}
          </li>
        ))}
      </ul>
      {children}
    </section>
  );
  return page ? <div className="h-full overflow-y-auto bg-slate-50">{body}</div> : body;
}
