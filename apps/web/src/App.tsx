import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { AdminPanel } from "./admin/AdminPanel";
import { AgentsPanel } from "./agents/AgentsPanel";
import { ConsentPage } from "./agents/ConsentPage";
import {
  I18nProvider,
  LANGUAGES,
  type LanguageChoice,
  storeChoice,
  storedChoice,
  useI18n,
} from "./i18n/i18n";
import { projectsApi } from "./projects/api";
import { ProjectsHome } from "./projects/ProjectsHome";
import { fetchMe, type Me, type Preferences, savePreferences } from "./session/api";
import { SetupPanel } from "./setup/SetupPanel";
import { AboutDialog } from "./shell/AboutDialog";
import { useRoute } from "./shell/route";
import { SettingsDialog } from "./shell/SettingsDialog";
import { SignIn } from "./shell/SignIn";
import { TopBar } from "./shell/TopBar";
import { type SettingsSection, UserMenu } from "./shell/UserMenu";
import { Workspace } from "./workspace/Workspace";

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

  return (
    <I18nProvider choice={choice} onChoose={choose}>
      <Shell me={me} loaded={loaded} prefs={prefs} onPrefs={savePrefs} reload={reload} />
    </I18nProvider>
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
  const brand = me?.instance.name ?? "MobSimLab";
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
        <div className="fixed inset-0 z-40 bg-slate-900/30">
          {overlay.kind === "admin" ? (
            <AdminPanel role={user.role} userId={user.id} csrfToken={csrf} onClose={close} />
          ) : (
            <AgentsPanel role={user.role} csrfToken={csrf} map={null} onClose={close} />
          )}
        </div>
      )}
    </>
  );

  // An AI app sent the person here to approve a connection (ADR-0035).
  if (route.page === "consent")
    return (
      <div className="h-full overflow-y-auto bg-slate-50">
        <ConsentPage me={me} />
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

  const account = (
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
    <div className="fixed inset-x-0 top-14 bottom-0 z-30">
      <SetupPanel name={me.instance.name} csrfToken={csrf} onFinished={reload} />
    </div>
  );

  if (route.page === "project")
    return (
      <>
        <Workspace
          api={api}
          projectId={route.id}
          tab={route.tab}
          fresh={route.fresh}
          brand={brand}
          account={account}
          onTab={(tab) => go({ ...route, tab, fresh: route.fresh && tab === "create" }, route.fresh)}
          onHome={home}
          onAbout={about}
          existingRailways={Boolean(prefs.existingRailways)}
        />
        {setup}
        {overlays}
      </>
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
