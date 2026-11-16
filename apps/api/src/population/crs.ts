import proj4 from "proj4";

/**
 * Coordinate reference systems of uploaded population data (06-gis §3), with proj4js. Longitude and latitude
 * (EPSG:4326 and its relatives) and Web Mercator are built in; common national and UTM systems are listed
 * here; anything else the planner gives as a PROJ string or WKT (the text of a `.prj` file).
 */

/** Definitions by EPSG code (from epsg.io), beyond the UTM zones, which are generated. */
const KNOWN: Record<number, string> = {
  4326: "+proj=longlat +datum=WGS84 +no_defs",
  4258: "+proj=longlat +ellps=GRS80 +no_defs",
  4269: "+proj=longlat +datum=NAD83 +no_defs",
  4674: "+proj=longlat +ellps=GRS80 +no_defs",
  4490: "+proj=longlat +ellps=GRS80 +no_defs",
  3857: "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs",
  900913:
    "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs",
  3035: "+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs",
  54009: "+proj=moll +lon_0=0 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs",
  6933: "+proj=cea +lat_ts=30 +lon_0=0 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs",
  27700:
    "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs",
  2154: "+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs",
  31467:
    "+proj=tmerc +lat_0=0 +lon_0=9 +k=1 +x_0=3500000 +y_0=0 +ellps=bessel +towgs84=598.1,73.7,418.2,0.202,0.045,-2.455,6.7 +units=m +no_defs",
  31468:
    "+proj=tmerc +lat_0=0 +lon_0=12 +k=1 +x_0=4500000 +y_0=0 +ellps=bessel +towgs84=598.1,73.7,418.2,0.202,0.045,-2.455,6.7 +units=m +no_defs",
  2056: "+proj=somerc +lat_0=46.9524055555556 +lon_0=7.43958333333333 +k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs",
  28992:
    "+proj=sterea +lat_0=52.1561605555556 +lon_0=5.38763888888889 +k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel +towgs84=565.4171,50.3319,465.5524,1.9342,-1.6677,9.1019,4.0725 +units=m +no_defs",
  31370:
    "+proj=lcc +lat_0=90 +lon_0=4.36748666666667 +lat_1=51.1666672333333 +lat_2=49.8333339 +x_0=150000.013 +y_0=5400088.438 +ellps=intl +towgs84=-106.8686,52.2978,-103.7239,0.3366,-0.457,1.8422,-1.2747 +units=m +no_defs",
  3006: "+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs",
  2180: "+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 +ellps=GRS80 +units=m +no_defs",
  5070: "+proj=aea +lat_0=23 +lon_0=-96 +lat_1=29.5 +lat_2=45.5 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs",
  3112: "+proj=lcc +lat_0=0 +lon_0=134 +lat_1=-18 +lat_2=-36 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs",
  2193: "+proj=tmerc +lat_0=0 +lon_0=173 +k=0.9996 +x_0=1600000 +y_0=10000000 +ellps=GRS80 +units=m +no_defs",
  3414: "+proj=tmerc +lat_0=1.36666666666667 +lon_0=103.833333333333 +k=1 +x_0=28001.642 +y_0=38744.572 +ellps=WGS84 +units=m +no_defs",
};

/** Purpose: the PROJ definition of an EPSG code this module knows, or null. */
export function epsgDefinition(code: number): string | null {
  if (KNOWN[code]) return KNOWN[code]!;
  // WGS 84 / UTM zones (326zz north, 327zz south) and ETRS89 / UTM zones 28 to 38 (258zz).
  if ((code >= 32601 && code <= 32660) || (code >= 32701 && code <= 32760)) {
    const zone = code % 100;
    return `+proj=utm +zone=${zone}${code >= 32701 ? " +south" : ""} +datum=WGS84 +units=m +no_defs`;
  }
  if (code >= 25828 && code <= 25838) return `+proj=utm +zone=${code - 25800} +ellps=GRS80 +units=m +no_defs`;
  // NAD83 / UTM zones 1 to 23 (269zz).
  if (code >= 26901 && code <= 26923) return `+proj=utm +zone=${code - 26900} +datum=NAD83 +units=m +no_defs`;
  return null;
}

/** A coordinate reference system that cannot be used; the message is shown to the planner. */
export class CrsError extends Error {}

/** Converts `[x, y]` in the source system to `[lon, lat]` in WGS 84, and back. */
export interface Converter {
  /** Whether the source is longitude and latitude already (no conversion). */
  identity: boolean;
  toLonLat(xy: [number, number]): [number, number];
  fromLonLat(lonlat: [number, number]): [number, number];
}

/**
 * Purpose: a converter from a reference system to WGS 84 longitude and latitude.
 * Inputs: the planner's own definition (PROJ string, WKT, or "EPSG:nnnn"), which wins, else the EPSG code from
 * the file. Output: the converter. Throws CrsError when neither names a system this module can use.
 */
export function converterFor(epsg: number | null, own?: string | null): Converter {
  let def: string | null;
  const text = own?.trim();
  if (text) {
    const m = /^EPSG:(\d{4,6})$/i.exec(text);
    def = m ? epsgDefinition(Number(m[1])) : text;
    if (!def) throw new CrsError(`EPSG:${m![1]} is not known; give its PROJ string or WKT instead`);
  } else if (epsg !== null) {
    def = epsgDefinition(epsg);
    if (!def)
      throw new CrsError(
        `The file's coordinate system EPSG:${epsg} is not known; give its PROJ string or WKT (the text of a .prj file)`,
      );
  } else {
    throw new CrsError(
      "The file does not name its coordinate system; give its PROJ string or WKT (the text of a .prj file)",
    );
  }
  let conv: proj4.Converter;
  try {
    conv = proj4(def, "EPSG:4326");
    const probe = conv.inverse([0, 0]);
    if (!probe.every((v) => typeof v === "number")) throw new Error("bad");
  } catch {
    throw new CrsError("The coordinate system definition cannot be read");
  }
  const identity = epsg === 4326 && !text;
  return {
    identity,
    toLonLat: (xy) => (identity ? xy : (conv.forward(xy) as [number, number])),
    fromLonLat: (ll) => (identity ? ll : (conv.inverse(ll) as [number, number])),
  };
}
