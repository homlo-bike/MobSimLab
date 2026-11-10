import { useEffect, useState } from "react";
import { useI18n, withNodes } from "../i18n/i18n";
import { get, type Me, send } from "../session/api";

interface Details {
  client: { name: string; uri: string | null; redirectHost: string; verified: boolean };
  scopes: { id: string; label: string }[];
  allowed: boolean;
  reason: string | null;
}

/**
 * Consent screen of an agent connection (ADR-0035 §2), at `/agents/consent?request=…`. The AI app sent the
 * person here; approving returns them to the app with an authorization code. People who are not signed in
 * sign in first and come back here.
 */
export function ConsentPage({ me }: { me: Me | null }) {
  const { t } = useI18n();
  const request = new URLSearchParams(window.location.search).get("request") ?? "";
  const [d, setD] = useState<Details | null>(null);
  const [kept, setKept] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signedIn = Boolean(me?.user);

  useEffect(() => {
    if (!signedIn || !request) return;
    get<Details>(`/api/agents/consent/${encodeURIComponent(request)}`).then(
      (x) => {
        setD(x);
        setKept(x.scopes.map((s) => s.id));
      },
      (e: Error) => setError(e.message),
    );
  }, [signedIn, request]);

  const answer = async (approve: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r = await send<{ redirect: string }>(
        "POST",
        `/api/agents/consent/${encodeURIComponent(request)}`,
        me?.csrfToken ?? "",
        { approve, scopes: kept },
      );
      window.location.assign(r.redirect);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const back = `${window.location.pathname}${window.location.search}`;
  return (
    <section
      aria-label={t("consent.title")}
      className="mx-auto mt-10 w-full max-w-lg rounded border border-slate-300 bg-white p-6 text-sm shadow"
    >
      <h1 className="mb-3 text-lg font-semibold">{t("consent.title")}</h1>
      {!request && <p>{t("consent.incomplete")}</p>}
      {request && !signedIn && (
        <p>
          {t("consent.signInFirst")}{" "}
          <a
            className="rounded bg-slate-800 px-2 py-1 text-white"
            href={`/api/auth/login?return_to=${encodeURIComponent(back)}`}
          >
            {t("consent.signIn")}
          </a>
        </p>
      )}
      {error && (
        <p role="alert" className="mb-3 rounded border border-red-300 bg-red-50 px-2 py-1 text-red-800">
          {error}
        </p>
      )}
      {d && (
        <>
          <p className="mb-3">
            {withNodes(t("consent.wants"), {
              app: <strong>{d.client.name}</strong>,
              user: <strong>{me?.user?.displayName ?? me?.user?.email}</strong>,
              host: <code>{d.client.redirectHost}</code>,
            })}
            {!d.client.verified && <span className="block text-slate-600">{t("consent.unverified")}</span>}
          </p>
          {d.reason ? (
            <p className="mb-3 rounded border border-amber-300 bg-amber-50 px-2 py-1">{d.reason}</p>
          ) : (
            <fieldset className="mb-4">
              <legend className="mb-1 font-medium">{t("consent.mayLegend")}</legend>
              {d.scopes.map((s) => (
                <label key={s.id} className="flex items-start gap-2 py-0.5">
                  <input
                    type="checkbox"
                    checked={kept.includes(s.id)}
                    onChange={(e) =>
                      setKept(e.target.checked ? [...kept, s.id] : kept.filter((k) => k !== s.id))
                    }
                  />
                  <span>{s.label}</span>
                </label>
              ))}
              <p className="mt-2 text-slate-600">{t("consent.limits")}</p>
            </fieldset>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !d.allowed || kept.length === 0}
              onClick={() => void answer(true)}
              className="rounded bg-blue-700 px-3 py-1 text-white disabled:opacity-50"
            >
              {t("consent.allow")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void answer(false)}
              className="rounded border border-slate-300 px-3 py-1"
            >
              {t("consent.deny")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
