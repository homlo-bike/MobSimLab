import type { Map as MapLibreMap } from "maplibre-gl";
import { afterEach, describe, expect, it } from "vitest";
import {
  basemapLabels,
  featuresFromLabels,
  labelCategory,
  type LonLat,
  type NameFeature,
  preferTransitKind,
} from "../src/features/naming/labels";
import {
  distanceToPlaceM,
  groupOf,
  nameForNewPlace,
  type NamedPlace,
  normaliseName,
  renamePlace,
  STATION_GROUPING_M,
  suggestNames,
  uniqueName,
} from "../src/features/naming/names";
import { clearPlaces, placesOtherThan, publishPlaces } from "../src/features/naming/registry";

const at: LonLat = [13.4, 52.52];
/** A point `east` and `north` metres from `at`. */
const m = (east: number, north = 0): LonLat => [
  at[0] + east / (111_320 * Math.cos((at[1] * Math.PI) / 180)),
  at[1] + north / 111_320,
];
const label = (sourceLayer: string, properties: Record<string, unknown>, coordinates: LonLat[] = [at]) => ({
  sourceLayer,
  properties,
  coordinates,
});
const feature = (category: NameFeature["category"], name: string, east: number): NameFeature => ({
  id: `${category}/${name}`,
  category,
  name,
  names: {},
  lonlat: m(east),
});
const place = (id: string, name: string, east: number, extra: Partial<NamedPlace> = {}): NamedPlace => ({
  id,
  name,
  lonlat: m(east),
  ...extra,
});

describe("basemap labels", () => {
  it("maps OpenMapTiles layers to name categories", () => {
    expect(labelCategory(label("poi", { class: "railway", subclass: "station" }))).toBe("transit_station");
    expect(labelCategory(label("poi", { class: "bus", subclass: "bus_stop" }))).toBe("transit_station");
    expect(labelCategory(label("poi", { class: "museum" }))).toBe("landmark");
    expect(labelCategory(label("poi", { class: "shop" }))).toBe("facility");
    expect(labelCategory(label("place", { class: "suburb" }))).toBe("district");
    expect(labelCategory(label("place", { class: "city" }))).toBeNull();
    expect(labelCategory(label("transportation_name", { class: "primary" }))).toBe("major_street");
    expect(labelCategory(label("transportation_name", { class: "minor" }))).toBe("street");
    expect(labelCategory(label("transportation_name", { class: "path" }))).toBeNull();
    expect(labelCategory(label("water_name", {}))).toBeNull();
  });

  it("prefers a station label over a district or street and qualifies it with the district", () => {
    const features = featuresFromLabels(
      [
        label("transportation_name", { class: "primary", name: "Hauptstraße" }, [m(-70), m(35)]),
        label("place", { class: "suburb", name: "Mitte" }, [m(70, 70)]),
        label("poi", { class: "railway", subclass: "station", name: "Alexanderplatz", "name:en": "Alex" }, [
          m(80),
        ]),
        label("poi", { class: "railway", subclass: "station", name: "Alexanderplatz" }, [m(80)]),
        label("poi", { class: "railway" }),
      ],
      at,
    );
    expect(features).toHaveLength(3);
    // A street is placed at its vertex nearest to the stop.
    expect(features.find((f) => f.category === "major_street")!.lonlat).toEqual(m(35));
    const [best] = suggestNames(at, features);
    expect(best!.name).toBe("Alexanderplatz");
    expect(best!.qualifier).toBe("Mitte");
    expect(suggestNames(at, features, { language: "en" })[0]!.name).toBe("Alex");
  });

  it("takes a rail station's label for a station and a bus stop's for a stop", () => {
    const features = featuresFromLabels(
      [
        label("poi", { class: "bus", subclass: "bus_stop", name: "Bus stop" }),
        label("poi", { class: "railway", subclass: "station", name: "Rail station" }, [m(100)]),
      ],
      at,
    );
    expect(suggestNames(at, preferTransitKind(features, "rail"))[0]!.name).toBe("Rail station");
    expect(suggestNames(at, preferTransitKind(features, "bus"))[0]!.name).toBe("Bus stop");
  });

  it("reads labels from the loaded vector tiles near the point, and nothing from a map without them", () => {
    const map = {
      getStyle: () => ({ sources: { openmaptiles: { type: "vector" }, sat: { type: "raster" } } }),
      querySourceFeatures: (_: string, o: { sourceLayer: string }) =>
        o.sourceLayer === "poi"
          ? [
              {
                geometry: { type: "Point", coordinates: m(50) },
                properties: { class: "museum", name: "Near" },
              },
              {
                geometry: { type: "Point", coordinates: m(2000) },
                properties: { class: "museum", name: "Far" },
              },
            ]
          : [],
    } as unknown as MapLibreMap;
    expect(basemapLabels(map, at).map((l) => l.properties.name)).toEqual(["Near"]);
    expect(basemapLabels({} as MapLibreMap, at)).toEqual([]);
    expect(basemapLabels(null, at)).toEqual([]);
  });
});

