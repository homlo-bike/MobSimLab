import { useI18n } from "../i18n/i18n";

/**
 * A long job under way: what it is doing now, a bar (filled as far as the step is when that is known,
 * moving otherwise), the step number, and Cancel. An optional second button lets the job go on without
 * what it waits for.
 */
export function JobProgress({
  label,
  step,
  index,
  steps,
  fraction,
  onCancel,
  skipLabel,
  onSkip,
}: {
  /** The job's name, for screen readers. */
  label: string;
  step: string;
  /** This step's number, from 1, of `steps`. */
  index: number;
  steps: number;
  /** How far this step is, 0 to 1, or null when it cannot say. */
  fraction: number | null;
  onCancel: () => void;
  skipLabel?: string;
  onSkip?: () => void;
}) {
  const { t } = useI18n();
  // The whole job: the steps done, plus as far as this one is (half way when it cannot say).
  const overall = Math.min(1, Math.max(0, (index - 1 + (fraction ?? 0.5)) / Math.max(steps, 1)));
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span role="status" className="min-w-0 text-slate-700">
          {step}
        </span>
        <span className="shrink-0 text-slate-500 tabular-nums">
          {t("job.stepOf", { step: index, steps })}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(overall * 100)}
        aria-valuetext={`${t("job.stepOf", { step: index, steps })}: ${step}`}
        className="relative h-1.5 overflow-hidden rounded-full bg-slate-200"
      >
        <div
          className="absolute inset-y-0 start-0 rounded-full bg-blue-700 transition-[width] duration-300"
          style={{ width: `${overall * 100}%` }}
        />
        {fraction === null && (
          <div
            className="job-sweep absolute inset-y-0 w-1/4 rounded-full bg-blue-400/70"
            aria-hidden="true"
          />
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {skipLabel && onSkip && (
          <button type="button" className="btn min-h-9 text-xs" onClick={onSkip}>
            {skipLabel}
          </button>
        )}
        <button type="button" className="btn min-h-9 text-xs" onClick={onCancel}>
          {t("job.cancel")}
        </button>
      </div>
    </div>
  );
}
