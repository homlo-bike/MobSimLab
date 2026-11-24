import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  I18nProvider,
  LANGUAGES,
  type LanguageChoice,
  storeChoice,
  storedChoice,
  useI18n,
} from "./i18n/i18n";
import { setLogSession } from "./logging/logger";
import { setCsrfToken } from "./session/csrf";
import { useStaleToken } from "./session/staleToken";
import { projectsApi } from "./projects/api";
import { ProjectsHome } from "./projects/ProjectsHome";
import { fetchMe, type Me, type Preferences, savePreferences } from "./session/api";
import { STATIC_VIEWER } from "./static/mode";
import { StaticHome } from "./static/StaticHome";
import { AboutDialog } from "./shell/AboutDialog";
import { lazyNamed, LoadingScreen } from "./shell/lazy";
import { useRoute } from "./shell/route";
import { SettingsDialog } from "./shell/SettingsDialog";
import { SignIn } from "./shell/SignIn";
import { setTheme, storedTheme } from "./shell/theme";
import { TopBar } from "./shell/TopBar";
import { type SettingsSection, UserMenu } from "./shell/UserMenu";
import { serverName } from "./shell/serverNames";

// Screens downloaded when first opened, so the sign-in page and the projects list load quickly.
const AdminPanel = lazyNamed(() => import("./admin/AdminPanel"), "AdminPanel");
const AgentsPanel = lazyNamed(() => import("./agents/AgentsPanel"), "AgentsPanel");
const ConsentPage = lazyNamed(() => import("./agents/ConsentPage"), "ConsentPage");
const SetupPanel = lazyNamed(() => import("./setup/SetupPanel"), "SetupPanel");
const Workspace = lazyNamed(() => import("./workspace/Workspace"), "Workspace");

const asChoice = (v: string | undefined): LanguageChoice | null =>
  v === "system" || LANGUAGES.some((l) => l.tag === v) ? (v as LanguageChoice) : null;

/**
 * Application root: loads the session, keeps the language (from the account, else this device, else the browser),
 * and applies the app settings to the page.
 */
export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [prefs, setPrefs] = useState<Preferences>({});
  const [choice, setChoice] = useState<LanguageChoice>(storedChoice);

  const reload = useCallback(() => {
    fetchMe().then(
      (m) => {
        setMe(m);
        const p = m.user?.preferences ?? {};
        setPrefs(p);
        const c = asChoice(p.language);
        if (c) setChoice(c);
        setLoaded(true);
      },
      () => {
        setMe(null);
        setLoaded(true);
      },
    );
  }, []);
  useEffect(reload, [reload]);

  const csrf = me?.csrfToken;
  // Browser logs go to the API only while someone is signed in (ADR-0022).
  useEffect(() => {
    setLogSession(csrf ?? null);
    setCsrfToken(csrf ?? null);
  }, [csrf]);
  const savePrefs = useCallback(
    (patch: Preferences) => {
      setPrefs((p) => ({ ...p, ...patch }));
      if (csrf) savePreferences(csrf, patch).then(setPrefs, () => {});
    },
    [csrf],
  );
  const choose = useCallback(
    (c: LanguageChoice) => {
      setChoice(c);
      storeChoice(c);
      if (csrf) savePrefs({ language: c });
    },
    [csrf, savePrefs],
  );

  useEffect(() => {
    const html = document.documentElement.classList;
    html.toggle("larger-targets", Boolean(prefs.largerTargets));
    html.toggle("reduce-motion", Boolean(prefs.reduceMotion));
  }, [prefs.largerTargets, prefs.reduceMotion]);
  // Light, dark, or the device's setting: the account's choice once loaded, else the one last used here.
  useEffect(
    () => setTheme(loaded && me?.user ? (prefs.theme ?? "auto") : storedTheme()),
    [loaded, me, prefs.theme],
  );

  return (
    <I18nProvider choice={choice} onChoose={choose}>
      <Shell me={me} loaded={loaded} prefs={prefs} onPrefs={savePrefs} reload={reload} />
      {me?.user && <StaleTokenBar />}
    </I18nProvider>
  );
}

/**
 * Shown once the server refused a change because this page's security token is out of date (the server restarted
 * with a new key): nothing the person changes is saved until the page is reloaded.
 */
function StaleTokenBar() {
  const { t } = useI18n();
  if (!useStaleToken()) return null;
  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-[60] flex flex-wrap items-center gap-3 border-b border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-900 shadow-md"
    >
      <p className="min-w-48 flex-1">{t("session.staleToken")}</p>
      <button type="button" className="btn btn-pri min-h-10" onClick={() => window.location.reload()}>
        {t("session.reload")}
      </button>
    </div>
  );
}

type Overlay =
  { kind: "about" } | { kind: "settings"; section: SettingsSection } | { kind: "admin" } | { kind: "agents" };

