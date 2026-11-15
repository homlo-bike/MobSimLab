/**
 * The pop-up of a station on the network map (ADR-0041 §7): its stops and platforms, the lines that call
 * there (each opens its strip map), the features recorded in the Create tab, and the planner's choices for the
 * diagram: special status, name place and name rotation. It closes with Esc, a click outside or ×.
 */
import { type CSSProperties, useEffect, useRef } from "react";
import { useI18n } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/messages";
import { STATION_STATUSES, SymbolIcon, SymbolPicker, symbolLabel } from "../stations/features";
import { ROTATIONS, type SchematicDoc, textOn } from "./common";
import { linesAt, type SchematicNetwork } from "./lines";
import { LABEL_DIRS } from "./paths";

export function StationPopup({
  net,
  station,
  doc,
  onDoc,
  onClose,
  onLine,
  style,
}: {
  net: SchematicNetwork;
  station: number;
  doc: SchematicDoc;
  /** Absent: view only. */
  onDoc?: (patch: Partial<SchematicDoc>) => void;
  onClose: () => void;
  /** Opens a line's strip map. */
  onLine: (id: string) => void;
  style: CSSProperties;
}) {
  const { t, tn } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const st = net.stations[station]!;
  const here = linesAt(net, station);
  const platforms = st.parts.reduce((a, p) => a + (p.platforms ?? 0), 0);
  const features = [...new Set(st.parts.flatMap((p) => p.features))];
  const statuses = doc.statuses?.[st.key] ?? [];

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const down = (e: PointerEvent) => {
      const el = e.target as Element | null;
      // A click on another station selects that one instead; the map handles it.
      if (ref.current?.contains(el) || el?.closest?.("[data-station]")) return;
      onClose();
    };
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", down);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", down);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={st.name}
      className="absolute z-20 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3.5 text-sm shadow-lg"
      style={style}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="caps">{t("schematic.station")}</p>
          <h2 className="text-lg leading-tight font-semibold">{st.name}</h2>
        </div>
        <button type="button" className="icon-btn" aria-label={t("common.close")} onClick={onClose}>
          ×
        </button>
      </div>
      <dl className="grid grid-cols-2 gap-2">
        <div>
          <dt className="text-xs text-slate-500">{t("schematic.popup.stops")}</dt>
          <dd className="font-semibold">{st.parts.length}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">{t("schematic.popup.platforms")}</dt>
          <dd className="font-semibold">{platforms > 0 ? platforms : t("schematic.unknown")}</dd>
        </div>
      </dl>
      <div>
        <p className="mb-1.5 text-xs text-slate-500">{tn("schematic.popup.lines", here.length)}</p>
        <div className="flex flex-wrap gap-1.5">
          {here.map((l) => (
            <button
              key={l.id}
              type="button"
              className="rounded-full px-2.5 py-0.5 text-xs font-bold"
              style={{ background: l.color, color: textOn(l.color) }}
              title={t("schematic.openStrip", { line: l.name })}
              onClick={() => onLine(l.id)}
            >
              {l.name}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-xs text-slate-500">{t("schematic.popup.features")}</p>
        {features.length ? (
          <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
            {features.map((f) => (
              <li key={f} className="flex items-center gap-1.5">
                <SymbolIcon id={f} size={18} />
                {t(symbolLabel(f))}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-slate-600">{t("schematic.popup.noFeatures")}</p>
        )}
      </div>
      {onDoc ? (
        <>
          <div>
            <p className="mb-1.5 text-xs text-slate-500">{t("schematic.popup.status")}</p>
            <SymbolPicker
              options={STATION_STATUSES}
              value={statuses}
              label={t("schematic.popup.status")}
              t={t}
              onChange={(next) => {
                const all = { ...(doc.statuses ?? {}) };
                if (next.length) all[st.key] = next;
                else delete all[st.key];
                onDoc({ statuses: all });
              }}
            />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-32 flex-1 flex-col gap-1">
              <span className="text-xs text-slate-500">{t("schematic.label")}</span>
              <span className="field">
                <select
                  value={doc.labels[st.key] ?? "auto"}
                  onChange={(e) => {
                    const labels = { ...doc.labels };
                    if (e.target.value === "auto") delete labels[st.key];
                    else labels[st.key] = Number(e.target.value);
                    onDoc({ labels });
                  }}
                >
                  <option value="auto">{t("schematic.label.auto")}</option>
                  {LABEL_DIRS.map((_, k) => (
                    <option key={k} value={k}>
                      {t(`schematic.label.${k}` as MessageKey)}
                    </option>
                  ))}
                </select>
              </span>
            </label>
            <label className="flex min-w-24 flex-col gap-1">
              <span className="text-xs text-slate-500">{t("schematic.rotate")}</span>
              <span className="field">
                <select
                  value={doc.rotate?.[st.key] ?? 0}
                  onChange={(e) => {
                    const rotate = { ...(doc.rotate ?? {}) };
                    const v = Number(e.target.value);
                    if (v) rotate[st.key] = v;
                    else delete rotate[st.key];
                    onDoc({ rotate });
                  }}
                >
                  {ROTATIONS.map((r) => (
                    <option key={r} value={r}>
                      {r === 0 ? t("schematic.rotate.none") : `${r}°`}
                    </option>
                  ))}
                </select>
              </span>
            </label>
          </div>
          {st.key in doc.pins && (
            <button
              type="button"
              className="btn self-start"
              onClick={() => {
                const pins = { ...doc.pins };
                delete pins[st.key];
                onDoc({ pins });
              }}
            >
              {t("schematic.unpin")}
            </button>
          )}
        </>
      ) : (
        statuses.length > 0 && (
          <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
            {statuses.map((s) => (
              <li key={s} className="flex items-center gap-1.5">
                <SymbolIcon id={s} size={18} />
                {t(symbolLabel(s))}
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
