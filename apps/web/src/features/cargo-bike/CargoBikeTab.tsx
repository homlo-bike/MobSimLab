import { Marker, type Map as MapLibreMap, type MapMouseEvent } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { tNow, useI18n } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/messages";
import { currencyOf } from "../costs/currencies";
import { convertTo, type ProjectCurrency } from "../costs/currency";
import { countryName, economyApi, type EconomyApi } from "../costs/economy";
import type { StreetSetup } from "../street-setup/types";
import { JobProgress } from "../../shell/JobProgress";
import { cargoBikeEngine, type CargoBikeEngine, TripError } from "./engine";
import { amenityColour, classColour, clearCargoBike, drawCargoBike } from "./mapLayer";
import {
  AMENITY_REACH_M,
  type AmenityNear,
  type CargoBikeDoc,
  CLASSES,
  type Conversion,
  conversionFrom,
  isMoney,
  type Kit,
  kitValues,
  type LonLat,
  type ParamDefault,
  type Reach,
  type Route,
  type Savings,
  type Trip,
} from "./model";
import { engineErrorText } from "../../i18n/engine";
import { withUnit } from "../../i18n/units";

type View = "trip" | "range" | "savings";
type Pick = "start" | "destination" | null;

/** Parameters shown first, under "Bike, load and rider". */
const BIKE_KEYS = ["bike_mass_kg", "load_kg", "rider_mass_kg", "battery_wh", "motor_rated_w"];
/** Savings inputs shown above the table. */
const USE_KEYS = ["savings.trips_per_week", "savings.weeks_per_year"];
/** Values of the climate and health figures, shown apart from the prices. */
const IMPACT_KEYS = [
  "savings.fuel_co2_kg_l",
  "savings.grid_co2_kg_kwh",
  "savings.rider_efficiency",
  "savings.active_min_week_target",
];
/** Gaps and amenities listed at most. */
const LIST_MAX = 10;

const km = (m: number, digits = 1) => (m / 1000).toFixed(digits);
const pct = (x: number) => `${Math.round(x * 100)} %`;

function pinElement(label: string, dark: boolean): HTMLElement {
  const el = document.createElement("div");
  el.textContent = label;
  el.setAttribute("aria-label", label);
  Object.assign(el.style, {
    width: "30px",
    height: "30px",
    boxSizing: "border-box",
    borderRadius: "50%",
    background: dark ? "#14532d" : "#ffffff",
    color: dark ? "#ffffff" : "#14532d",
    border: "2px solid #14532d",
    font: "700 14px/26px system-ui, sans-serif",
    textAlign: "center",
    boxShadow: "0 1px 4px rgba(0,0,0,.35)",
    cursor: "grab",
  });
  return el;
}

function duration(s: number): string {
  const m = Math.round(s / 60);
  return m < 60 ? tNow("cb.minutes", { n: m }) : tNow("cb.hours", { h: Math.floor(m / 60), m: m % 60 });
}

/**
 * The cargo bike plugin's tab (plugins/cargo-bike): pick a start and a destination on the map, see the
 * round trip there and back with the battery it takes over the hills (preferring bike lanes), the range
 * map of how far the bike gets out and back in every direction, and what it saves against a car in the
 * prices of the start point's country. Values the project changes are kept in its "cargo-bike" drawing.
 */
