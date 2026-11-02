import { type FormEvent, useState } from "react";
import { useI18n } from "../i18n/i18n";
import { can, type Project, type ProjectsApi } from "../projects/api";
import { ModePicker } from "../projects/ProjectDialogs";
import { Placeholder } from "./Placeholder";

/**
 * Preferences tab (mockup "Project preferences"): the project's name, description, study area and modes, which
 * Owners and Editors can change. Design rules per mode, vehicles, switches, calendar, demand and costs follow.
 */
export function ProjectPreferences({
  api,
  project,
  onSaved,
}: {
  api: ProjectsApi;
  project: Project;
  onSaved: (p: Project) => void;
}) {
  const { t } = useI18n();
  const editable = can.edit(project);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [area, setArea] = useState(project.areaName ?? "");
  const [modes, setModes] = useState(project.modes);
  const [state, setState] = useState<"idle" | "saving" | "saved" | { error: string }>("idle");
  const dirty =
    name.trim() !== project.name ||
    description.trim() !== project.description ||
    (area.trim() || null) !== project.areaName ||
    [...modes].sort().join() !== [...project.modes].sort().join();
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setState("saving");
    try {
      onSaved(
        await api.update(project.id, {
          name: name.trim(),
          description: description.trim(),
          areaName: area.trim() || null,
          modes,
        }),
      );
      setState("saved");
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : String(err) });
    }
  };
  const label = "mt-4 mb-1.5 block font-semibold";
  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10">
        <h1 className="text-2xl font-semibold tracking-tight">{t("prefs.title")}</h1>
        <p className="mt-1 text-slate-600">{t("prefs.intro")}</p>
        <form
          onSubmit={(e) => void save(e)}
          className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 md:p-6"
        >
          <h2 className="caps m-0">{t("prefs.project")}</h2>
          <fieldset disabled={!editable} className="m-0 border-0 p-0">
            <label className={label} htmlFor="pp-name">
              {t("new.name")}
            </label>
            <div className="field">
              <input
                id="pp-name"
                required
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <label className={label} htmlFor="pp-desc">
              {t("prefs.description")}
            </label>
            <textarea
              id="pp-desc"
              maxLength={2000}
              rows={3}
              className="w-full rounded-[10px] border border-slate-300 px-3 py-2 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <label className={label} htmlFor="pp-area">
              {t("new.area")}
            </label>
            <div className="field">
              <input id="pp-area" maxLength={200} value={area} onChange={(e) => setArea(e.target.value)} />
            </div>
            <div className={label}>{t("new.modes")}</div>
            <ModePicker value={modes} onChange={setModes} />
          </fieldset>
          {editable ? (
            <div className="mt-5 flex items-center gap-3">
              <button
                type="submit"
                className="btn btn-pri"
                disabled={!dirty || !name.trim() || state === "saving"}
              >
                {t("prefs.save")}
              </button>
              <span role="status" className="text-sm text-slate-600">
                {state === "saved" && !dirty
                  ? t("prefs.saved")
                  : typeof state === "object"
                    ? state.error
                    : ""}
              </span>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">{t("prefs.readOnly")}</p>
          )}
        </form>
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 md:p-6">
          <Placeholder
            title="prefs.moreTitle"
            intro="prefs.moreIntro"
            items={["prefs.rules", "prefs.vehicles", "prefs.switches", "prefs.calendar"]}
          />
        </div>
      </div>
    </div>
  );
}
