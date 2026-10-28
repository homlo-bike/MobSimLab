import { type FormEvent, useCallback, useEffect, useState } from "react";
import { get, send } from "../session/api";

const ROLES = ["owner", "admin", "user", "viewer", "restricted"] as const;
type Role = (typeof ROLES)[number];

/** A row of `GET /api/admin/users`. */
interface UserRow {
  id: string;
  email: string | null;
  displayName: string | null;
  role: Role;
  status: "pending" | "active" | "deleted";
  roleOverride: boolean;
  lastLoginAt: string | null;
  identities: { issuer: string; groups: string[] }[];
}

interface Registration {
  autoRegistration: boolean;
  defaultRole: "user" | "viewer";
  allowedEmailDomains: string[];
  allowedGroups: string[];
}

interface Mapping {
  id: string;
  group: string;
  role: Role;
  issuer: string | null;
}

interface AuditRecord {
  seq: string;
  at: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  objectType: string;
  objectId: string | null;
  reason: string | null;
}

type Tab = "users" | "signup" | "audit";

/**
 * Administration (05 §4): users, sign-up rules with group mappings, and the audit log.
 * Shown to Owners and Admins. Admins are not offered the Owner and Admin roles; the API enforces this too.
 */
export function AdminPanel({
  role,
  userId,
  csrfToken,
  onClose,
}: {
  role: string;
  userId: string;
  csrfToken: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("users");
  const [error, setError] = useState<string | null>(null);
  const offered = role === "owner" ? ROLES : ROLES.filter((r) => r !== "owner" && r !== "admin");
  const run = useCallback(async (f: () => Promise<unknown>) => {
    setError(null);
    try {
      await f();
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  const props = { csrfToken, run, offered, userId, actorRole: role };

  return (
    <section
      aria-label="Administration"
      className="absolute inset-4 z-20 flex flex-col rounded border border-slate-300 bg-white text-sm shadow-lg"
    >
      <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-2">
        <h2 className="font-semibold">Administration</h2>
        <nav role="tablist" className="flex gap-1">
          {(
            [
              ["users", "Users"],
              ["signup", "Sign-up rules"],
              ["audit", "Audit log"],
            ] as const
          ).map(([t, label]) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className={`rounded px-2 py-1 ${tab === t ? "bg-slate-800 text-white" : "hover:bg-slate-100"}`}
              onClick={() => setTab(t)}
            >
              {label}
            </button>
          ))}
        </nav>
        <button type="button" className="ml-auto rounded border border-slate-300 px-2 py-1" onClick={onClose}>
          Close
        </button>
      </header>
      {error && (
        <p role="alert" className="border-b border-red-200 bg-red-50 px-4 py-1 text-red-800">
          {error}
        </p>
      )}
      <div className="flex-1 overflow-auto p-4">
        {tab === "users" && <Users {...props} />}
        {tab === "signup" && <SignUp {...props} />}
        {tab === "audit" && <Audit run={run} />}
      </div>
    </section>
  );
}

interface TabProps {
  csrfToken: string;
  run: (f: () => Promise<unknown>) => Promise<void>;
  offered: readonly Role[];
  userId: string;
  actorRole: string;
}

const privileged = (r: Role) => r === "owner" || r === "admin";

function Users({ csrfToken, run, offered, userId, actorRole }: TabProps) {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [q, setQ] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const load = useCallback(
    () =>
      run(async () => {
        const params = new URLSearchParams();
        if (q) params.set("q", q);
        if (showDeleted) params.set("status", "deleted");
        setRows((await get<{ users: UserRow[] }>(`/api/admin/users?${params}`)).users);
      }),
    [run, q, showDeleted],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const act = (f: () => Promise<unknown>) => run(async () => (await f(), await load()));
  const patch = (u: UserRow, body: object) =>
    act(() => send("PATCH", `/api/admin/users/${u.id}`, csrfToken, body));
  const remove = (u: UserRow) => {
    const what = u.status === "pending" ? "Reject" : "Delete";
    const reason = window.prompt(`${what} ${u.email ?? u.id}? Optional reason for the audit log:`);
    if (reason === null) return;
    void act(() => send("DELETE", `/api/admin/users/${u.id}`, csrfToken, reason ? { reason } : {}));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <input
          aria-label="Search users"
          placeholder="Search name or e-mail"
          className="w-64 rounded border border-slate-300 px-2 py-1"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
          Show deleted
        </label>
      </div>
      <table className="w-full text-left">
        <thead className="text-slate-500">
          <tr>
            <th className="py-1">User</th>
            <th>IdP groups</th>
            <th>Status</th>
            <th>Role</th>
            <th title="Pinned roles are not changed by group mappings at sign-in">Pinned</th>
            <th>Last sign-in</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => {
            const self = u.id === userId;
            const locked = self || u.status === "deleted" || (actorRole !== "owner" && privileged(u.role));
            return (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="py-1">
                  {u.displayName ?? "(removed)"}
                  <div className="text-slate-500">{u.email}</div>
                </td>
                <td>{u.identities.flatMap((i) => i.groups).join(", ")}</td>
                <td>{u.status}</td>
                <td>
                  <select
                    aria-label={`Role of ${u.email ?? u.id}`}
                    value={u.role}
                    disabled={locked || u.status !== "active"}
                    onChange={(e) => void patch(u, { role: e.target.value })}
                    className="rounded border border-slate-300 px-1"
                  >
                    {(locked ? ROLES : offered).map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Pin role of ${u.email ?? u.id}`}
                    checked={u.roleOverride}
                    disabled={locked || u.status !== "active"}
                    onChange={(e) => void patch(u, { roleOverride: e.target.checked })}
                  />
                </td>
                <td>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "never"}</td>
                <td className="flex gap-2 py-1">
                  {u.status === "pending" && !locked && (
                    <button
                      type="button"
                      className="rounded bg-slate-800 px-2 text-white"
                      onClick={() =>
                        void act(() => send("POST", `/api/admin/users/${u.id}/approve`, csrfToken, {}))
                      }
                    >
                      Approve
                    </button>
                  )}
                  {!locked && (
                    <button
                      type="button"
                      className="rounded border border-slate-300 px-2"
                      onClick={() => remove(u)}
                    >
                      {u.status === "pending" ? "Reject" : "Delete"}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && <p className="text-slate-500">No users found.</p>}
    </div>
  );
}

const lines = (s: string) =>
  s
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean);

function SignUp({ csrfToken, run, offered }: TabProps) {
  const [reg, setReg] = useState<Registration | null>(null);
  const [domains, setDomains] = useState("");
  const [groups, setGroups] = useState("");
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [group, setGroup] = useState("");
  const [mapRole, setMapRole] = useState<Role>("user");
  const mappable = offered.filter((r) => r !== "owner");

  const load = useCallback(
    () =>
      run(async () => {
        const r = await get<Registration>("/api/admin/registration");
        setReg(r);
        setDomains(r.allowedEmailDomains.join("\n"));
        setGroups(r.allowedGroups.join("\n"));
        setMappings((await get<{ mappings: Mapping[] }>("/api/admin/group-mappings")).mappings);
      }),
    [run],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!reg) return null;

  const save = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await send("PUT", "/api/admin/registration", csrfToken, {
        ...reg,
        allowedEmailDomains: lines(domains),
        allowedGroups: lines(groups),
      });
      await load();
    });
  };
  const addMapping = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await send("POST", "/api/admin/group-mappings", csrfToken, { group: group.trim(), role: mapRole });
      setGroup("");
      await load();
    });
  };

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <form onSubmit={save} className="flex flex-col gap-2" aria-label="Sign-up rules">
        <h3 className="font-semibold">Who may sign up</h3>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={reg.autoRegistration}
            onChange={(e) => setReg({ ...reg, autoRegistration: e.target.checked })}
          />
          Let new people in without approval
        </label>
        <label className="flex flex-col gap-1">
          Default role for new people
          <select
            className="w-40 rounded border border-slate-300 px-1"
            value={reg.defaultRole}
            onChange={(e) => setReg({ ...reg, defaultRole: e.target.value as Registration["defaultRole"] })}
          >
            <option value="viewer">viewer</option>
            <option value="user">user</option>
          </select>
        </label>
        <p className="text-slate-500">
          Leave both lists empty to let anyone from the sign-in provider in. Otherwise a new person needs a
          verified e-mail in one of the domains or one of the groups; everyone else waits for approval.
        </p>
        <label className="flex flex-col gap-1">
          Allowed e-mail domains
          <textarea
            rows={3}
            className="rounded border border-slate-300 px-2 py-1"
            value={domains}
            onChange={(e) => setDomains(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          Allowed IdP groups
          <textarea
            rows={3}
            className="rounded border border-slate-300 px-2 py-1"
            value={groups}
            onChange={(e) => setGroups(e.target.value)}
          />
        </label>
        <button type="submit" className="w-24 rounded bg-slate-800 px-2 py-1 text-white">
          Save
        </button>
      </form>
      <div className="flex flex-col gap-2">
        <h3 className="font-semibold">Group mappings</h3>
        <p className="text-slate-500">
          At every sign-in, a person&apos;s role follows their IdP groups: the highest mapped role wins, and
          &ldquo;restricted&rdquo; wins over everything. Pinned roles are left alone.
        </p>
        <ul className="flex flex-col gap-1">
          {mappings.map((m) => (
            <li key={m.id} className="flex items-center gap-2">
              <span className="font-mono">{m.group}</span> → {m.role}
              {(offered.includes("admin") || m.role !== "admin") && (
                <button
                  type="button"
                  aria-label={`Remove mapping ${m.group}`}
                  className="rounded border border-slate-300 px-1"
                  onClick={() =>
                    void run(async () => {
                      await send("DELETE", `/api/admin/group-mappings/${m.id}`, csrfToken);
                      await load();
                    })
                  }
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
        <form onSubmit={addMapping} className="flex items-end gap-2" aria-label="Add group mapping">
          <label className="flex flex-col gap-1">
            Group
            <input
              required
              maxLength={200}
              className="rounded border border-slate-300 px-2 py-1"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            Role
            <select
              className="rounded border border-slate-300 px-1 py-1"
              value={mapRole}
              onChange={(e) => setMapRole(e.target.value as Role)}
            >
              {mappable.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="rounded bg-slate-800 px-2 py-1 text-white">
            Add
          </button>
        </form>
      </div>
    </div>
  );
}

function Audit({ run }: { run: TabProps["run"] }) {
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [brokenAt, setBrokenAt] = useState<number | null>(null);
  const [more, setMore] = useState(true);

  const load = useCallback(
    (before?: string) =>
      run(async () => {
        const r = await get<{ records: AuditRecord[]; brokenAt: number | null }>(
          `/api/admin/audit?limit=50${before ? `&before=${before}` : ""}`,
        );
        setBrokenAt(r.brokenAt);
        setRecords((prev) => (before ? [...prev, ...r.records] : r.records));
        setMore(r.records.length === 50);
      }),
    [run],
  );
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-3">
      <p role="status" className={brokenAt === null ? "text-green-800" : "font-semibold text-red-800"}>
        {brokenAt === null
          ? "Audit chain verified: no record has been changed or removed."
          : `Audit chain broken at record ${brokenAt}. Records may have been tampered with.`}
      </p>
      <table className="w-full text-left">
        <thead className="text-slate-500">
          <tr>
            <th className="py-1">#</th>
            <th>Time</th>
            <th>Who</th>
            <th>Action</th>
            <th>Object</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.seq} className="border-t border-slate-100">
              <td className="py-1">{r.seq}</td>
              <td>{new Date(r.at).toLocaleString()}</td>
              <td>{r.actorEmail ?? (r.actorId ? "(removed)" : "system")}</td>
              <td className="font-mono">{r.action}</td>
              <td>
                {r.objectType} {r.objectId?.slice(0, 8)}
              </td>
              <td>{r.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {more && records.length > 0 && (
        <button
          type="button"
          className="w-32 rounded border border-slate-300 px-2 py-1"
          onClick={() => void load(records[records.length - 1]?.seq)}
        >
          Load older
        </button>
      )}
    </div>
  );
}