describe("name suggestions", () => {
  it("ranks station, landmark, district, facility, intersection, major street, street, place", () => {
    const list = suggestNames(at, [
      feature("street", "Elm Street", 20),
      feature("place", "Old Square", 30),
      feature("major_street", "Main Street", 25),
      feature("facility", "City Hospital", 300),
      feature("district", "Northside", 200),
      feature("landmark", "Opera House", 400),
      feature("transit_station", "Central", 450),
    ]);
    expect(list.map((s) => s.name)).toEqual([
      "Central",
      "Opera House",
      "Northside",
      "City Hospital",
      "Elm Street / Main Street",
      "Main Street",
      "Elm Street",
      "Old Square",
    ]);
  });

  it("offers nothing farther than 500 m", () => {
    expect(suggestNames(at, [feature("landmark", "Far Tower", 900)])).toEqual([]);
  });
});

describe("unique names and station groups", () => {
  it("compares names as rail-model does: case, accents and spacing ignored", () => {
    expect(normaliseName("  Málaga-María  Zambrano ")).toBe(normaliseName("malaga maria zambrano"));
  });

  it("measures to a station's platform, not only its centre", () => {
    const st = place("rail:1", "Long", 0, { halfLengthM: 200, rotationDeg: 0 });
    expect(distanceToPlaceM(m(250), st)).toBeCloseTo(50, 0);
    expect(distanceToPlaceM(m(0, 100), st)).toBeCloseTo(100, 0);
  });

  it("joins a stop or station nearby and takes its name", () => {
    const places = [place("rail:1", "Harbour", 0), place("street:2", "Market", 1000)];
    const c = nameForNewPlace(m(STATION_GROUPING_M - 10), {
      places,
      features: [feature("landmark", "Opera House", 120)],
      fallback: "Stop 3",
    });
    expect(c).toMatchObject({ name: "Harbour", reason: "joined" });
  });

  it("names a place with nothing nearby from the map, and never reuses a name used far away", () => {
    const places = [place("street:1", "Opera House", 2000)];
    const features = [feature("landmark", "Opera House", 50), feature("street", "Elm Street", 20)];
    const c = nameForNewPlace(at, { places, features, fallback: "Stop 2" });
    // The best suggestion is taken, so the next free one wins.
    expect(c).toMatchObject({ name: "Elm Street", reason: "suggested" });
    // All taken: the best one with its qualifier, then a number.
    const taken = [...places, place("street:3", "Elm Street", 3000)];
    expect(nameForNewPlace(at, { places: taken, features, fallback: "Stop 2" }).name).toBe(
      "Opera House (Elm Street)",
    );
    expect(nameForNewPlace(at, { places, features: [], fallback: "Opera House" })).toMatchObject({
      name: "Opera House 2",
      reason: "fallback",
    });
  });

  it("allows only the same stop or station to share a name", () => {
    const places = [place("a", "Harbour", 0), place("b", "Harbour", 100), place("c", "Market", 3000)];
    expect(uniqueName("Market", places, new Set(["a", "b"]))).toBe("Market 2");
    expect(uniqueName("Harbour", places, new Set(["a", "b"]))).toBe("Harbour");
  });

  it("groups chains of neighbours as one stop or station", () => {
    const places = [place("a", "A", 0), place("b", "B", 140), place("c", "C", 280), place("d", "D", 600)];
    expect(
      groupOf("a", places, STATION_GROUPING_M)
        .map((p) => p.id)
        .sort(),
    ).toEqual(["a", "b", "c"]);
  });

  it("renames the whole group and numbers a name used by a place farther away", () => {
    const places = [place("a", "Harbour", 0), place("b", "Harbour", 80), place("c", "Market", 2500)];
    expect(renamePlace("a", "Quay", places)).toEqual({ name: "Quay", members: ["a", "b"] });
    const r = renamePlace("a", "market", places);
    expect(r.name).toBe("market 2");
    expect(r.clash).toMatchObject({ wanted: "market", distanceM: 2500 });
    expect(r.clash!.with.id).toBe("c");
  });
});

describe("place registry", () => {
  afterEach(clearPlaces);

  it("lets one tool see the stops and stations of the others", () => {
    publishPlaces("street", [place("street:1", "Harbour", 0)]);
    publishPlaces("rail", [place("rail:1", "Market", 100)]);
    expect(placesOtherThan("rail").map((p) => p.id)).toEqual(["street:1"]);
    publishPlaces("street", []);
    expect(placesOtherThan("rail")).toEqual([]);
  });
});
