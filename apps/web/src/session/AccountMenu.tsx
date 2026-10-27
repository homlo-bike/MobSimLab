import type { Me } from "./api";
import { send } from "./api";

/** Sign-in link, or the signed-in user with a sign-out button. */
export function AccountMenu({ me, onSignedOut }: { me: Me; onSignedOut: () => void }) {
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
