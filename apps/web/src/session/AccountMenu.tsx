import type { Me } from "./api";
import { send } from "./api";

/** Sign-in link, or the signed-in user with sign-out (and Administration for Owners and Admins). */
export function AccountMenu({
  me,
  onSignedOut,
  onAdmin,
}: {
  me: Me;
  onSignedOut: () => void;
  onAdmin?: () => void;
}) {
  if (!me.user) {
    if (!me.signInAvailable) return <span className="text-slate-500">Sign-in not configured</span>;
    return (
      <a className="rounded bg-slate-800 px-2 py-1 text-white" href="/api/auth/login">
        Sign in
      </a>
    );
  }
  const signOut = async () => {
    const { endSessionUrl } = await send<{ endSessionUrl: string | null }>(
      "POST",
      "/api/auth/logout",
      me.csrfToken ?? "",
    );
    if (endSessionUrl) window.location.assign(endSessionUrl);
    else onSignedOut();
  };
  return (
    <span className="flex items-center gap-2">
      <span>
        {me.user.displayName ?? me.user.email} <span className="text-slate-500">({me.user.role})</span>
      </span>
      {onAdmin && (me.user.role === "owner" || me.user.role === "admin") && (
        <button type="button" className="rounded border border-slate-300 px-2 py-1" onClick={onAdmin}>
          Administration
        </button>
      )}
      <button
        type="button"
        className="rounded border border-slate-300 px-2 py-1"
        onClick={() => void signOut()}
      >
        Sign out
      </button>
    </span>
  );
}