export function CargoBikeTab({
  map,
  panel,
  doc,
  onDoc,
  setups,
  engine: engineIn,
  economy: economyIn,
  currency: projectCurrency = null,
}: {
  map: MapLibreMap | null;
  panel: HTMLElement | null;
  doc: CargoBikeDoc | null;
  /** Save the project's changes; absent for people who may only view the project. */
  onDoc?: (d: CargoBikeDoc) => void;
  setups: StreetSetup[];
  engine?: CargoBikeEngine;
  economy?: EconomyApi;
  /** The project's currency (Project preferences); null keeps the start point's country's. */
  currency?: ProjectCurrency | null;
}) {
  const { t, language } = useI18n();
  const engine = useMemo(() => engineIn ?? cargoBikeEngine(), [engineIn]);
  const economy = useMemo(() => economyIn ?? economyApi(), [economyIn]);
  const [view, setView] = useState<View>("trip");
  const [picking, setPicking] = useState<Pick>(null);
  const [defaults, setDefaults] = useState<Record<string, ParamDefault> | null>(null);
  // Points and values: the project's, or this session's for people who may only view.
  const [local, setLocal] = useState<CargoBikeDoc>(doc ?? {});
  useEffect(() => setLocal(doc ?? {}), [doc]);
  const start = local.start ?? null;
  const destination = local.destination ?? null;
  const values = useMemo(() => local.values ?? {}, [local.values]);
  // Year of the German reference prices (`savings.price_year`): the project's, else the plugin's.
  const priceYear = Math.round(
    values["savings.price_year"] ?? defaults?.["savings.price_year"]?.central ?? NaN,
  );
  const update = (d: CargoBikeDoc) => {
    setLocal(d);
    onDoc?.(d);
  };

  const [busy, setBusy] = useState<string | null>(null);
  // The trip under way (Cancel aborts it) and how many of its street areas have loaded.
  const tripRun = useRef<AbortController | null>(null);
  const [loaded, setLoaded] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trip, setTrip] = useState<{ trip: Trip; go: Route; back: Route } | null>(null);
  const [reach, setReach] = useState<Reach[] | null>(null);
  const [country, setCountry] = useState<{
    name: string | null;
    iso2?: string | null;
    currency: string | null;
    conv: Conversion | null;
    /** Units of the country's currency (EUR without a country) per US$, for the project's currency. */
    perUsd: number | null;
  }>({
    name: null,
    currency: null,
    conv: null,
    perUsd: null,
  });
  const [savings, setSavings] = useState<Savings | null>(null);
  const [amenities, setAmenities] = useState<AmenityNear[] | null>(null);
  const [amenityState, setAmenityState] = useState<"loading" | "failed" | null>(null);
  const [gap, setGap] = useState<LonLat[] | null>(null);
  const [kits, setKits] = useState<{ default: string; kits: Kit[] } | null>(null);

  useEffect(() => {
    engine.defaults().then(setDefaults, (e: unknown) => setError(String(e)));
    engine.kits().then(setKits, (e: unknown) => setError(String(e)));
  }, [engine]);

  // The country of the start point sets the currency and the price level of the savings.
  const startKey = start ? `${start[0].toFixed(3)},${start[1].toFixed(3)}` : "";
  useEffect(() => {
    if (!start || !Number.isFinite(priceYear)) return;
    let live = true;
    (async () => {
      try {
        const place = await economy.countryAt(start);
        if (!place.iso3) {
          if (live) setCountry({ name: null, currency: null, conv: null, perUsd: null });
          return;
        }
        const [mine, germany] = await Promise.all([
          economy.indicators(place.iso3, priceYear),
          economy.indicators("DEU", priceYear),
        ]);
        const conv = conversionFrom(mine, germany);
        if (live)
          setCountry({
            name: place.name,
            iso2: place.iso2,
            currency: currencyOf(place.iso3),
            conv,
            perUsd: conv ? (mine.fx?.value ?? null) : null,
          });
      } catch {
        if (live) setCountry({ name: null, currency: null, conv: null, perUsd: null });
      }
    })();
    return () => {
      live = false;
    };
  }, [economy, startKey, priceYear]);
  const localCurrency = country.conv ? (country.currency ?? "EUR") : "EUR";
  // German prices in the country's currency, then in the project's currency (Project preferences). Without
  // the country's prices the tab keeps German prices in EUR, as it says.
  const shown = convertTo(projectCurrency, localCurrency, country.perUsd);
  const currency = shown.currency ?? localCurrency;
  const conv = useMemo<Conversion | null>(() => {
    const c = country.conv;
    return c && shown.rate !== 1 ? { fx: c.fx * shown.rate, ppp: c.ppp * shown.rate } : c;
  }, [country.conv, shown.rate]);

  // The kit preset's values, in the start point's prices, with the project's own values on top.
  const kitId = local.kit ?? kits?.default ?? null;
  const kit = kits?.kits.find((k) => k.id === kitId);
  const kitVals = useMemo(() => kitValues(kit, defaults, conv), [kit, defaults, conv]);
  const effective = useMemo(() => ({ ...kitVals, ...values }), [kitVals, values]);

  // Savings follow the trip, the values and the country.
  useEffect(() => {
    if (!trip) {
      setSavings(null);
      return;
    }
    let live = true;
    const perTrip = {
      km: trip.trip.distance_m / 1000,
      whPerKm: trip.trip.wh_per_km,
      riderWh: trip.trip.rider_wh,
      timeS: trip.trip.time_s,
    };
    engine.savings(perTrip, effective, conv).then(
      (s) => live && setSavings(s),
      (e: unknown) => live && setError(String(e)),
    );
    return () => {
      live = false;
    };
  }, [engine, trip, effective, conv]);

  // Charging points and secure parkings along the trip, once it is ridden.
  useEffect(() => {
    setAmenities(null);
    setGap(null);
    if (!trip) return;
    let live = true;
    setAmenityState("loading");
    engine.amenities([...trip.go.coords, ...trip.back.coords]).then(
      (a) => {
        if (!live) return;
        setAmenities(a);
        setAmenityState(null);
      },
      () => live && setAmenityState("failed"),
    );
    return () => {
      live = false;
    };
  }, [engine, trip]);

  // Picking points on the map.
  const pickRef = useRef<Pick>(null);
  pickRef.current = picking;
  const localRef = useRef(local);
  localRef.current = local;
  useEffect(() => {
    if (!map) return;
    const onClick = (e: MapMouseEvent) => {
      const which = pickRef.current;
      if (!which) return;
      const p: LonLat = [e.lngLat.lng, e.lngLat.lat];
      const cur = localRef.current;
      if (which === "start") {
        update({ ...cur, start: p });
        setPicking(cur.destination ? null : "destination");
      } else {
        update({ ...cur, destination: p });
        setPicking(null);
      }
    };
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
  }, [map]);
  useEffect(() => {
    const canvas = map?.getCanvas?.();
    if (canvas) canvas.style.cursor = picking ? "crosshair" : "";
  }, [map, picking]);

  // Draggable start (S) and destination (D) markers.
  const markers = useRef<{ start?: Marker; destination?: Marker }>({});
  useEffect(() => {
    if (!map) return;
    for (const key of ["start", "destination"] as const) {
      const pos = key === "start" ? start : destination;
      const m = markers.current[key];
      if (!pos) {
        m?.remove();
        delete markers.current[key];
        continue;
      }
      if (m) {
        m.setLngLat(pos);
        continue;
      }
      const label = key === "start" ? t("cb.startPin") : t("cb.destinationPin");
      const nm = new Marker({ element: pinElement(label, key === "start"), draggable: true })
        .setLngLat(pos)
        .addTo(map);
      nm.on("dragend", () => {
        const ll = nm.getLngLat();
        update({ ...localRef.current, [key]: [ll.lng, ll.lat] });
      });
      markers.current[key] = nm;
    }
  }, [map, start, destination]);
  useEffect(
    () => () => {
      markers.current.start?.remove();
      markers.current.destination?.remove();
      markers.current = {};
      if (map) clearCargoBike(map);
    },
    [map],
  );
  useEffect(() => {
    if (map) drawCargoBike(map, trip, reach, { gap, amenities });
  }, [map, trip, reach, gap, amenities]);
  const showOnMap = (coords: LonLat[]) => {
    if (!map || coords.length === 0) return;
    const lons = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);
    map.fitBounds?.(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: 80, maxZoom: 17 },
    );
  };
  // A moved point makes the old answers wrong.
  const destKey = destination ? destination.join(",") : "";
  useEffect(() => setTrip(null), [startKey, destKey]);
  useEffect(() => setReach(null), [startKey]);

  const runTrip = async () => {
    if (!start || !destination) return;
    setError(null);
    const ctl = new AbortController();
    tripRun.current = ctl;
    setBusy(t("cb.loadingStreets", { done: 0, total: 0 }));
    setLoaded({ done: 0, total: 0 });
    try {
      const r = await engine.trip(
        start,
        destination,
        effective,
        setups,
        (done, total) => {
          setBusy(t("cb.loadingStreets", { done, total }));
          setLoaded({ done, total });
        },
        ctl.signal,
      );
      setTrip(r);
    } catch (e) {
      // Cancelled: nothing to report.
      if (ctl.signal.aborted) return;
      setError(
        e instanceof TripError && e.code !== "tiles"
          ? t(`cb.error.${e.code}` as MessageKey)
          : t("cb.error.failed", { error: engineErrorText(e) }),
      );
    } finally {
      tripRun.current = null;
      setLoaded(null);
      setBusy(null);
    }
  };
  const runRange = async () => {
    if (!start) return;
    setError(null);
    setBusy(t("cb.loadingTerrain"));
    try {
      setReach((await engine.rangeMap(start, effective)).reach);
    } catch (e) {
      setError(t("cb.error.failed", { error: engineErrorText(e) }));
    } finally {
      setBusy(null);
    }
  };

  const chooseKit = (id: string) => {
    const next = kits?.kits.find((k) => k.id === id);
    // The kit's own values replace what the project had set for the same keys.
    const own = Object.fromEntries(Object.entries(values).filter(([k]) => !(next && k in next.values)));
    update({ ...local, kit: id, values: own });
  };
  const kitLabel = (k: Kit) => {
    const key = `cb.kit.${k.id}` as MessageKey;
    const label = t(key);
    return label === key ? k.label : label;
  };
  const kitPicker = () =>
    kits &&
    defaults && (
      <div className="mt-3 rounded-xl border border-slate-200 px-3 py-2">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="font-semibold">{t("cb.kit")}</span>
          <select
            className="min-h-9 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 text-sm"
            value={kitId ?? ""}
            onChange={(e) => chooseKit(e.target.value)}
          >
            {kits.kits.map((k) => (
              <option key={k.id} value={k.id}>
                {kitLabel(k)}
              </option>
            ))}
          </select>
        </label>
        <p className="mt-1 text-xs text-slate-500">
          {t("cb.kitSummary", {
            battery: Math.round(effective.battery_wh ?? defaults.battery_wh?.central ?? 0),
            mass: Math.round(effective.bike_mass_kg ?? defaults.bike_mass_kg?.central ?? 0),
            price: money(
              effective["savings.bike_price_eur"] ??
                (defaults["savings.bike_price_eur"]?.central ?? 0) * (conv?.fx ?? 1),
            ),
          })}
        </p>
        <p className="mt-1 text-xs text-slate-500">{t("cb.kitNote")}</p>
      </div>
    );

  const setValue = (key: string, v: number | null) => {
    const next = { ...values };
    if (v === null || !Number.isFinite(v)) delete next[key];
    else next[key] = v;
    update({ ...local, values: next });
  };
  const resetValues = (keys: string[]) => {
    const next = { ...values };
    for (const k of keys) delete next[k];
    update({ ...local, values: next });
  };

  const money = (v: number) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(v);

  const field = (key: string, shown?: number) => {
    const d = defaults?.[key];
    if (!d) return null;
    const unit = isMoney(d) ? d.unit.replace("EUR", currency) : d.unit;
    const own = values[key];
    const value = own ?? shown ?? kitVals[key] ?? d.central;
    return (
      <label key={key} className="flex items-center justify-between gap-3 py-1">
        <span className="min-w-0 flex-1 text-sm text-slate-700">
          {d.label.replace(/ \(2024 EUR\)$/, "")}
          {own !== undefined && <span className="ms-1 text-xs text-blue-700">{t("cb.changed")}</span>}
        </span>
        <span className="flex items-center gap-1.5">
          <NumberField
            label={d.label}
            value={Number.isInteger(value) ? value : Number(value.toPrecision(4))}
            onCommit={(v) => setValue(key, v)}
          />
          <span className="w-16 text-xs text-slate-500">
            {unit === "share" || unit === "ratio" ? "" : unit}
          </span>
        </span>
      </label>
    );
  };
  const fieldGroup = (title: string, keys: string[], shown?: Record<string, number>) => (
    <details className="mt-3 rounded-xl border border-slate-200 px-3 py-2">
      <summary className="cursor-pointer text-sm font-semibold">{title}</summary>
      <div className="mt-1 divide-y divide-slate-100">{keys.map((k) => field(k, shown?.[k]))}</div>
      {keys.some((k) => values[k] !== undefined) && (
        <button type="button" className="btn mt-2 min-h-9 text-sm" onClick={() => resetValues(keys)}>
          {t("cb.reset")}
        </button>
      )}
    </details>
  );
  const allKeys = Object.keys(defaults ?? {});
  const modelKeys = allKeys.filter((k) => !k.startsWith("savings.") && !BIKE_KEYS.includes(k));
  const savingsKeys = allKeys.filter(
    (k) => k.startsWith("savings.") && !USE_KEYS.includes(k) && !IMPACT_KEYS.includes(k),
  );

  const gapsSection = (r: Trip) => {
    if (!trip) return null;
    const list = (["go", "back"] as const)
      .flatMap((dir) =>
        trip[dir].gaps.map((g) => ({ dir, g, coords: trip[dir].coords.slice(g.from, g.to + 1) })),
      )
      .sort((a, b) => b.g.length_m - a.g.length_m)
      .slice(0, LIST_MAX);
    const mixed = r.go.class_m[3] + r.back.class_m[3];
    return (
      <section aria-label={t("cb.gaps")} className="mt-4">
        <h3 className="text-sm font-semibold">{t("cb.gaps")}</h3>
        <p className="mt-1 text-sm text-slate-600">
          {list.length
            ? t("cb.gapsSummary", { km: km(mixed), share: pct(r.distance_m > 0 ? mixed / r.distance_m : 0) })
            : t("cb.noGaps")}
        </p>
        {list.length > 0 && (
          <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
            {list.map(({ dir, g, coords }) => (
              <li key={`${dir}-${g.from}`}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50"
                  onClick={() => {
                    setGap(coords);
                    showOnMap(coords);
                  }}
                >
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: classColour("mixed") }}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {g.name ?? t("cb.gapUnnamed", { highway: g.highway })}
                  </span>
                  <span className="text-xs text-slate-500">{t(dir === "go" ? "cb.go" : "cb.back")}</span>
                  <span className="w-16 text-end tabular-nums">{Math.round(g.length_m)} m</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  };

  const amenitySection = () => (
    <section aria-label={t("cb.amenities")} className="mt-4">
      <h3 className="text-sm font-semibold">{t("cb.amenities")}</h3>
      {amenityState === "loading" && (
        <p className="mt-1 text-sm text-slate-600">{t("cb.amenitiesLoading")}</p>
      )}
      {amenityState === "failed" && <p className="mt-1 text-sm text-slate-600">{t("cb.amenitiesFailed")}</p>}
      {amenities && amenities.length === 0 && (
        <p className="mt-1 text-sm text-slate-600">{t("cb.noAmenities", { m: AMENITY_REACH_M })}</p>
      )}
      {amenities && amenities.length > 0 && (
        <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {amenities.slice(0, LIST_MAX).map(({ amenity: a, offM, alongM }) => (
            <li key={a.id}>
              <button
                type="button"
                className="flex w-full items-start gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50"
                onClick={() => showOnMap([a.lonlat])}
              >
                <span
                  aria-hidden
                  className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: amenityColour(a.kind) }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {t(`cb.amenity.${a.kind}` as MessageKey)}
                    {a.name ? ` · ${a.name}` : ""}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {t("cb.amenityAt", { km: km(alongM), off: Math.round(offM) })}
                    {a.capacity ? ` · ${t("cb.amenityCapacity", { n: a.capacity })}` : ""}
                    {a.fee ? ` · ${t(a.fee === "no" ? "cb.amenityFree" : "cb.amenityFee")}` : ""}
                    {a.hours ? ` · ${a.hours}` : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-xs text-slate-500">{t("cb.amenitiesNote")}</p>
    </section>
  );

  const pointRow = (which: "start" | "destination", pos: LonLat | null) => (
    <div className="flex items-center gap-2 py-1">
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-green-900 text-xs font-bold ${which === "start" ? "bg-green-900 text-white" : "bg-white text-green-900"}`}
        aria-hidden="true"
      >
        {which === "start" ? t("cb.startPin") : t("cb.destinationPin")}
      </span>
      <span className="min-w-0 flex-1 text-sm">
        <span className="font-medium">{t(which === "start" ? "cb.start" : "cb.destination")}</span>
        <span className="block truncate text-xs text-slate-500">
          {pos ? `${pos[1].toFixed(5)}, ${pos[0].toFixed(5)}` : t("cb.notSet")}
        </span>
      </span>
      <button
        type="button"
        className={`btn min-h-9 text-sm ${picking === which ? "btn-pri" : ""}`}
        aria-pressed={picking === which}
        onClick={() => setPicking(picking === which ? null : which)}
      >
        {picking === which ? t("cb.clickMap") : t("cb.setOnMap")}
      </button>
    </div>
  );

  const tripView = () => {
    const r = trip?.trip;
    return (
      <div>
        <div className="mt-2 rounded-xl border border-slate-200 px-3 py-2">
          {pointRow("start", start)}
          {pointRow("destination", destination)}
        </div>
        <button
          type="button"
          className="btn btn-pri mt-3 w-full"
          disabled={!start || !destination || busy !== null}
          onClick={runTrip}
        >
          {t("cb.calculateTrip")}
        </button>
        {r && (
          <section aria-label={t("cb.tripResult")} className="mt-4">
            <p
              role="status"
              className={`rounded-xl px-3 py-2.5 text-sm font-medium ${r.feasible ? "bg-green-50 text-green-900" : "bg-red-50 text-red-900"}`}
            >
              {r.feasible
                ? t("cb.fits", { share: pct(r.battery_share), left: Math.round(r.remaining_wh) })
                : t("cb.runsOut", { share: pct(r.battery_share), missing: Math.round(-r.remaining_wh) })}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              {(
                [
                  ["cb.stat.roundTrip", withUnit(km(r.distance_m), "km")],
                  ["cb.stat.battery", `${Math.round(r.battery_wh)} / ${Math.round(r.usable_wh)} Wh`],
                  ["cb.stat.perKm", `${r.wh_per_km.toFixed(1)} Wh/km`],
                  ["cb.stat.time", duration(r.time_s)],
                  ["cb.stat.climb", withUnit(Math.round(r.go.climb_m + r.back.climb_m), "m")],
                  ["cb.stat.range", withUnit(Math.round(r.range_km), "km")],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="rounded-lg bg-slate-50 px-2.5 py-2">
                  <dt className="text-xs text-slate-500">{t(k)}</dt>
                  <dd className="font-semibold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-start text-xs text-slate-500">
                  <th className="py-1 text-start font-medium" />
                  <th className="py-1 text-end font-medium">km</th>
                  <th className="py-1 text-end font-medium">{t("cb.col.climb")}</th>
                  <th className="py-1 text-end font-medium">Wh</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {(["go", "back"] as const).map((k) => (
                  <tr key={k} className="border-t border-slate-100">
                    <th className="py-1 text-start font-medium">{t(k === "go" ? "cb.go" : "cb.back")}</th>
                    <td className="py-1 text-end">{km(r[k].distance_m)}</td>
                    <td className="py-1 text-end">{Math.round(r[k].climb_m)} m</td>
                    <td className="py-1 text-end">{Math.round(r[k].battery_wh)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <StreetMix trip={r} />
            <BatteryChart trip={r} />
            {gapsSection(r)}
            {amenitySection()}
            {r.go.steep_m + r.back.steep_m > 50 && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950">
                {t("cb.steep", {
                  m: Math.round(r.go.steep_m + r.back.steep_m),
                  grade: Math.round(Math.max(r.go.max_grade_pct, r.back.max_grade_pct)),
                })}
              </p>
            )}
            <p className="mt-2 text-xs text-slate-500">{t("cb.tripNote")}</p>
          </section>
        )}
      </div>
    );
  };

  const rangeView = () => {
    const sorted = reach ? [...reach].sort((a, b) => a.straight_m - b.straight_m) : [];
    const avg = sorted.length ? sorted.reduce((s, r) => s + r.straight_m, 0) / sorted.length : 0;
    return (
      <div>
        <p className="mt-2 text-sm text-slate-600">{t("cb.rangeIntro")}</p>
        <div className="mt-2 rounded-xl border border-slate-200 px-3 py-2">{pointRow("start", start)}</div>
        <button
          type="button"
          className="btn btn-pri mt-3 w-full"
          disabled={!start || busy !== null}
          onClick={runRange}
        >
          {t("cb.drawRange")}
        </button>
        {sorted.length > 0 && (
          <section aria-label={t("cb.rangeResult")} className="mt-4">
            <dl className="grid grid-cols-3 gap-2 text-sm">
              {(
                [
                  ["cb.range.shortest", sorted[0]!],
                  ["cb.range.average", null],
                  ["cb.range.longest", sorted[sorted.length - 1]!],
                ] as const
              ).map(([k, r]) => (
                <div key={k} className="rounded-lg bg-slate-50 px-2.5 py-2">
                  <dt className="text-xs text-slate-500">{t(k)}</dt>
                  <dd className="font-semibold tabular-nums">
                    {km(r ? r.straight_m : avg)} km
                    {r?.beyond ? "+" : ""}
                  </dd>
                  {r && (
                    <dd className="text-xs text-slate-500">
                      {t("cb.bearing", { deg: Math.round(r.bearing_deg) })}
                    </dd>
                  )}
                </div>
              ))}
            </dl>
            <p className="mt-2 text-xs text-slate-500">{t("cb.rangeNote")}</p>
          </section>
        )}
      </div>
    );
  };

  const savingsView = () => (
    <div>
      <p className="mt-2 text-sm text-slate-600">
        {conv
          ? t("cb.country", {
              country: country.name ? countryName({ iso2: country.iso2, name: country.name }, language) : "",
              currency,
            })
          : start
            ? t("cb.countryUnknown")
            : t("cb.countryNoStart")}
      </p>
      {!trip ? (
        <p className="mt-3 rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-700">
          {t("cb.savingsNeedsTrip")}
        </p>
      ) : (
        savings && (
          <section aria-label={t("cb.savingsTitle")}>
            <div className="mt-2">{USE_KEYS.map((k) => field(k))}</div>
            <p className="text-xs text-slate-500">
              {t("cb.kmPerYear", { km: Math.round(savings.km_per_year), trip: km(trip.trip.distance_m) })}
            </p>
            <p
              role="status"
              className="mt-3 rounded-xl bg-green-50 px-3 py-2.5 text-sm font-medium text-green-900"
            >
              {savings.saving_total >= 0
                ? t("cb.savesPerYear", { amount: money(savings.saving_total) })
                : t("cb.costsPerYear", { amount: money(-savings.saving_total) })}
            </p>
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500">
                  <th className="py-1 text-start font-medium">{t("cb.col.perYear")}</th>
                  <th className="py-1 text-end font-medium">{t("cb.col.car")}</th>
                  <th className="py-1 text-end font-medium">{t("cb.col.bike")}</th>
                  <th className="py-1 text-end font-medium">{t("cb.col.saving")}</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {savings.lines.map((l) => (
                  <tr key={l.id} className="border-t border-slate-100">
                    <th className="py-1 text-start font-medium">{t(`cb.line.${l.id}` as MessageKey)}</th>
                    <td className="py-1 text-end">{money(l.car)}</td>
                    <td className="py-1 text-end">{money(l.bike)}</td>
                    <td className={`py-1 text-end ${l.saving < 0 ? "text-red-700" : ""}`}>
                      {money(l.saving)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-300 font-semibold">
                  <th className="py-1 text-start">{t("cb.total")}</th>
                  <td className="py-1 text-end">{money(savings.car_total)}</td>
                  <td className="py-1 text-end">{money(savings.bike_total)}</td>
                  <td className="py-1 text-end">{money(savings.saving_total)}</td>
                </tr>
              </tbody>
            </table>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg bg-slate-50 px-2.5 py-2">
                <dt className="text-xs text-slate-500">{t("cb.payback")}</dt>
                <dd className="font-semibold tabular-nums">
                  {savings.payback_years === null
                    ? t("cb.never")
                    : t("cb.years", { n: savings.payback_years.toFixed(1) })}
                </dd>
              </div>
              <div className="rounded-lg bg-slate-50 px-2.5 py-2">
                <dt className="text-xs text-slate-500">
                  {t("cb.lifetime", { n: savings.values["savings.bike_lifetime_years"] ?? 0 })}
                </dt>
                <dd className="font-semibold tabular-nums">{money(savings.saving_lifetime)}</dd>
              </div>
              <div className="rounded-lg bg-slate-50 px-2.5 py-2">
                <dt className="text-xs text-slate-500">{t("cb.fuel")}</dt>
                <dd className="font-semibold tabular-nums">{Math.round(savings.fuel_l_per_year)} l</dd>
              </div>
              <div className="rounded-lg bg-slate-50 px-2.5 py-2">
                <dt className="text-xs text-slate-500">{t("cb.electricity")}</dt>
                <dd className="font-semibold tabular-nums">
                  {Math.round(savings.electricity_kwh_per_year)} kWh
                </dd>
              </div>
            </dl>
            <section aria-label={t("cb.impact")} className="mt-4">
              <h3 className="text-sm font-semibold">{t("cb.impact")}</h3>
              <p className="mt-1 rounded-xl bg-green-50 px-3 py-2.5 text-sm font-medium text-green-900">
                {t("cb.co2Saved", { kg: Math.round(savings.impact.co2_saved_kg) })}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {t("cb.co2Detail", {
                  car: Math.round(savings.impact.car_co2_kg),
                  bike: Math.round(savings.impact.bike_co2_kg),
                })}
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg bg-slate-50 px-2.5 py-2">
                  <dt className="text-xs text-slate-500">{t("cb.kcalTrip")}</dt>
                  <dd className="font-semibold tabular-nums">
                    {Math.round(savings.impact.kcal_per_trip)} kcal
                  </dd>
                </div>
                <div className="rounded-lg bg-slate-50 px-2.5 py-2">
                  <dt className="text-xs text-slate-500">{t("cb.kcalYear")}</dt>
                  <dd className="font-semibold tabular-nums">
                    {Math.round(savings.impact.kcal_per_year).toLocaleString()} kcal
                  </dd>
                </div>
                <div className="col-span-2 rounded-lg bg-slate-50 px-2.5 py-2">
                  <dt className="text-xs text-slate-500">{t("cb.activeWeek")}</dt>
                  <dd className="font-semibold tabular-nums">
                    {t("cb.minutes", { n: Math.round(savings.impact.active_min_per_week) })}
                  </dd>
                  <dd className="text-xs text-slate-500">
                    {t("cb.activeOfTarget", {
                      share: pct(savings.impact.active_share),
                      target: savings.values["savings.active_min_week_target"] ?? 150,
                    })}
                  </dd>
                </div>
              </dl>
            </section>
            {fieldGroup(t("cb.prices"), savingsKeys, savings.values)}
            {fieldGroup(t("cb.impactValues"), IMPACT_KEYS, savings.values)}
            <p className="mt-2 text-xs text-slate-500">{t("cb.savingsNote", { year: priceYear })}</p>
          </section>
        )
      )}
    </div>
  );

  const body = (
    <div className="px-4 pt-3 pb-5 md:px-5 md:pt-5">
      <h2 className="text-lg font-semibold">{t("cb.title")}</h2>
      <p className="mt-1 text-sm text-slate-600">{t("cb.intro")}</p>
      <div className="seg mt-3" role="tablist" aria-label={t("cb.title")}>
        {(["trip", "range", "savings"] as const).map((v) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}>
            {t(`cb.view.${v}` as MessageKey)}
          </button>
        ))}
      </div>
      {kitPicker()}
      {view === "trip" && tripView()}
      {view === "range" && rangeView()}
      {view === "savings" && savingsView()}
      {busy && loaded ? (
        // A trip: its street areas as a bar (step 1), then the route and heights (step 2), and Cancel.
        <div className="mt-3">
          <JobProgress
            label={t("cb.calculateTrip")}
            step={busy}
            index={loaded.total > 0 && loaded.done >= loaded.total ? 2 : 1}
            steps={2}
            fraction={loaded.total > 0 && loaded.done < loaded.total ? loaded.done / loaded.total : null}
            onCancel={() => tripRun.current?.abort()}
          />
        </div>
      ) : (
        busy && (
          <p role="status" className="mt-3 text-sm text-slate-600">
            {busy}
          </p>
        )
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">
          {error}
        </p>
      )}
      {view !== "savings" && defaults && (
        <>
          {fieldGroup(t("cb.bikeAndRider"), BIKE_KEYS)}
          {fieldGroup(t("cb.model"), modelKeys)}
        </>
      )}
      {!onDoc && <p className="mt-3 text-xs text-slate-500">{t("cb.viewOnly")}</p>}
    </div>
  );
  return panel ? createPortal(body, panel) : body;
}

/** Purpose: the trip's metres per kind of street, as a bar with a legend. */
function StreetMix({ trip }: { trip: Trip }) {
  const { t } = useI18n();
  const m = CLASSES.map((_, i) => trip.go.class_m[i]! + trip.back.class_m[i]!);
  const total = m.reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="mt-3">
      <p className="text-xs font-medium text-slate-500">{t("cb.streetMix")}</p>
      <div className="mt-1 flex h-3 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        {CLASSES.map((c, i) => (
          <span key={c} style={{ width: `${(100 * m[i]!) / total}%`, background: classColour(c) }} />
        ))}
      </div>
      <ul className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-slate-700">
        {CLASSES.map((c, i) => (
          <li key={c} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: classColour(c) }} />
            {t(`cb.class.${c}` as MessageKey)} {pct(m[i]! / total)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Purpose: battery left and height along the round trip (there, then back). */
function BatteryChart({ trip }: { trip: Trip }) {
  const { t } = useI18n();
  const goLen = trip.go.distance_m;
  const goWh = trip.go.battery_wh;
  const pts = [
    ...trip.go.profile.map(([d, z, wh]) => [d, z, wh] as const),
    ...trip.back.profile.map(([d, z, wh]) => [goLen + d, z, goWh + wh] as const),
  ];
  if (pts.length < 2) return null;
  const W = 320;
  const H = 110;
  const maxD = pts[pts.length - 1]![0] || 1;
  const zs = pts.map((p) => p[1]);
  const zMin = Math.min(...zs);
  const zMax = Math.max(...zs, zMin + 10);
  const usable = trip.usable_wh || 1;
  const x = (d: number) => (d / maxD) * W;
  const yZ = (z: number) => H - 8 - ((z - zMin) / (zMax - zMin)) * (H * 0.45);
  const yB = (wh: number) => 6 + (Math.min(1.2, wh / usable) / 1.2) * (H - 14);
  const ground = `M0,${H} ${pts.map((p) => `L${x(p[0]).toFixed(1)},${yZ(p[1]).toFixed(1)}`).join(" ")} L${W},${H} Z`;
  const battery = pts.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${yB(p[2]).toFixed(1)}`).join(" ");
  return (
    <figure className="mt-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t("cb.chartAria")}>
        <path d={ground} fill="var(--diagram-ground, #e2e8f0)" />
        <line x1={x(goLen)} x2={x(goLen)} y1={0} y2={H} stroke="#94a3b8" strokeDasharray="3 3" />
        <line x1={0} x2={W} y1={yB(usable)} y2={yB(usable)} stroke="#dc2626" strokeDasharray="4 3" />
        <path d={battery} fill="none" stroke="#15803d" strokeWidth={2} />
      </svg>
      <figcaption className="text-xs text-slate-500">
        {t("cb.chartLegend", { min: Math.round(zMin), max: Math.round(zMax) })}
      </figcaption>
    </figure>
  );
}

/** Purpose: a number typed freely and taken on Enter or when leaving the field; empty resets it. */
function NumberField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (v: number | null) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const commit = (raw: string) => {
    setText(null);
    if (raw.trim() === "") return onCommit(null);
    const n = Number(raw.replace(",", "."));
    if (Number.isFinite(n) && n >= 0) onCommit(n);
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      value={text ?? String(value)}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
      }}
      className="w-24 rounded border border-slate-300 px-1.5 py-1 text-end"
    />
  );
}
