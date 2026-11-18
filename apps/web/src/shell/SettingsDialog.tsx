import { type FormEvent, useState } from "react";
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
  // The desktop app on this computer can connect to a MobSimLab server instead (such as one in Docker).
  const local = Boolean(me.instance.local);
  const shown: SettingsSection = tab === "server" && !local ? "app" : tab;
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
        <button type="button" role="tab" aria-selected={shown === "user"} onClick={() => setTab("user")}>
          {t("user.userSettings")}
        </button>
        <button type="button" role="tab" aria-selected={shown === "app"} onClick={() => setTab("app")}>
          {t("user.appSettings")}
        </button>
        {local && (
          <button
            type="button"
            role="tab"
            aria-selected={shown === "server"}
            onClick={() => setTab("server")}
          >
            {t("settings.serverTab")}
          </button>
        )}
      </div>
      {shown === "server" ? (
        <ServerSettings />
      ) : shown === "user" ? (
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
          <div className={`${group} mb-4`}>
            <div className={`${row} flex-wrap py-2`}>
              <span className="flex-1" id="settings-theme">
                {t("settings.theme")}
              </span>
              <div className="seg min-w-60" role="radiogroup" aria-labelledby="settings-theme">
                {(["auto", "light", "dark"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={(preferences.theme ?? "auto") === v}
                    onClick={() => onChange({ theme: v })}
                  >
                    {t(`settings.theme.${v}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>
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

/** Address the desktop app answers: it checks the server and asks the person before it switches (desktop/). */
export const DESKTOP_CONNECT_URL = "mobsimlab-desktop://connect";

/**
 * Purpose: the Server tab of the desktop app on this computer: connect the app to a MobSimLab server that runs in
 * the background (for example the Docker setup) instead of the one built into the app.
 * Side effects: hands the address to the desktop app, which checks it and asks before switching.
 */
function ServerSettings() {
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  const connect = (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    // The desktop app catches this address (it opens no window): see desktop/src/main.ts.
    window.open(`${DESKTOP_CONNECT_URL}?server=${encodeURIComponent(url.trim())}`, "_blank");
  };
  return (
    <div role="tabpanel" aria-label={t("settings.serverTab")}>
      <p className="text-slate-700">{t("settings.server.local")}</p>
      <form className="mt-4 flex flex-col gap-2" onSubmit={connect}>
        <label className="text-sm font-medium" htmlFor="settings-server-url">
          {t("settings.server.address")}
        </label>
        <div className="flex flex-wrap gap-2">
          <span className="field min-w-56 flex-1">
            <input
              id="settings-server-url"
              type="url"
              inputMode="url"
              autoComplete="url"
              placeholder="http://localhost:8080"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </span>
          <button type="submit" className="btn btn-pri" disabled={!url.trim()}>
            {t("settings.server.connect")}
          </button>
        </div>
      </form>
      <p className="mt-3 text-xs text-slate-500">{t("settings.server.note")}</p>
    </div>
  );
}
