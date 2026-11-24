import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import { useI18n } from "../i18n/i18n";

/** A long job under way, for the bar at the bottom of the project. */
export interface RunningJob {
  /** What the job is (its name). */
  label: string;
  /** What it is doing now. */
  step: string;
  /** How far the whole job is, 0 to 1, or null when it cannot say. */
  overall: number | null;
}

interface Store {
  set: (key: string, owner: string, job: RunningJob | null) => void;
  jobs: { key: string; job: RunningJob }[];
}

const JobsContext = createContext<Store | null>(null);

/**
 * Purpose: collect the long jobs under way in a project (imports, runs, calculations), so the bar at the bottom of
 * the page shows them whichever tab or panel is open. One job may be reported by several parts of the page under
 * the same key (the Map data panel and the project's import watcher): it is shown once.
 */
export function JobsProvider({ children }: { children: ReactNode }) {
  const [byKey, setByKey] = useState<ReadonlyMap<string, ReadonlyMap<string, RunningJob>>>(new Map());
  const set = useCallback((key: string, owner: string, job: RunningJob | null) => {
    setByKey((prev) => {
      const owners = new Map(prev.get(key) ?? []);
      if (job) owners.set(owner, job);
      else if (!owners.delete(owner)) return prev;
      const next = new Map(prev);
      if (owners.size) next.set(key, owners);
      else next.delete(key);
      return next;
    });
  }, []);
  const jobs = useMemo(
    () => [...byKey].map(([key, owners]) => ({ key, job: [...owners.values()][0]! })),
    [byKey],
  );
  const store = useMemo(() => ({ set, jobs }), [set, jobs]);
  return <JobsContext.Provider value={store}>{children}</JobsContext.Provider>;
}

/** Purpose: the jobs under way, for the bottom bar; empty outside a project. */
export function useRunningJobs(): { key: string; job: RunningJob }[] {
  return useContext(JobsContext)?.jobs ?? [];
}

/**
 * Purpose: report a job under way to the bottom bar while `job` is set; it is taken off when `job` becomes null or
 * the component closes. `key` names the job, so two reports of the same job show once (default: this component).
 */
export function usePublishJob(job: RunningJob | null, key?: string): void {
  const set = useContext(JobsContext)?.set;
  const own = useId();
  const k = key ?? own;
  const label = job?.label;
  const step = job?.step;
  const overall = job?.overall;
  useEffect(() => {
    if (!set) return;
    set(k, own, label !== undefined ? { label, step: step ?? "", overall: overall ?? null } : null);
  }, [set, k, own, label, step, overall]);
  useEffect(() => {
    if (!set) return;
    return () => set(k, own, null);
  }, [set, k, own]);
}

/**
 * The bar at the bottom of a project while long jobs run (an import, a run): each job's name, what it is doing
 * and how far it is. Renders nothing while none runs.
 */
export function JobsBar() {
  const { t } = useI18n();
  const jobs = useRunningJobs();
  if (!jobs.length) return null;
  return (
    <div
      aria-label={t("job.running")}
      role="region"
      className="flex shrink-0 flex-col gap-1.5 border-t border-slate-200 bg-white px-4 py-2 text-xs"
    >
      {jobs.map(({ key, job }) => (
        <div key={key} className="flex items-center gap-3">
          <span className="min-w-0 flex-1 truncate text-slate-700">
            <b className="font-semibold">{job.label}</b> · {job.step}
          </span>
          <div
            role="progressbar"
            aria-label={job.label}
            aria-valuemin={0}
            aria-valuemax={100}
            {...(job.overall !== null ? { "aria-valuenow": Math.round(job.overall * 100) } : {})}
            aria-valuetext={job.step}
            className="relative h-1.5 w-40 shrink-0 overflow-hidden rounded-full bg-slate-200 sm:w-64"
          >
            {job.overall !== null ? (
              <div
                className="absolute inset-y-0 start-0 rounded-full bg-blue-700 transition-[width] duration-300"
                style={{ width: `${job.overall * 100}%` }}
              />
            ) : (
              <div
                className="job-sweep absolute inset-y-0 w-1/4 rounded-full bg-blue-400/70"
                aria-hidden="true"
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
