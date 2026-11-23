import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n/i18n";
import type { CommentObjectType, CommentsApi, ProjectComment } from "./api";
import { engineErrorText } from "../../i18n/engine";

/** The project's comments and what the person may do with them, shared by every panel of the workspace. */
interface CommentsState {
  comments: ProjectComment[];
  error: string | null;
  /** Owners, Editors and Commenters write; Viewers read. */
  canComment: boolean;
  /** Owners delete anyone's comments. */
  isOwner: boolean;
  userId: string | null;
  run: (job: (api: CommentsApi) => Promise<unknown>) => Promise<boolean>;
}

const Ctx = createContext<CommentsState | null>(null);

/** Purpose: the key of an object in the comment counts. */
export const objectKey = (type: CommentObjectType, id: string | number) => `${type}:${id}`;

/**
 * Purpose: load a project's comments and share them with the panels below (the editors render their panels
 * through portals, which keep this context). Loads again when the window gets focus, so comments others wrote
 * show up without a reload. Without an `api` nothing is shown.
 */
export function CommentsProvider({
  api,
  canComment,
  isOwner,
  userId,
  children,
}: {
  api: CommentsApi | null;
  canComment: boolean;
  isOwner: boolean;
  userId: string | null;
  children: ReactNode;
}) {
  const [comments, setComments] = useState<ProjectComment[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!api) return;
    try {
      setComments(await api.list());
      setError(null);
    } catch (e) {
      setError(engineErrorText(e));
    }
  }, [api]);

  useEffect(() => {
    void reload();
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reload]);

  const run = useCallback(
    async (job: (a: CommentsApi) => Promise<unknown>) => {
      if (!api) return false;
      try {
        await job(api);
        await reload();
        return true;
      } catch (e) {
        setError(engineErrorText(e));
        return false;
      }
    },
    [api, reload],
  );

  const value = useMemo<CommentsState | null>(
    () => (api ? { comments, error, canComment, isOwner, userId, run } : null),
    [api, comments, error, canComment, isOwner, userId, run],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Purpose: the number of open (not resolved) threads per object, by `objectKey`. */
export function useOpenThreads(): ReadonlyMap<string, number> {
  const ctx = useContext(Ctx);
  return useMemo(() => {
    const m = new Map<string, number>();
    for (const c of ctx?.comments ?? [])
      if (!c.parentId && !c.resolvedAt) {
        const k = objectKey(c.objectType, c.objectId);
        m.set(k, (m.get(k) ?? 0) + 1);
      }
    return m;
  }, [ctx?.comments]);
}

/** Purpose: a small badge with an object's open threads; nothing when it has none or comments are off. */
export function CommentBadge({ type, id }: { type: CommentObjectType; id: string | number }) {
  const { tn } = useI18n();
  const n = useOpenThreads().get(objectKey(type, id)) ?? 0;
  if (!n) return null;
  return (
    <span
      className="ml-auto shrink-0 rounded-full bg-amber-100 px-1.5 text-xs font-medium text-amber-900"
      title={tn("comments.openThreads", n)}
      aria-label={tn("comments.openThreads", n)}
    >
      💬 {n}
    </span>
  );
}

/**
 * Purpose: the comment threads of one object, with a box to start a thread for those who may comment.
 * Open threads come first; resolved ones stay folded until asked for. Nothing renders outside a provider.
 */
export function ObjectComments({ type, id }: { type: CommentObjectType; id: string | number }) {
  const { t, tn } = useI18n();
  const ctx = useContext(Ctx);
  const [showResolved, setShowResolved] = useState(false);
  const objectId = String(id);
  const all = ctx?.comments;
  const threads = useMemo(
    () => (all ?? []).filter((c) => !c.parentId && c.objectType === type && c.objectId === objectId),
    [all, type, objectId],
  );
  if (!ctx) return null;
  const open = threads.filter((c) => !c.resolvedAt);
  const resolved = threads.filter((c) => c.resolvedAt);

  return (
    <section aria-label={t("comments.title")} className="flex flex-col gap-2 border-t border-slate-200 pt-3">
      <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
        {t("comments.title")}
        {open.length > 0 && ` (${open.length})`}
      </h3>
      {ctx.error && (
        <p role="alert" className="text-xs text-red-700">
          {t("comments.failed", { error: ctx.error })}
        </p>
      )}
      {threads.length === 0 && <p className="text-xs text-slate-600">{t("comments.none")}</p>}
      {open.map((c) => (
        <Thread key={c.id} root={c} />
      ))}
      {resolved.length > 0 && (
        <button
          type="button"
          className="self-start text-xs text-slate-600 underline"
          aria-expanded={showResolved}
          onClick={() => setShowResolved((s) => !s)}
        >
          {showResolved ? t("comments.hideResolved") : tn("comments.showResolved", resolved.length)}
        </button>
      )}
      {showResolved && resolved.map((c) => <Thread key={c.id} root={c} />)}
      {ctx.canComment ? (
        <Composer
          label={t("comments.new")}
          submit={t("comments.post")}
          onSubmit={(body) => ctx.run((a) => a.add({ objectType: type, objectId, body }))}
        />
      ) : (
        <p className="text-xs text-slate-500">{t("comments.readOnly")}</p>
      )}
    </section>
  );
}

function Thread({ root }: { root: ProjectComment }) {
  const { t } = useI18n();
  const ctx = useContext(Ctx)!;
  const [replying, setReplying] = useState(false);
  const replies = ctx.comments.filter((c) => c.parentId === root.id);
  return (
    <article
      className={`rounded-lg border p-2 ${root.resolvedAt ? "border-slate-200 bg-slate-50" : "border-amber-200 bg-amber-50/40"}`}
    >
      <Comment c={root} />
      {replies.map((r) => (
        <div key={r.id} className="mt-2 border-l-2 border-slate-200 pl-2">
          <Comment c={r} />
        </div>
      ))}
      {root.resolvedAt && (
        <p className="mt-1 text-xs text-slate-500">
          {t("comments.resolvedBy", { name: root.resolvedBy?.displayName ?? t("comments.someone") })}
        </p>
      )}
      {ctx.canComment && (
        <div className="mt-1 flex flex-wrap gap-3 text-xs">
          {!root.resolvedAt && (
            <button type="button" className="text-slate-700 underline" onClick={() => setReplying((r) => !r)}>
              {t("comments.reply")}
            </button>
          )}
          <button
            type="button"
            className="text-slate-700 underline"
            onClick={() => void ctx.run((a) => a.resolve(root.id, !root.resolvedAt))}
          >
            {root.resolvedAt ? t("comments.reopen") : t("comments.resolve")}
          </button>
        </div>
      )}
      {replying && (
        <Composer
          label={t("comments.replyLabel")}
          submit={t("comments.reply")}
          autoFocus
          onCancel={() => setReplying(false)}
          onSubmit={async (body) => {
            const ok = await ctx.run((a) => a.add({ ...target(root), body, parentId: root.id }));
            if (ok) setReplying(false);
            return ok;
          }}
        />
      )}
    </article>
  );
}

const target = (c: ProjectComment) => ({ objectType: c.objectType, objectId: c.objectId });

function Comment({ c }: { c: ProjectComment }) {
  const { t, language } = useI18n();
  const ctx = useContext(Ctx)!;
  const [editing, setEditing] = useState(false);
  const mine = c.author !== null && c.author.id === ctx.userId;
  const canDelete = ctx.canComment && (mine || ctx.isOwner);
  const when = new Date(c.createdAt).toLocaleString(language, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return (
    <div>
      <p className="text-xs text-slate-600">
        <span className="font-medium text-slate-800">{c.author?.displayName ?? t("comments.someone")}</span>
        {" · "}
        <time dateTime={c.createdAt}>{when}</time>
        {c.editedAt && ` · ${t("comments.edited")}`}
      </p>
      {editing ? (
        <Composer
          label={t("comments.editLabel")}
          submit={t("comments.save")}
          initial={c.body}
          autoFocus
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            const ok = await ctx.run((a) => a.edit(c.id, body));
            if (ok) setEditing(false);
            return ok;
          }}
        />
      ) : (
        <p className="break-words whitespace-pre-wrap text-slate-900">{c.body}</p>
      )}
      {!editing && ctx.canComment && (mine || canDelete) && (
        <div className="mt-0.5 flex gap-3 text-xs">
          {mine && (
            <button type="button" className="text-slate-600 underline" onClick={() => setEditing(true)}>
              {t("comments.edit")}
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              className="text-red-700 underline"
              onClick={() => {
                if (
                  window.confirm(c.parentId ? t("comments.confirmDelete") : t("comments.confirmDeleteThread"))
                )
                  void ctx.run((a) => a.remove(c.id));
              }}
            >
              {t("comments.delete")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Most characters in a comment (apps/api/src/comments/comments.controller.ts). */
const MAX_LENGTH = 4000;

function Composer({
  label,
  submit,
  initial = "",
  autoFocus = false,
  onSubmit,
  onCancel,
}: {
  label: string;
  submit: string;
  initial?: string;
  autoFocus?: boolean;
  onSubmit: (body: string) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const body = text.trim();
  return (
    <form
      className="mt-1 flex flex-col gap-1"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!body || busy) return;
        setBusy(true);
        const ok = await onSubmit(body);
        setBusy(false);
        if (ok && !initial) setText("");
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="sr-only">{label}</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={label}
          maxLength={MAX_LENGTH}
          rows={2}
          autoFocus={autoFocus}
          className="rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!body || busy}
          className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          {submit}
        </button>
        {onCancel && (
          <button type="button" className="rounded px-2 py-1 text-xs text-slate-700" onClick={onCancel}>
            {t("comments.cancel")}
          </button>
        )}
      </div>
    </form>
  );
}
