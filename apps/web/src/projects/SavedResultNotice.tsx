import { useI18n } from "../i18n/i18n";

/** Whether a saved result matches what it depends on now. */
export type ResultState = "current" | "stale";

interface Props {
  /** "current": the result matches its inputs; "stale": an input changed since it was worked out. */
  state: ResultState;
  /** When it was worked out (ISO time), when known. */
  computedAt?: string | null;
  /** Works the result out again; absent for people who may not change the project. */
  onRecalculate?: (() => void) | null;
  /** A recalculation is under way. */
  busy?: boolean;
  /** Why saving the result failed. */
  error?: string | null;
}

/**
 * Purpose: one line under a calculated result saved with the project: when it was worked out, or that it is out
 * of date, with a Recalculate button when the planner may change the project.
 */
export function SavedResultNotice({
  state,
  computedAt = null,
  onRecalculate = null,
  busy = false,
  error = null,
}: Props) {
  const { t } = useI18n();
  const when = computedAt ? new Date(computedAt).toLocaleString() : null;
  const text =
    state === "stale"
      ? when
        ? t("results.staleAt", { when })
        : t("results.stale")
      : when
        ? t("results.savedAt", { when })
        : t("results.saved");
  return (
    <div className="flex flex-col gap-1 text-xs" data-result-state={state}>
      <p
        role="status"
        className={state === "stale" ? "rounded bg-amber-50 px-2 py-1 text-amber-900" : "text-slate-600"}
      >
        {text}
      </p>
      {state === "stale" && onRecalculate && (
        <button
          type="button"
          className="btn min-h-9 self-start text-sm"
          disabled={busy}
          onClick={onRecalculate}
        >
          {busy ? t("results.recalculating") : t("results.recalculate")}
        </button>
      )}
      {error && (
        <p role="alert" className="text-red-700">
          {t("results.saveFailed", { error })}
        </p>
      )}
    </div>
  );
}
