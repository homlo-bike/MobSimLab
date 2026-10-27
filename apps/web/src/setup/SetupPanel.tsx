import { type FormEvent, useState } from "react";
import { send } from "../session/api";

/**
 * Setup wizard, first step: instance name, then Finish setup (05 §3.1). Shown to the Owner while the
 * instance is in setup mode. Later steps (providers, groups, basemaps, defaults) are added here.
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
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const finish = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await send("PUT", "/api/setup/instance", csrfToken, { name: value });
      await send("POST", "/api/setup/finish", csrfToken);
      onFinished();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label="Setup"
      className="absolute top-4 left-4 z-10 w-80 rounded border border-slate-300 bg-white p-4 text-sm shadow"
    >
      <h2 className="mb-2 font-semibold">Set up this instance</h2>
      <p className="mb-3 text-slate-600">
        You are the Owner. Other people cannot sign in until you finish setup.
      </p>
      <form onSubmit={(e) => void finish(e)} className="flex flex-col gap-2">
        <label className="flex flex-col gap-1">
          Instance name
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
          className="rounded bg-slate-800 px-2 py-1 text-white disabled:opacity-50"
        >
          Finish setup
        </button>
      </form>
    </section>
  );
}
