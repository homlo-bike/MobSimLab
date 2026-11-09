import { useState } from "react";
import { LANGUAGES, useI18n } from "../i18n/i18n";
import type { MessageKey } from "../i18n/messages";
import type { Me, Preferences } from "../session/api";
import { Dialog } from "./Dialog";
import { BackIcon } from "./icons";
import { LanguageList } from "./LanguagePicker";
import type { SettingsSection } from "./UserMenu";

/** An on/off switch with a visible label. */
function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-13 cursor-pointer items-center gap-3 border-b border-slate-200 bg-white px-4 last:border-b-0">
      <span className="flex-1">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(!on)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? "bg-blue-700" : "bg-slate-300"}`}
      >
        <span
          className={`absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white shadow transition-all ${on ? "start-[23px]" : "start-[3px]"}`}
        />
      </button>
    </label>
  );
}

/**
 * User settings and app settings (mockup "User and app settings"). Language opens the full picker. Changes save
 * to the account straight away, so they follow the person to other devices.
 */
export function SettingsDialog({
  me,
  section,
  preferences,
  onChange,
  onClose,
}: {
  me: Me;
  section: SettingsSection;
  preferences: Preferences;
  onChange: (patch: Preferences) => void;
  onClose: () => void;
}) {
  const { t, choice, language } = useI18n();
  const [tab, setTab] = useState<SettingsSection>(section);
  const [picking, setPicking] = useState(false);
  const user = me.user;
  if (!user) return null;
  const languageName = LANGUAGES.find((l) => l.tag === language)?.native ?? language;
  const group = "overflow-hidden rounded-xl border border-slate-200";
  const row = "flex min-h-13 items-center gap-3 border-b border-slate-200 bg-white px-4 last:border-b-0";

  if (picking)
    return (
      <Dialog title={t("language.title")} onClose={onClose}>
        <button type="button" className="btn btn-ghost -ms-2 mb-3" onClick={() => setPicking(false)}>
          <BackIcon size={18} />
          {t("settings.back")}
        </button>
        <LanguageList />
      </Dialog>
    );

  return (
    <Dialog title={t("settings.title")} onClose={onClose}>
      <div className="seg mb-4" role="tablist" aria-label={t("settings.title")}>
        <button type="button" role="tab" aria-selected={tab === "user"} onClick={() => setTab("user")}>
          {t("user.userSettings")}
        </button>
        <button type="button" role="tab" aria-selected={tab === "app"} onClick={() => setTab("app")}>
          {t("user.appSettings")}
        </button>
      </div>
      {tab === "user" ? (
        <div role="tabpanel" aria-label={t("user.userSettings")}>
          <div className={group}>
            <div className={row}>
              <span className="flex-1">{t("settings.displayName")}</span>
              <span className="truncate text-slate-500">{user.displayName ?? "—"}</span>
            </div>
            <div className={row}>
              <span className="flex-1">{t("settings.email")}</span>
              <span className="truncate text-slate-500">{user.email ?? "—"}</span>
            </div>
            <div className={row}>
              <span className="flex-1">{t("settings.role")}</span>
              <span className="text-slate-500">{t(`role.${user.role}` as MessageKey)}</span>
            </div>
            <button
              type="button"
              className={`${row} w-full text-start hover:bg-slate-50`}
              onClick={() => setPicking(true)}
            >
              <span className="flex-1">{t("settings.language")}</span>
              <span className="text-slate-500">
                {choice === "system" ? t("language.fromDevice", { language: languageName }) : languageName}
              </span>
              <span aria-hidden="true" className="text-slate-400">
                ›
              </span>
            </button>
          </div>
          <p className="mx-4 mt-2 text-xs text-slate-500">{t("settings.fromProvider")}</p>
        </div>
      ) : (
        <div role="tabpanel" aria-label={t("user.appSettings")}>
          <div className={group}>
            <Toggle
              label={t("settings.largerTargets")}
              on={Boolean(preferences.largerTargets)}
              onChange={(v) => onChange({ largerTargets: v })}
            />
            <Toggle
              label={t("settings.reduceMotion")}
              on={Boolean(preferences.reduceMotion)}
              onChange={(v) => onChange({ reduceMotion: v })}
            />
            <Toggle
              label={t("settings.existingRailways")}
              on={Boolean(preferences.existingRailways)}
              onChange={(v) => onChange({ existingRailways: v })}
            />
          </div>
          <p className="mx-4 mt-2 text-xs text-slate-500">{t("settings.savedToAccount")}</p>
        </div>
      )}
    </Dialog>
  );
}
