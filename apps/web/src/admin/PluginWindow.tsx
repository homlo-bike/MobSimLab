import { type ReactNode, useCallback, useState } from "react";
import { useI18n } from "../i18n/i18n";
import { Dialog } from "../shell/Dialog";
import { ExternalIcon } from "../shell/icons";
import { engineErrorText } from "../i18n/engine";

/** An outside service a plugin uses, linked at the bottom of its configure window. */
export interface ServiceLink {
  /** A product or service name: not translated. */
  label: string;
  url: string;
}

/**
 * Purpose: run an action of a plugin window and keep its error in the window, where the person sees it (the
 * Administration error line is behind the window). Output: `[run, error]`; `run` resolves to whether it worked.
 */
export function useWindowRun(): [(f: () => Promise<unknown>) => Promise<boolean>, string | null] {
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (f: () => Promise<unknown>) => {
    setError(null);
    try {
      await f();
      return true;
    } catch (e) {
      setError(engineErrorText(e));
      return false;
    }
  }, []);
  return [run, error];
}

/** A switch: on or off, at once. */
export function Switch({
  checked,
  label,
  disabled,
  onChange,
}: {
  checked: boolean;
  /** What the switch turns on, for screen readers. */
  label: string;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-blue-700" : "bg-slate-300"
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-[inset-inline-start] ${
          checked ? "start-6" : "start-1"
        }`}
      />
    </button>
  );
}

/**
 * The configure window of a plugin in Administration → Plugins: the plugin's name as the title, what it does, the
 * fields it needs (its own, as children), a button to accept the changes, and links to the outside services it
 * uses at the bottom.
 */
export function PluginWindow({
  title,
  intro,
  meta,
  error,
  busy,
  links,
  onAccept,
  onClose,
  children,
}: {
  title: string;
  /** What the plugin does. */
  intro: string;
  /** One short line under it: who made it, its version, how many projects use it. */
  meta?: string;
  error: string | null;
  busy?: boolean;
  links: readonly ServiceLink[];
  /** Save the changes; the window closes when it resolves to true. */
  onAccept: () => Promise<boolean>;
  onClose: () => void;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="flex flex-col gap-4 text-sm">
        <div className="flex flex-col gap-1">
          <p className="m-0 text-slate-700">{intro}</p>
          {meta && <p className="m-0 text-xs text-slate-500">{meta}</p>}
        </div>
        {children}
        {error && (
          <p role="alert" className="m-0 rounded-lg bg-red-50 px-3 py-2 text-red-800">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            className="btn btn-pri"
            disabled={busy}
            onClick={() =>
              void onAccept().then((ok) => {
                if (ok) onClose();
              })
            }
          >
            {t("padmin.accept")}
          </button>
        </div>
        {links.length > 0 && (
          <section aria-labelledby="pw-links" className="border-t border-slate-200 pt-3">
            <h3 id="pw-links" className="caps m-0">
              {t("padmin.services")}
            </h3>
            <ul className="m-0 mt-1 flex list-none flex-col p-0">
              {links.map((l) => (
                <li key={l.url}>
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-9 items-center gap-1.5 text-blue-700 underline-offset-2 hover:underline"
                  >
                    {l.label}
                    <ExternalIcon size={14} />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Dialog>
  );
}
