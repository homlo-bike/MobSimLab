import { useState } from "react";
import { browserLanguages, LANGUAGES, type LanguageChoice, resolveLanguage, useI18n } from "../i18n/i18n";
import { ChevronDownIcon, GlobeIcon, SearchIcon } from "./icons";
import { anchorOf, Popover } from "./Popover";

const nativeName = (tag: string) => LANGUAGES.find((l) => l.tag === tag)?.native ?? tag;

/**
 * Compact language menu for the sign-in page: shows the current language and whether it comes from the
 * browser, and lists "Same as this device" plus each language.
 */
export function LanguageMenu() {
  const { t, choice, language, choose } = useI18n();
  const [at, setAt] = useState<ReturnType<typeof anchorOf> | null>(null);
  const pick = (c: LanguageChoice) => {
    choose(c);
    setAt(null);
  };
  return (
    <>
      <button
        type="button"
        className="btn btn-ghost min-h-9 text-slate-700"
        aria-haspopup="menu"
        aria-expanded={Boolean(at)}
        onClick={(e) => setAt(at ? null : anchorOf(e.currentTarget))}
      >
        <GlobeIcon size={18} />
        {choice === "system"
          ? t("language.fromDevice", { language: nativeName(language) })
          : nativeName(language)}
        <ChevronDownIcon size={16} />
      </button>
      {at && (
        <Popover at={at} align="right" label={t("language.title")} onClose={() => setAt(null)}>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={choice === "system"}
            className="menu-item"
            onClick={() => pick("system")}
          >
            {t("language.sameAsDevice")}
          </button>
          <hr className="my-1.5 border-slate-200" />
          {LANGUAGES.map((l) => (
            <button
              key={l.tag}
              type="button"
              role="menuitemradio"
              aria-checked={choice === l.tag}
              lang={l.tag}
              className="menu-item"
              onClick={() => pick(l.tag)}
            >
              {l.native}
            </button>
          ))}
        </Popover>
      )}
    </>
  );
}

/**
 * Full language list for Settings (mockup "Language picker"): "Same as this device" first, then each language
 * with its English name, filtered by a search box.
 */
export function LanguageList({ onPick }: { onPick?: (c: LanguageChoice) => void }) {
  const { t, choice, choose } = useI18n();
  const [q, setQ] = useState("");
  const device = resolveLanguage("system", browserLanguages());
  const pick = (c: LanguageChoice) => {
    choose(c);
    onPick?.(c);
  };
  const needle = q.trim().toLowerCase();
  const shown = LANGUAGES.filter(
    (l) =>
      !needle ||
      l.native.toLowerCase().includes(needle) ||
      l.english.toLowerCase().includes(needle) ||
      l.tag === needle,
  );
  const row = (on: boolean) =>
    `flex min-h-14 w-full items-center gap-3 border-b border-slate-200 bg-white px-4 text-left last:border-b-0 hover:bg-slate-50 ${on ? "font-semibold" : ""}`;
  const radio = (on: boolean) =>
    `h-[22px] w-[22px] shrink-0 rounded-full ${on ? "border-[7px] border-blue-700" : "border-2 border-slate-400"}`;
  return (
    <div>
      <label className="field">
        <SearchIcon size={18} />
        <input
          aria-label={t("language.search")}
          placeholder={t("language.search")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      <div
        role="radiogroup"
        aria-label={t("language.title")}
        className="mt-3.5 overflow-hidden rounded-xl border border-slate-200"
      >
        <button
          type="button"
          role="radio"
          aria-checked={choice === "system"}
          className={row(choice === "system")}
          onClick={() => pick("system")}
        >
          <span className={radio(choice === "system")} />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{t("language.sameAsDevice")}</span>
            <span className="block text-[13px] font-normal text-slate-500">
              {t("language.rightNow", { language: nativeName(device) })}
            </span>
          </span>
        </button>
      </div>
      <p className="mx-4 mt-2 text-xs text-slate-500">{t("language.systemNote")}</p>
      <div className="caps mx-4 mt-5 mb-1.5">{t("language.orAlways")}</div>
      <div
        role="radiogroup"
        aria-label={t("language.fixed")}
        className="overflow-hidden rounded-xl border border-slate-200"
      >
        {shown.map((l) => (
          <button
            key={l.tag}
            type="button"
            role="radio"
            aria-checked={choice === l.tag}
            className={row(choice === l.tag)}
            onClick={() => pick(l.tag)}
          >
            <span className={radio(choice === l.tag)} />
            <span className="min-w-0 flex-1">
              <span lang={l.tag} className="block font-medium">
                {l.native}
              </span>
              {l.native !== l.english && (
                <span className="block text-[13px] font-normal text-slate-500">{l.english}</span>
              )}
            </span>
          </button>
        ))}
        {shown.length === 0 && <p className="px-4 py-3 text-sm text-slate-500">{t("language.none")}</p>}
      </div>
      <p className="mx-4 mt-2.5 text-xs text-slate-500">{t("language.savedNote")}</p>
    </div>
  );
}
