import { clock } from "../journey-planner/format";
import { useI18n } from "../../i18n/i18n";
import { isVerdict, STATUS_TONE, verdictText } from "./capacityText";
import { isOpen, type SavedRun, type SavedRunDetail } from "./server";

/** Purpose: the project's runs saved on the server; one opens in the panel. */
export function SavedRunsList({
  saved,
  viewing,
  open,
  when,
}: {
  saved: SavedRun[];
  viewing: SavedRunDetail | null;
  open: (id: string) => Promise<void>;
  when: (iso: string) => string;
}) {
  const { t } = useI18n();
  return (
    <section aria-label={t("capacity.saved")} className="space-y-1.5">
      <h3 className="caps">{t("capacity.saved")}</h3>
      {saved.length === 0 ? (
        <p className="text-xs text-slate-600">{t("capacity.savedNone")}</p>
      ) : (
        <ul className="space-y-1.5">
          {saved.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                aria-current={viewing?.id === r.id ? "true" : undefined}
                className={`w-full rounded-[10px] border px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                  viewing?.id === r.id ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-white"
                }`}
                onClick={() => void open(r.id)}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {clock(r.params.from_s)}–{clock(r.params.to_s)} ·{" "}
                    {r.network.kind === "example" ? t("capacity.example") : r.network.topologyName}
                  </span>
                  <span className={`tag border ${STATUS_TONE[r.status]}`}>
                    {r.status === "done" && isVerdict(r.verdict)
                      ? verdictText(r.verdict, t).title
                      : t(`capacity.status.${r.status}`)}
                  </span>
                </span>
                <span className="block text-xs text-slate-500">
                  {t("capacity.savedBy", {
                    who: r.createdBy?.displayName ?? t("capacity.someone"),
                    when: when(r.createdAt),
                  })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Purpose: the bar over an open saved run: its status, stop, run again, delete (asked first), close. */
export function SavedRunBar({
  viewing,
  canRun,
  confirmDelete,
  setConfirmDelete,
  close,
  cancelSaved,
  rerunSaved,
  deleteSaved,
  when,
}: {
  viewing: SavedRunDetail;
  canRun: boolean;
  confirmDelete: boolean;
  setConfirmDelete: (v: boolean) => void;
  close: () => void;
  cancelSaved: () => Promise<void>;
  rerunSaved: () => Promise<void>;
  deleteSaved: () => Promise<void>;
  when: (iso: string) => string;
}) {
  const { t } = useI18n();
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
        <span>
          {t("capacity.viewing", { when: when(viewing.createdAt) })}{" "}
          <span className={`tag border ${STATUS_TONE[viewing.status]}`}>
            {t(`capacity.status.${viewing.status}`)}
          </span>
        </span>
        <span className="flex gap-2">
          {isOpen(viewing) && canRun && !viewing.cancelRequested && (
            <button type="button" className="btn" onClick={() => void cancelSaved()}>
              {t("capacity.stop")}
            </button>
          )}
          {!isOpen(viewing) && canRun && (
            <button type="button" className="btn" onClick={() => void rerunSaved()}>
              {t("capacity.runAgain")}
            </button>
          )}
          {canRun && (
            <button type="button" className="btn" onClick={() => setConfirmDelete(true)}>
              {t("capacity.delete")}
            </button>
          )}
          <button type="button" className="btn" onClick={close}>
            {t("capacity.close")}
          </button>
        </span>
      </div>
      {confirmDelete && (
        <div
          role="alertdialog"
          aria-label={t("capacity.deleteAsk")}
          className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
        >
          <span>{t("capacity.deleteAsk")}</span>
          <span className="flex gap-2">
            <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
              {t("capacity.keep")}
            </button>
            <button type="button" className="btn btn-danger" onClick={() => void deleteSaved()}>
              {t("capacity.delete")}
            </button>
          </span>
        </div>
      )}
      {viewing.status === "cancelled" && viewing.result && (
        <p className="text-xs text-slate-600">{t("capacity.stoppedEarly")}</p>
      )}
    </>
  );
}