/** The pages: sign-in, the projects home, and an open project; plus the dialogs the top bar opens. */
function Shell({
  me,
  loaded,
  prefs,
  onPrefs,
  reload,
}: {
  me: Me | null;
  loaded: boolean;
  prefs: Preferences;
  onPrefs: (p: Preferences) => void;
  reload: () => void;
}) {
  const { t } = useI18n();
  const [route, go] = useRoute();
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const user = me?.user;
  const csrf = me?.csrfToken ?? "";
  const api = useMemo(() => projectsApi(csrf), [csrf]);
  const brand = me ? serverName(t, me.instance.name) : "MobSimLab";
  const refusal = new URLSearchParams(window.location.search).get("signin");
  useEffect(() => {
    document.title = brand;
  }, [brand]);

  const close = () => setOverlay(null);
  const overlays: ReactNode = (
    <>
      {overlay?.kind === "about" && <AboutDialog instanceName={brand} onClose={close} />}
      {overlay?.kind === "settings" && me && (
        <SettingsDialog
          me={me}
          section={overlay.section}
          preferences={prefs}
          onChange={onPrefs}
          onClose={close}
        />
      )}
      {(overlay?.kind === "admin" || overlay?.kind === "agents") && user && csrf && (
        <div className="fixed inset-0 z-40 bg-scrim/30">
          <LoadingScreen>
            {overlay.kind === "admin" ? (
              <AdminPanel role={user.role} userId={user.id} csrfToken={csrf} onClose={close} />
            ) : (
              <AgentsPanel role={user.role} csrfToken={csrf} map={null} onClose={close} />
            )}
          </LoadingScreen>
        </div>
      )}
    </>
  );

  // An AI app sent the person here to approve a connection (ADR-0035).
  if (route.page === "consent")
    return (
      <div className="h-full overflow-y-auto bg-slate-50">
        <LoadingScreen>
          <ConsentPage me={me} />
        </LoadingScreen>
      </div>
    );

  if (!loaded) return <p className="p-6 text-slate-500">{t("common.loading")}</p>;

  if (!user)
    return (
      <>
        <SignIn
          instanceName={brand}
          available={me?.signInAvailable ?? false}
          refusal={refusal}
          onAbout={() => setOverlay({ kind: "about" })}
        />
        {overlays}
      </>
    );

  // The static viewer has no accounts: nobody signs in or out.
  const account = STATIC_VIEWER ? null : (
    <UserMenu
      me={me}
      onSettings={(section) => setOverlay({ kind: "settings", section })}
      onAgents={() => setOverlay({ kind: "agents" })}
      onAdmin={() => setOverlay({ kind: "admin" })}
      onSignedOut={() => {
        go({ page: "home" }, true);
        reload();
      }}
    />
  );
  const home = () => go({ page: "home" });
  const about = () => setOverlay({ kind: "about" });

  if (user.role === "restricted")
    return (
      <div className="flex h-full flex-col">
        <TopBar brand={brand} onHome={home} onAbout={about} account={account} />
        <main className="flex flex-1 items-center justify-center p-6">
          <p
            role="status"
            className="max-w-md rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950"
          >
            {t("signin.restricted")}
          </p>
        </main>
        {overlays}
      </div>
    );

  const setup = me.instance.mode === "setup" && user.role === "owner" && csrf && (
    // The layer lets clicks through to the page; only the card itself takes them, so it never hides the page's
    // own buttons (Damascus test: it covered the home page's project filters).
    <div className="pointer-events-none fixed inset-x-0 top-14 bottom-0 z-30">
      <LoadingScreen>
        <SetupPanel name={me.instance.name} csrfToken={csrf} onFinished={reload} />
      </LoadingScreen>
    </div>
  );

  if (route.page === "project")
    return (
      <>
        <LoadingScreen>
          <Workspace
            api={api}
            projectId={route.id}
            tab={route.tab}
            fresh={route.fresh}
            brand={brand}
            account={account}
            onTab={(tab) => go({ ...route, tab, fresh: route.fresh && tab === "create" }, route.fresh)}
            onOpenProject={(id) => go({ page: "project", id, tab: route.tab, fresh: false })}
            onHome={home}
            onAbout={about}
            existingRailways={Boolean(prefs.existingRailways)}
            userId={user?.id ?? null}
            onRefreshSession={reload}
          />
        </LoadingScreen>
        {setup}
        {overlays}
      </>
    );

  if (STATIC_VIEWER)
    return (
      <div className="flex h-full flex-col">
        <TopBar brand={brand} onHome={home} onAbout={about} account={null} />
        <div className="min-h-0 flex-1">
          <StaticHome onOpen={(id) => go({ page: "project", id, tab: "simulator", fresh: false })} />
        </div>
        {overlays}
      </div>
    );

  const canCreate = ["owner", "admin", "user"].includes(user.role);
  return (
    <div className="flex h-full flex-col">
      <TopBar brand={brand} onHome={home} onAbout={about} account={account} />
      <div className="min-h-0 flex-1">
        <ProjectsHome
          api={api}
          meId={user.id}
          canCreate={canCreate}
          onOpen={(p, fresh = false) =>
            go({ page: "project", id: p.id, tab: fresh ? "create" : "simulator", fresh })
          }
        />
      </div>
      {setup}
      {overlays}
    </div>
  );
}
