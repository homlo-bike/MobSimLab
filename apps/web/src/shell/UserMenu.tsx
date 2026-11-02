import { useState } from "react";
import { useI18n } from "../i18n/i18n";
import type { MessageKey } from "../i18n/messages";
import { type Me, send } from "../session/api";
import { AgentIcon, ShieldIcon, SlidersIcon, UserIcon } from "./icons";
import { anchorOf, Popover } from "./Popover";

/** Purpose: two initials for an avatar, from the display name or e-mail. */
export function initials(name: string | null | undefined): string {
  const words = (name ?? "")
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  const letters =
    words.length > 1 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

export type SettingsSection = "user" | "app";

/**
 * The account button and its menu: user settings, app settings, connected agents, admin settings (Owners and
 * Admins only) and sign out.
 */
export function UserMenu({
  me,
  onSettings,
  onAgents,
  onAdmin,
  onSignedOut,
}: {
  me: Me;
  onSettings: (s: SettingsSection) => void;
  onAgents: () => void;
  onAdmin: () => void;
  onSignedOut: () => void;
}) {
  const { t } = useI18n();
  const [at, setAt] = useState<ReturnType<typeof anchorOf> | null>(null);
  const user = me.user;
  if (!user) return null;
  const name = user.displayName ?? user.email ?? "";
  const admin = user.role === "owner" || user.role === "admin";
  const agents = user.role === "owner" || user.role === "admin" || user.role === "user";
  const run = (f: () => void) => () => {
    setAt(null);
    f();
  };
  const signOut = async () => {
    const { endSessionUrl } = await send<{ endSessionUrl: string | null }>(
      "POST",
      "/api/auth/logout",
      me.csrfToken ?? "",
    );
    if (endSessionUrl) window.location.assign(endSessionUrl);
    else onSignedOut();
  };
  const sub = "block text-xs font-normal text-slate-500";
  return (
    <>
      <button
        type="button"
        className="avatar h-10 w-10 hover:ring-2 hover:ring-blue-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        aria-label={t("user.menu")}
        aria-haspopup="menu"
        aria-expanded={Boolean(at)}
        onClick={(e) => setAt(at ? null : anchorOf(e.currentTarget))}
      >
        {initials(name)}
      </button>
      {at && (
        <Popover at={at} align="right" label={t("user.menu")} onClose={() => setAt(null)}>
          <div className="flex items-center gap-3 border-b border-slate-200 px-3 pt-2 pb-3">
            <span className="avatar h-11 w-11">{initials(name)}</span>
            <div className="min-w-0">
              <div className="truncate font-semibold">{name}</div>
              <div className="truncate text-xs text-slate-500">
                {user.email && user.email !== name ? `${user.email} · ` : ""}
                {t(`role.${user.role}` as MessageKey)}
              </div>
            </div>
          </div>
          <div className="caps px-3 pt-3 pb-1">{t("user.you")}</div>
          <button type="button" role="menuitem" className="menu-item" onClick={run(() => onSettings("user"))}>
            <UserIcon />
            <span>
              {t("user.userSettings")}
              <span className={sub}>{t("user.userSettingsHint")}</span>
            </span>
          </button>
          <button type="button" role="menuitem" className="menu-item" onClick={run(() => onSettings("app"))}>
            <SlidersIcon />
            <span>
              {t("user.appSettings")}
              <span className={sub}>{t("user.appSettingsHint")}</span>
            </span>
          </button>
          {agents && (
            <button type="button" role="menuitem" className="menu-item" onClick={run(onAgents)}>
              <AgentIcon />
              {t("user.agents")}
            </button>
          )}
          {admin && (
            <>
              <div className="caps px-3 pt-3 pb-1">{t("user.administration")}</div>
              <button type="button" role="menuitem" className="menu-item" onClick={run(onAdmin)}>
                <ShieldIcon />
                <span>
                  {t("user.adminSettings")}
                  <span className={sub}>{t("user.adminSettingsHint")}</span>
                </span>
              </button>
            </>
          )}
          <hr className="my-1.5 border-slate-200" />
          <button
            type="button"
            role="menuitem"
            className="menu-item text-red-700"
            onClick={run(() => void signOut())}
          >
            {t("user.signOut")}
          </button>
        </Popover>
      )}
    </>
  );
}
