import { type FormEvent, useEffect, useState } from "react";
import { useI18n } from "../i18n/i18n";
import type { MessageKey } from "../i18n/messages";
import { Dialog } from "../shell/Dialog";
import { LinkIcon } from "../shell/icons";
import { initials } from "../shell/UserMenu";
import {
  type Member,
  type Mode,
  type Project,
  type ProjectRole,
  type ProjectsApi,
  RAIL_MODES,
  STREET_MODES,
} from "./api";

/** An error line under a form. */
function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p
      role="alert"
      className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
    >
      {error}
    </p>
  );
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const label = "mt-4 mb-1.5 block font-semibold";

/** Purpose: toggle chips for the modes a project plans to use, street and rail grouped. */
export function ModePicker({ value, onChange }: { value: string[]; onChange: (m: string[]) => void }) {
  const { t } = useI18n();
  const flip = (m: Mode) => onChange(value.includes(m) ? value.filter((x) => x !== m) : [...value, m]);
  const group = (title: MessageKey, modes: readonly Mode[]) => (
    <div className="mt-2">
      <div className="mb-1 text-xs text-slate-500">{t(title)}</div>
      <div className="flex flex-wrap gap-2">
        {modes.map((m) => (
          <button
            key={m}
            type="button"
            className="chip min-h-11"
            aria-pressed={value.includes(m)}
            onClick={() => flip(m)}
          >
            {t(`mode.${m}` as MessageKey)}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <div>
      {group("mode.street", STREET_MODES)}
      {group("mode.rail", RAIL_MODES)}
    </div>
  );
}

/** New project dialog: name, area, start empty or from a copy, and the modes to plan for. */
export function NewProjectDialog({
  api,
  projects,
  onCreated,
  onClose,
}: {
  api: ProjectsApi;
  projects: Project[];
  onCreated: (p: Project) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const [from, setFrom] = useState<"empty" | "copy">("empty");
  const [source, setSource] = useState(projects[0]?.id ?? "");
  const [modes, setModes] = useState<string[]>(["bus", "tram"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let p: Project;
      if (from === "copy" && source) {
        p = await api.duplicate(source, name.trim());
        if (area.trim()) p = await api.update(p.id, { areaName: area.trim() });
      } else {
        p = await api.create({ name: name.trim(), areaName: area.trim() || null, modes });
      }
      onCreated(p);
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  };
  const opt = (on: boolean) =>
    `flex min-h-11 w-full items-start gap-3 rounded-xl border-[1.5px] px-3.5 py-3 text-start ${on ? "border-blue-700 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"}`;
  const dot = (on: boolean) =>
    `mt-0.5 h-5 w-5 shrink-0 rounded-full ${on ? "border-[6px] border-blue-700" : "border-2 border-slate-400"}`;
  return (
    <Dialog
      title={t("new.title")}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" form="new-project" className="btn btn-pri" disabled={busy || !name.trim()}>
            {t("new.create")}
          </button>
        </>
      }
    >
      <form id="new-project" onSubmit={(e) => void submit(e)}>
        <label className={label} htmlFor="np-name">
          {t("new.name")}
        </label>
        <div className="field">
          <input
            id="np-name"
            data-autofocus
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <label className={label} htmlFor="np-area">
          {t("new.area")}
        </label>
        <div className="field">
          <input
            id="np-area"
            maxLength={200}
            placeholder={t("new.areaPlaceholder")}
            value={area}
            onChange={(e) => setArea(e.target.value)}
          />
        </div>
        <p className="mt-1.5 text-xs text-slate-500">{t("new.areaNote")}</p>
        <div className={label} id="np-from">
          {t("new.startFrom")}
        </div>
        <div role="radiogroup" aria-labelledby="np-from" className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <button
            type="button"
            role="radio"
            aria-checked={from === "empty"}
            className={opt(from === "empty")}
            onClick={() => setFrom("empty")}
          >
            <span className={dot(from === "empty")} />
            <span>
              <b className="block">{t("new.empty")}</b>
              <span className="text-[13px] text-slate-500">{t("new.emptyHint")}</span>
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={from === "copy"}
            disabled={projects.length === 0}
            className={`${opt(from === "copy")} disabled:opacity-50`}
            onClick={() => setFrom("copy")}
          >
            <span className={dot(from === "copy")} />
            <span>
              <b className="block">{t("new.copy")}</b>
              <span className="text-[13px] text-slate-500">{t("new.copyHint")}</span>
            </span>
          </button>
        </div>
        {from === "copy" ? (
          <>
            <label className={label} htmlFor="np-source">
              {t("new.copyWhich")}
            </label>
            <div className="field">
              <select id="np-source" value={source} onChange={(e) => setSource(e.target.value)}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : (
          <>
            <div className={label}>{t("new.modes")}</div>
            <ModePicker value={modes} onChange={setModes} />
            <p className="mt-1.5 text-xs text-slate-500">{t("new.modesNote")}</p>
          </>
        )}
        <ErrorLine error={error} />
      </form>
    </Dialog>
  );
}

/** Rename dialog. */
export function RenameDialog({
  api,
  project,
  onDone,
  onClose,
}: {
  api: ProjectsApi;
  project: Project;
  onDone: (p: Project) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(project.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      onDone(await api.update(project.id, { name: name.trim() }));
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={t("rename.title")}
      onClose={onClose}
      width="max-w-md"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            form="rename"
            className="btn btn-pri"
            disabled={busy || !name.trim() || name.trim() === project.name}
          >
            {t("rename.save")}
          </button>
        </>
      }
    >
      <form id="rename" onSubmit={(e) => void submit(e)}>
        <label className={label} htmlFor="rn-name">
          {t("new.name")}
        </label>
        <div className="field">
          <input
            id="rn-name"
            data-autofocus
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <ErrorLine error={error} />
      </form>
    </Dialog>
  );
}

type GrantRole = Exclude<ProjectRole, "owner">;
const GRANTS: GrantRole[] = ["editor", "commenter", "viewer"];

/**
 * Share and manage access (mockup "Share and manage access"): invite by e-mail with a role, change or remove
 * people's access, and the view-only link. Non-owners see who has access, read-only, and can leave.
 */
export function ShareDialog({
  api,
  project,
  meId,
  focus,
  onChanged,
  onLeft,
  onClose,
}: {
  api: ProjectsApi;
  project: Project;
  meId: string;
  focus: "invite" | "access";
  onChanged: (p: Project) => void;
  onLeft: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const owner = project.myRole === "owner";
  const [members, setMembers] = useState<Member[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<GrantRole>("editor");
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState(project.linkAccess);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    api.members(project.id).then(setMembers, (e: unknown) => setError(message(e)));
  }, [api, project.id]);
  const act = async (f: () => Promise<void>) => {
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(message(e));
    }
  };
  const invite = (e: FormEvent) => {
    e.preventDefault();
    void act(async () => {
      setMembers(await api.addMember(project.id, email.trim(), role));
      setEmail("");
    });
  };
  const url = `${window.location.origin}/projects/${project.id}/simulator`;
  const roleSelect = (value: GrantRole, onChange: (r: GrantRole) => void, labelText: string) => (
    <select
      aria-label={labelText}
      className="min-h-11 rounded-[10px] border border-slate-300 bg-white px-3 font-medium"
      value={value}
      onChange={(e) => onChange(e.target.value as GrantRole)}
    >
      {GRANTS.map((r) => (
        <option key={r} value={r}>
          {t(`prole.${r}` as MessageKey)}
        </option>
      ))}
    </select>
  );
  return (
    <Dialog
      title={t("share.title", { name: project.name })}
      subtitle={t("share.rolesNote")}
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-pri" onClick={onClose}>
          {t("common.done")}
        </button>
      }
    >
      {owner && (
        <form className="mt-1 flex flex-wrap gap-2" onSubmit={invite}>
          <div className="field min-w-48 flex-1">
            <input
              type="email"
              required
              data-autofocus={focus === "invite" ? true : undefined}
              aria-label={t("share.invite")}
              placeholder={t("share.emailPlaceholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          {roleSelect(role, setRole, t("share.inviteRole"))}
          <button type="submit" className="btn btn-pri" disabled={!email.trim()}>
            {t("share.inviteButton")}
          </button>
        </form>
      )}
      <ErrorLine error={error} />
      <div className="caps mt-5 mb-1">{t("share.people")}</div>
      {!members && !error && <p className="py-3 text-sm text-slate-500">{t("common.loading")}</p>}
      <ul aria-label={t("share.people")} className="m-0 list-none p-0">
        {members?.map((m) => {
          const name = m.displayName ?? m.email ?? "?";
          const self = m.userId === meId;
          return (
            <li
              key={m.userId}
              className="flex min-h-15 items-center gap-3 border-b border-slate-200 py-2 last:border-b-0"
            >
              <span className="avatar">{initials(name)}</span>
              <div className="min-w-0 flex-1">
                <b className="block truncate font-semibold">
                  {name}
                  {self && ` (${t("share.you")})`}
                </b>
                {m.email && m.email !== name && (
                  <span className="block truncate text-[13px] text-slate-500">{m.email}</span>
                )}
              </div>
              {m.role === "owner" || !owner ? (
                <span className="text-sm font-semibold">{t(`prole.${m.role}` as MessageKey)}</span>
              ) : (
                <>
                  {roleSelect(
                    m.role,
                    (r) => void act(async () => setMembers(await api.setRole(project.id, m.userId, r))),
                    t("share.roleOf", { name }),
                  )}
                  <button
                    type="button"
                    className="icon-btn text-red-700"
                    aria-label={t("share.remove", { name })}
                    onClick={() =>
                      void act(async () => {
                        await api.removeMember(project.id, m.userId);
                        setMembers((ms) => ms?.filter((x) => x.userId !== m.userId) ?? null);
                      })
                    }
                  >
                    ×
                  </button>
                </>
              )}
              {self && !owner && (
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    void act(async () => {
                      await api.removeMember(project.id, m.userId);
                      onLeft();
                    })
                  }
                >
                  {t("share.leave")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 px-3.5 py-3">
        <LinkIcon />
        <div className="min-w-40 flex-1">
          <b className="block">{t("share.link")}</b>
          <span className="text-xs text-slate-500">{link ? t("share.linkOn") : t("share.linkOff")}</span>
        </div>
        {owner && (
          <button
            type="button"
            role="switch"
            aria-checked={link}
            aria-label={t("share.link")}
            className="btn"
            onClick={() =>
              void act(async () => {
                const p = await api.setLink(project.id, !link);
                setLink(p.linkAccess);
                onChanged(p);
              })
            }
          >
            {link ? t("share.linkTurnOff") : t("share.linkTurnOn")}
          </button>
        )}
        {link && (
          <button
            type="button"
            className="btn"
            onClick={() =>
              void navigator.clipboard?.writeText(url).then(
                () => setCopied(true),
                () => setCopied(false),
              )
            }
          >
            {copied ? t("share.copied") : t("share.copyLink")}
          </button>
        )}
      </div>
    </Dialog>
  );
}

/** Delete confirmation (mockup "Delete confirmation"): offers archive instead, and needs the name typed. */
export function DeleteDialog({
  api,
  project,
  onDeleted,
  onArchived,
  onClose,
}: {
  api: ProjectsApi;
  project: Project;
  onDeleted: () => void;
  onArchived: (p: Project) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim() === project.name.trim();
  const others = project.memberCount - 1;
  const run = async (f: () => Promise<void>) => {
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(message(e));
    }
  };
  return (
    <Dialog
      title={t("delete.title", { name: project.name })}
      subtitle={others > 0 ? t("delete.sharedNote", { count: others }) : t("delete.note")}
      onClose={onClose}
      width="max-w-lg"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={!matches}
            onClick={() =>
              void run(async () => {
                await api.remove(project.id, typed);
                onDeleted();
              })
            }
          >
            {t("delete.confirm")}
          </button>
        </>
      }
    >
      <p className="text-sm text-slate-700">{t("delete.bin")}</p>
      {!project.archivedAt && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
          <b>{t("delete.archiveInstead")}</b>
          <p className="mt-0.5 mb-2.5 text-xs text-slate-600">{t("delete.archiveNote")}</p>
          <button
            type="button"
            className="btn w-full"
            onClick={() => void run(async () => onArchived(await api.archive(project.id, true)))}
          >
            {t("delete.archiveButton")}
          </button>
        </div>
      )}
      <label htmlFor="dl-name" className={label}>
        {t("delete.typeName")}
      </label>
      <div className="field">
        <input
          id="dl-name"
          data-autofocus
          autoCapitalize="off"
          autoComplete="off"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      </div>
      <ErrorLine error={error} />
    </Dialog>
  );
}
