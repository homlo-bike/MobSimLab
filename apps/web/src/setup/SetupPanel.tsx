import { type FormEvent, useCallback, useEffect, useState } from "react";
import { ROLES, SignUpRules } from "../admin/AdminPanel";
import { EsriImageryConfig, type EsriStatus } from "../admin/EsriImageryAdmin";
import { MapLayersConfig } from "../admin/MapLayersAdmin";
import { engineErrorText } from "../i18n/engine";
import { useI18n } from "../i18n/i18n";
import { localizeSummary } from "../plugins/texts";
import { get, send } from "../session/api";

const ESRI = "org.mobsimlab.esri-imagery";
const OGC = "org.mobsimlab.ogc-layers";

/** The parts of a bundled plugin of `GET /api/admin/plugins` the basemap step shows. */
interface BasemapPlugin {
  id: string;
  name: string;
  description: string;
  version: string;
  bundled: boolean;
  publisher: { name: string };
  projects: number;
  contributes: Parameters<typeof localizeSummary>[0]["contributes"];
  translations?: Record<string, Record<string, string>>;
}

type Step = "name" | "signup" | "maps";
const STEPS: Step[] = ["name", "signup", "maps"];

/**
 * Setup wizard (05 §3.1), shown to the Owner while the instance is in setup mode: the instance name, who may
 * sign up (sign-up rules, the default role and group mappings, as in Administration → Sign-up rules), and the
 * basemaps that need setting up (Esri World Imagery's key and WMS, WMTS and XYZ map layers, as in
 * Administration → Plugins), then Finish setup. Every step after the name can be skipped and changed later.
 */
export function SetupPanel({
  name,
  csrfToken,
  onFinished,
}: {
  name: string;
  csrfToken: string;
  onFinished: () => void;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>("name");
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (f: () => Promise<unknown>) => {
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(engineErrorText(e));
    }
  }, []);
  const index = STEPS.indexOf(step);

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await run(async () => {
      await send("PUT", "/api/setup/instance", csrfToken, { name: value });
      setStep("signup");
    });
    setBusy(false);
  };
  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      await send("POST", "/api/setup/finish", csrfToken);
      onFinished();
    } catch (err) {
      setError(engineErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  const titles: Record<Step, string> = {
    name: t("setup.stepName"),
    signup: t("admin.signup"),
    maps: t("setup.stepMaps"),
  };

  return (
    <section
      aria-label={t("setup.wizard")}
      className="pointer-events-auto absolute inset-x-4 bottom-20 z-10 max-h-[calc(100%-6rem)] overflow-auto rounded border border-slate-300 bg-white p-4 text-sm shadow md:inset-x-auto md:end-4 md:bottom-8 md:w-[34rem]"
    >
      <h2 className="mb-1 font-semibold">{t("setup.wizardTitle")}</h2>
      <p className="mb-3 text-slate-600">{t("setup.wizardIntro")}</p>
      <p className="mb-2 text-xs text-slate-500" aria-live="polite">
        {t("setup.stepOf", { n: index + 1, count: STEPS.length })} · {titles[step]}
      </p>

      {step === "name" && (
        <form onSubmit={(e) => void saveName(e)} className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            {t("setup.instanceName")}
            <input
              className="rounded border border-slate-300 px-2 py-1"
              value={value}
              maxLength={100}
              required
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="text-red-700">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="self-end rounded bg-slate-800 px-3 py-1 text-white disabled:opacity-50"
          >
            {t("setup.next")}
          </button>
        </form>
      )}

      {step === "signup" && (
        <div className="flex flex-col gap-3">
          <p className="text-slate-600">{t("setup.signupIntro")}</p>
          <SignUpRules csrfToken={csrfToken} run={run} offered={ROLES} />
          {error && (
            <p role="alert" className="text-red-700">
              {error}
            </p>
          )}
          <Nav back={() => setStep("name")} next={() => setStep("maps")} />
        </div>
      )}

      {step === "maps" && (
        <div className="flex flex-col gap-3">
          <p className="text-slate-600">{t("setup.mapsIntro")}</p>
          <Basemaps csrfToken={csrfToken} run={run} />
          {error && (
            <p role="alert" className="text-red-700">
              {error}
            </p>
          )}
          <div className="flex justify-between gap-2">
            <button
              type="button"
              className="rounded border border-slate-300 px-3 py-1"
              onClick={() => setStep("signup")}
            >
              {t("setup.back")}
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded bg-slate-800 px-3 py-1 text-white disabled:opacity-50"
              onClick={() => void finish()}
            >
              {t("setup.finish")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Back and Next of a middle step. */
function Nav({ back, next }: { back: () => void; next: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex justify-between gap-2">
      <button type="button" className="rounded border border-slate-300 px-3 py-1" onClick={back}>
        {t("setup.back")}
      </button>
      <button type="button" className="rounded bg-slate-800 px-3 py-1 text-white" onClick={next}>
        {t("setup.next")}
      </button>
    </div>
  );
}

/**
 * Purpose: the basemaps that need an Admin, each with its Configure window from Administration → Plugins: Esri
 * World Imagery (an ArcGIS API key) and WMS, WMTS and XYZ map layers (the organisation's own map services).
 */
function Basemaps({
  csrfToken,
  run,
}: {
  csrfToken: string;
  run: (f: () => Promise<unknown>) => Promise<void>;
}) {
  const { t, language } = useI18n();
  const [plugins, setPlugins] = useState<BasemapPlugin[]>([]);
  const [esri, setEsri] = useState<EsriStatus | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    void run(async () => {
      const [d, b] = await Promise.all([
        get<{ bundled: BasemapPlugin[] }>("/api/admin/plugins"),
        get<{ esri: EsriStatus }>("/api/admin/basemaps"),
      ]);
      setPlugins(
        d.bundled.filter((p) => p.id === ESRI || p.id === OGC).map((p) => localizeSummary(p, language)),
      );
      setEsri(b.esri);
    });
  }, [run, language]);

  const meta = (p: BasemapPlugin) =>
    [
      t("plugins.bundled"),
      t("plugins.versionN", { version: p.version }),
      t("plugins.inProjects", { count: p.projects }),
    ].join(" · ");
  const shown = plugins.find((p) => p.id === open);

  return (
    <>
      <ul className="flex flex-col gap-2">
        {[ESRI, OGC].flatMap((id) => {
          const p = plugins.find((x) => x.id === id);
          if (!p) return [];
          const needsKey = id === ESRI && esri !== null && !esri.configured;
          return [
            <li key={id} className="flex items-center gap-3 rounded border border-slate-200 px-3 py-2">
              <span className="flex flex-1 flex-col">
                <span className="font-medium">{p.name}</span>
                <span className={`text-xs ${needsKey ? "text-amber-800" : "text-slate-500"}`}>
                  {needsKey ? t("padmin.needsKey") : p.description}
                </span>
              </span>
              <button
                type="button"
                className="rounded border border-slate-300 px-2 py-1"
                aria-label={t("padmin.configureName", { name: p.name })}
                onClick={() => setOpen(id)}
              >
                {t("padmin.configure")}
              </button>
            </li>,
          ];
        })}
      </ul>
      {shown?.id === ESRI && esri && (
        <EsriImageryConfig
          csrfToken={csrfToken}
          status={esri}
          meta={meta(shown)}
          onStatus={setEsri}
          onClose={() => setOpen(null)}
        />
      )}
      {shown?.id === OGC && (
        <MapLayersConfig csrfToken={csrfToken} meta={meta(shown)} onClose={() => setOpen(null)} />
      )}
    </>
  );
}
