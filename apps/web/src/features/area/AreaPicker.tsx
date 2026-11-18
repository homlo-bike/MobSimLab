import { useEffect, useId, useState } from "react";
import { useI18n } from "../../i18n/i18n";
import { type Place, searchPlaces } from "../../map/places";
import { type AreaRegion, regionsAt } from "./api";

const km2 = (v: number) => (v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString());

/**
 * Purpose: a small outline drawing of regions (equirectangular, north up), so the planner sees what the area
 * covers before saving it.
 */
export function AreaOutline({ regions, label }: { regions: readonly AreaRegion[]; label: string }) {
  const pts = regions.flatMap((r) => r.ring);
  if (!pts.length) return null;
  const lat0 = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const kx = Math.cos((lat0 * Math.PI) / 180);
  const xs = pts.map((p) => p[0] * kx);
  const ys = pts.map((p) => -p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const w = Math.max(x1 - x0, 1e-6);
  const h = Math.max(y1 - y0, 1e-6);
  const pad = Math.max(w, h) * 0.04;
  return (
    <svg
      role="img"
      aria-label={label}
      className="mt-2 h-40 w-full rounded-lg border border-slate-200 bg-slate-50"
      viewBox={`${x0 - pad} ${y0 - pad} ${w + 2 * pad} ${h + 2 * pad}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {regions.map((r) => (
        <polygon
          key={r.id}
          points={r.ring.map(([lon, lat]) => `${lon * kx},${-lat}`).join(" ")}
          fill="#1d4ed8"
          fillOpacity={0.12}
          stroke="#1d4ed8"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

/**
 * Project area picker (#140): search a place, list the OpenStreetMap regions it lies in (neighbourhood to
 * state), and tick one or more. The project area is all the ticked regions together.
 */
export function AreaPicker({
  value,
  onChange,
  disabled = false,
  search = searchPlaces,
  lookUp = regionsAt,
}: {
  value: readonly AreaRegion[];
  onChange: (regions: AreaRegion[]) => void;
  disabled?: boolean;
  /** Place search (tests pass their own). */
  search?: typeof searchPlaces;
  /** The regions containing a point (tests pass their own). */
  lookUp?: typeof regionsAt;
}) {
  const { t, language } = useI18n();
  const id = useId();
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [found, setFound] = useState<AreaRegion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Places matching the text after a short pause.
  useEffect(() => {
    if (query.trim().length < 2 || place?.name === query) {
      setPlaces(null);
      return;
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      search(query, { lang: language, signal: ctl.signal })
        .then((p) => {
          setPlaces(p);
          setError(null);
        })
        .catch((e: unknown) => {
          if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [query, place, search, language]);

  const choose = (p: Place) => {
    setPlace(p);
    setQuery(p.name);
    setPlaces(null);
    setFound(null);
    setError(null);
    lookUp(p.lonLat)
      .then(setFound)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  const picked = (r: AreaRegion) => value.some((x) => x.id === r.id);
  const flip = (r: AreaRegion) => onChange(picked(r) ? value.filter((x) => x.id !== r.id) : [...value, r]);
  const total = value.reduce((s, r) => s + r.areaKm2, 0);

  return (
    <div>
      <div className="field">
        <input
          id={`${id}-q`}
          type="search"
          aria-label={t("area.search")}
          placeholder={t("area.search")}
          maxLength={200}
          disabled={disabled}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPlace(null);
          }}
          onKeyDown={(e) => {
            // Inside a form, Enter picks the first place instead of submitting.
            if (e.key === "Enter") {
              e.preventDefault();
              if (places?.[0]) choose(places[0]);
            }
          }}
        />
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {places && places.length > 0 && (
        <ul className="m-0 mt-1 list-none rounded-lg border border-slate-200 p-1">
          {places.slice(0, 6).map((p, i) => (
            <li key={`${p.lonLat.join()}-${i}`}>
              <button
                type="button"
                className="flex min-h-11 w-full flex-col items-start justify-center rounded-md px-2 text-start hover:bg-slate-50"
                onClick={() => choose(p)}
              >
                <span className="font-medium">{p.name}</span>
                {p.context && <span className="text-xs text-slate-500">{p.context}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {place && !found && !error && (
        <p role="status" className="mt-2 text-sm text-slate-600">
          {t("area.lookingUp", { place: place.name })}
        </p>
      )}
      {place && found && (
        <fieldset className="m-0 mt-2 border-0 p-0" disabled={disabled}>
          <legend className="text-xs text-slate-500">{t("area.regionsAt", { place: place.name })}</legend>
          {found.length === 0 ? (
            <p className="mt-1 text-sm text-slate-600">{t("area.noRegions")}</p>
          ) : (
            <ul className="m-0 mt-1 list-none p-0">
              {found.map((r) => (
                <li key={r.id}>
                  <label className="flex min-h-11 items-center gap-2 rounded-md px-2 hover:bg-slate-50">
                    <input type="checkbox" className="h-5 w-5" checked={picked(r)} onChange={() => flip(r)} />
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                    <span className="shrink-0 text-xs text-slate-500">
                      {r.kind}
                      {r.adminLevel ? ` ${r.adminLevel}` : ""} · {km2(r.areaKm2)} km²
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      )}
      {value.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">{t("area.none")}</p>
      ) : (
        <>
          <ul className="m-0 mt-2 flex list-none flex-wrap gap-2 p-0" aria-label={t("area.title")}>
            {value.map((r) => (
              <li key={r.id} className="chip flex items-center gap-1">
                {r.name}
                <button
                  type="button"
                  className="min-h-8 min-w-8 rounded-full hover:bg-slate-200"
                  aria-label={t("area.remove", { name: r.name })}
                  disabled={disabled}
                  onClick={() => onChange(value.filter((x) => x.id !== r.id))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-slate-500">{t("area.total", { area: km2(total) })}</p>
          <AreaOutline regions={value} label={t("area.outline")} />
        </>
      )}
    </div>
  );
}
