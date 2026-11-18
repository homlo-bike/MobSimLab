import { type XmlElement, child, childText, childrenOf, parseXml, path, XmlError } from "./xml";

/**
 * WMS and WMTS services as map layers (bundled plugin `org.mobsimlab.ogc-layers`): reading a service's
 * GetCapabilities document into the layers the map can draw, and the address of one map tile of such a layer.
 * The map draws Web Mercator tiles (EPSG:3857, z/x/y), so a WMS layer must offer EPSG:3857 (or one of its older
 * codes) and a WMTS layer a tile matrix set on the Web Mercator grid (such as GoogleMapsCompatible). Pure
 * functions: fetching, credentials and address checks are in ogc.client.ts.
 */

export type OgcKind = "wms" | "wmts" | "xyz";
/** The kinds with a GetCapabilities document. */
export type OgcServiceKind = Exclude<OgcKind, "xyz">;

/** How to get one tile of a WMS layer: a GetMap request for the tile's box. */
export interface WmsSource {
  /** The GetMap address the service names (may already hold query parameters). */
  url: string;
  version: string;
  /** The Web Mercator code the layer lists (EPSG:3857 or an older alias). */
  crs: string;
  format: string;
  style: string;
}

/** How to get one tile of a WMTS layer: a RESTful template or a KVP GetTile request. */
export interface WmtsSource {
  /** ResourceURL template with {TileMatrix}, {TileRow}, {TileCol} and the like. */
  template?: string;
  /** GetTile address for KVP requests, when the service has no template. */
  kvpUrl?: string;
  layer: string;
  style: string;
  format: string;
  matrixSet: string;
  /** Tile matrix identifier for each map zoom level the set has. */
  matrices: Record<string, string>;
  /** Dimension values (such as TIME) with the service's default. */
  dimensions: Record<string, string>;
}

/** A layer of a service as the map can draw it. */
export interface ResolvedLayer {
  /** The layer's name (WMS) or identifier (WMTS) in the service. */
  id: string;
  title: string;
  tileSize: 256 | 512;
  minzoom: number;
  maxzoom: number;
  /** [west, south, east, north] in degrees, when the service says. */
  bounds?: [number, number, number, number];
  wms?: WmsSource;
  wmts?: WmtsSource;
  /** A plain tile address with {z}, {x} and {y} (XYZ tiles such as OpenTopoMap). */
  xyz?: { template: string };
}

/** A layer of a service as the Admin screen lists it: usable ones can be added to the map. */
export interface LayerOption {
  id: string;
  title: string;
  /** Why the map cannot draw it, when it cannot (no Web Mercator, no image format). */
  problem?: string;
  layer?: ResolvedLayer;
}

/** What a capabilities document says. */
export interface Capabilities {
  kind: OgcKind;
  version: string;
  title: string;
  /** Who provides the data, for the attribution the Admin confirms. */
  attribution: string;
  layers: LayerOption[];
}

export class CapabilitiesError extends Error {}

/** Web Mercator under its EPSG code and the older codes services still list. */
const MERCATOR_CODES = ["3857", "900913", "102100", "102113", "3785"];
/** Half the width of the Web Mercator square, metres. */
export const MERCATOR_HALF = 20037508.342789244;
/** Scale denominator of zoom 0 with 256-pixel tiles and 0.28 mm pixels (the OGC standard pixel). */
const SCALE_Z0_256 = 559082264.0287178;
/** Deepest zoom the map asks for. */
export const MAX_ZOOM = 22;

/** Purpose: whether a CRS name (EPSG:3857, urn:ogc:def:crs:EPSG::3857, an opengis.net URI…) is Web Mercator. */
export function isMercator(crs: string): boolean {
  const s = crs.trim();
  const m = /(\d+)$/.exec(s);
  if (!m || !MERCATOR_CODES.includes(m[1]!)) return false;
  return /epsg|esri|opengis/i.test(s) || /^\d+$/.test(s);
}

/**
 * Purpose: the base address of a service from what an Admin typed: its GetCapabilities link or the service
 * address, with the OGC request parameters (SERVICE, REQUEST, VERSION) taken out and others (such as a map name
 * or a key) kept. A RESTful WMTS capabilities file (…/WMTSCapabilities.xml) is kept as it is.
 */
export function serviceBase(raw: string): URL {
  const u = new URL(raw.trim());
  for (const key of [...u.searchParams.keys()])
    if (/^(service|request|version|acceptversions)$/i.test(key)) u.searchParams.delete(key);
  u.hash = "";
  return u;
}

/** Purpose: the GetCapabilities address of a service. */
export function capabilitiesUrl(kind: OgcServiceKind, base: URL): URL {
  const u = new URL(base);
  if (/\.xml$/i.test(u.pathname)) return u;
  u.searchParams.set("SERVICE", kind === "wms" ? "WMS" : "WMTS");
  u.searchParams.set("REQUEST", "GetCapabilities");
  return u;
}

/**
 * Purpose: read a GetCapabilities document. Inputs: the kind the Admin chose and the document.
 * Output: the service's title, attribution and layers. Throws CapabilitiesError when it is not one of that kind
 * (such as a service exception or an HTML page).
 */
export function readCapabilities(kind: OgcServiceKind, xml: string): Capabilities {
  let root: XmlElement;
  try {
    root = parseXml(xml);
  } catch (e) {
    throw new CapabilitiesError(
      `the service did not answer with a capabilities document (${e instanceof XmlError ? e.message : "not XML"})`,
    );
  }
  if (/exception/i.test(root.name)) {
    const text = (findDeep(root, "ExceptionText")?.text ?? root.text ?? "").trim().slice(0, 200);
    throw new CapabilitiesError(`the service answered with an error${text ? `: ${text}` : ""}`);
  }
  if (kind === "wms") {
    if (root.name !== "WMS_Capabilities" && root.name !== "WMT_MS_Capabilities")
      throw new CapabilitiesError(
        root.name === "Capabilities"
          ? "this is a WMTS service: choose WMTS"
          : "the service did not answer with WMS capabilities",
      );
    return readWms(root);
  }
  if (root.name !== "Capabilities")
    throw new CapabilitiesError(
      root.name === "WMS_Capabilities" || root.name === "WMT_MS_Capabilities"
        ? "this is a WMS service: choose WMS"
        : "the service did not answer with WMTS capabilities",
    );
  return readWmts(root);
}

function findDeep(el: XmlElement, name: string): XmlElement | undefined {
  for (const c of el.children) {
    if (c.name === name) return c;
    const f = findDeep(c, name);
    if (f) return f;
  }
  return undefined;
}

/** Purpose: the image format to ask for: PNG (it can be transparent), else JPEG, else any image format. */
export function pickFormat(formats: readonly string[]): string | null {
  const images = formats.map((f) => f.trim()).filter((f) => /^image\//i.test(f));
  return (
    images.find((f) => f.toLowerCase() === "image/png") ??
    images.find((f) => /^image\/png/i.test(f)) ??
    images.find((f) => /^image\/jpe?g$/i.test(f)) ??
    images.find((f) => /^image\/(webp|gif)/i.test(f)) ??
    null
  );
}

function bbox(w: number, s: number, e: number, n: number): [number, number, number, number] | undefined {
  if (![w, s, e, n].every(Number.isFinite)) return undefined;
  const c = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));
  const out: [number, number, number, number] = [c(w, 180), c(s, 85.0511), c(e, 180), c(n, 85.0511)];
  return out[0] < out[2] && out[1] < out[3] ? out : undefined;
}

/** Purpose: zoom range from WMS scale hints (MinScaleDenominator, MaxScaleDenominator), else 0 to MAX_ZOOM. */
function zoomRange(minScale: number | null, maxScale: number | null): [number, number] {
  const min =
    maxScale && maxScale > 0 ? Math.max(0, Math.floor(Math.log2(SCALE_Z0_256 / maxScale) + 0.01)) : 0;
  const max =
    minScale && minScale > 0
      ? Math.min(MAX_ZOOM, Math.ceil(Math.log2(SCALE_Z0_256 / minScale) - 0.01))
      : MAX_ZOOM;
  return max >= min ? [min, max] : [0, MAX_ZOOM];
}

interface WmsInherited {
  crs: string[];
  bounds?: [number, number, number, number];
  minScale: number | null;
  maxScale: number | null;
  attribution: string;
}

function readWms(root: XmlElement): Capabilities {
  const version = root.attrs.version ?? (root.name === "WMS_Capabilities" ? "1.3.0" : "1.1.1");
  const v13 = !version.startsWith("1.1") && !version.startsWith("1.0");
  const capability = child(root, "Capability");
  const getMap = path(capability, "Request", "GetMap");
  const formats = childrenOf(getMap, "Format").map((f) => f.text.trim());
  const href = path(getMap, "DCPType", "HTTP", "Get", "OnlineResource")?.attrs.href?.trim() ?? "";
  const format = pickFormat(formats);
  const service = child(root, "Service");
  const layers: LayerOption[] = [];

  const visit = (el: XmlElement, up: WmsInherited) => {
    const own = childrenOf(el, v13 ? "CRS" : "SRS").flatMap((c) => c.text.trim().split(/\s+/));
    const geo = child(el, "EX_GeographicBoundingBox");
    const ll = child(el, "LatLonBoundingBox");
    const bounds = geo
      ? bbox(
          Number(childText(geo, "westBoundLongitude")),
          Number(childText(geo, "southBoundLatitude")),
          Number(childText(geo, "eastBoundLongitude")),
          Number(childText(geo, "northBoundLatitude")),
        )
      : ll
        ? bbox(Number(ll.attrs.minx), Number(ll.attrs.miny), Number(ll.attrs.maxx), Number(ll.attrs.maxy))
        : undefined;
    const num = (name: string) => {
      const t = childText(el, name);
      return t ? Number(t) : null;
    };
    const here: WmsInherited = {
      crs: [...up.crs, ...own.filter(Boolean)],
      bounds: bounds ?? up.bounds,
      minScale: num("MinScaleDenominator") ?? up.minScale,
      maxScale: num("MaxScaleDenominator") ?? up.maxScale,
      attribution: childText(child(el, "Attribution"), "Title") || up.attribution,
    };
    const name = childText(el, "Name");
    if (name) {
      const title = childText(el, "Title") || name;
      const crs = MERCATOR_CODES.map((code) => here.crs.find((c) => c.toUpperCase() === `EPSG:${code}`)).find(
        Boolean,
      );
      const problem = !href
        ? "the service names no GetMap address"
        : !format
          ? "the service offers no image format for maps"
          : !crs
            ? "not offered in Web Mercator (EPSG:3857)"
            : undefined;
      const [minzoom, maxzoom] = zoomRange(here.minScale, here.maxScale);
      layers.push(
        problem
          ? { id: name, title, problem }
          : {
              id: name,
              title,
              layer: {
                id: name,
                title,
                tileSize: 256,
                minzoom,
                maxzoom,
                ...(here.bounds ? { bounds: here.bounds } : {}),
                wms: { url: href, version, crs: crs!, format: format!, style: "" },
              },
            },
      );
      if (!problem && here.attribution) attributionOf.set(name, here.attribution);
    }
    for (const c of childrenOf(el, "Layer")) visit(c, here);
  };
  const attributionOf = new Map<string, string>();
  for (const top of childrenOf(capability, "Layer"))
    visit(top, { crs: [], minScale: null, maxScale: null, attribution: "" });

  const contact = path(service, "ContactInformation", "ContactPersonPrimary");
  const provider = childText(contact, "ContactOrganization") || childText(service, "Title");
  const firstAttribution = layers.map((l) => attributionOf.get(l.id)).find(Boolean);
  return {
    kind: "wms",
    version,
    title: childText(service, "Title"),
    attribution: firstAttribution ?? provider ?? "",
    layers,
  };
}

/** A tile matrix of a WMTS tile matrix set. */
interface Matrix {
  id: string;
  scale: number;
  topLeft: [number, number];
  tileWidth: number;
  tileHeight: number;
  width: number;
  height: number;
}

/**
 * Purpose: the map zoom level a WMTS tile matrix stands for, when it is on the Web Mercator grid: square tiles of
 * 256 or 512 pixels, 2^z tiles across, the top-left corner at the grid's corner (either axis order) and the
 * scale that makes 2^z tiles cover the world. Null for any other matrix.
 */
export function mercatorZoom(m: Matrix): number | null {
  if (m.tileWidth !== m.tileHeight || (m.tileWidth !== 256 && m.tileWidth !== 512)) return null;
  const z = Math.round(Math.log2(m.width));
  if (z < 0 || z > MAX_ZOOM || 2 ** z !== m.width || m.height > m.width) return null;
  const [a, b] = m.topLeft;
  const near = (v: number, want: number) => Math.abs(v - want) <= Math.max(1, Math.abs(want) * 1e-6);
  const cornerOk =
    (near(a, -MERCATOR_HALF) && near(b, MERCATOR_HALF)) ||
    (near(a, MERCATOR_HALF) && near(b, -MERCATOR_HALF));
  if (!cornerOk) return null;
  // 0.28 mm per pixel: the width the matrix covers must be the world's.
  const covered = m.scale * 0.00028 * m.tileWidth * m.width;
  return Math.abs(covered / (2 * MERCATOR_HALF) - 1) < 0.005 ? z : null;
}

function readMatrixSet(el: XmlElement): { id: string; mercator: boolean; matrices: Matrix[] } {
  const crs = childText(el, "SupportedCRS");
  const matrices = childrenOf(el, "TileMatrix").map((m) => {
    const tl = childText(m, "TopLeftCorner").split(/\s+/).map(Number);
    return {
      id: childText(m, "Identifier"),
      scale: Number(childText(m, "ScaleDenominator")),
      topLeft: [tl[0] ?? NaN, tl[1] ?? NaN] as [number, number],
      tileWidth: Number(childText(m, "TileWidth")),
      tileHeight: Number(childText(m, "TileHeight")),
      width: Number(childText(m, "MatrixWidth")),
      height: Number(childText(m, "MatrixHeight")),
    };
  });
  return { id: childText(el, "Identifier"), mercator: isMercator(crs), matrices };
}

function readWmts(root: XmlElement): Capabilities {
  const contents = child(root, "Contents");
  const sets = new Map(
    childrenOf(contents, "TileMatrixSet").map((s) => [childText(s, "Identifier"), readMatrixSet(s)]),
  );
  const getTile = childrenOf(path(root, "OperationsMetadata"), "Operation").find(
    (o) => o.attrs.name === "GetTile",
  );
  const gets = childrenOf(path(getTile, "DCP", "HTTP"), "Get");
  const kvpGet =
    gets.find((g) =>
      /KVP/i.test(
        childrenOf(path(child(g, "Constraint"), "AllowedValues"), "Value")
          .map((v) => v.text)
          .join(" "),
      ),
    ) ?? gets.find((g) => !child(g, "Constraint"));
  const kvpUrl = kvpGet?.attrs.href?.trim() || undefined;
  const layers: LayerOption[] = [];

  for (const l of childrenOf(contents, "Layer")) {
    const id = childText(l, "Identifier");
    if (!id) continue;
    const title = childText(l, "Title") || id;
    const formats = childrenOf(l, "Format").map((f) => f.text.trim());
    const resources = childrenOf(l, "ResourceURL").filter((r) => (r.attrs.resourceType ?? "tile") === "tile");
    const format = pickFormat([...formats, ...resources.map((r) => r.attrs.format ?? "")]);
    const styles = childrenOf(l, "Style");
    const style =
      childText(styles.find((s) => s.attrs.isDefault === "true") ?? styles[0], "Identifier") || "default";
    const dimensions: Record<string, string> = {};
    for (const d of childrenOf(l, "Dimension")) {
      const name = childText(d, "Identifier");
      const value = childText(d, "Default") || childText(d, "Value");
      if (name && value) dimensions[name] = value;
    }
    const wgs = child(l, "WGS84BoundingBox");
    const lower = childText(wgs, "LowerCorner").split(/\s+/).map(Number);
    const upper = childText(wgs, "UpperCorner").split(/\s+/).map(Number);
    const bounds = wgs ? bbox(lower[0]!, lower[1]!, upper[0]!, upper[1]!) : undefined;

    // The first linked tile matrix set on the Web Mercator grid.
    let chosen: {
      set: string;
      matrices: Record<string, string>;
      tileSize: 256 | 512;
      zooms: number[];
    } | null = null;
    for (const link of childrenOf(l, "TileMatrixSetLink")) {
      const set = sets.get(childText(link, "TileMatrixSet"));
      if (!set || !set.mercator) continue;
      const byZoom = new Map<number, Matrix>();
      for (const m of set.matrices) {
        const z = mercatorZoom(m);
        if (z !== null && !byZoom.has(z)) byZoom.set(z, m);
      }
      if (byZoom.size === 0) continue;
      // One tile size for the layer: the one most matrices have.
      const sizes = [...byZoom.values()].map((m) => m.tileWidth);
      const tileSize = (sizes.filter((s) => s === 512).length > sizes.length / 2 ? 512 : 256) as 256 | 512;
      const matrices: Record<string, string> = {};
      for (const [z, m] of byZoom) if (m.tileWidth === tileSize) matrices[String(z)] = m.id;
      const zooms = Object.keys(matrices)
        .map(Number)
        .sort((a, b) => a - b);
      chosen = { set: set.id, matrices, tileSize, zooms };
      break;
    }
    const template =
      (resources.find((r) => r.attrs.format === format) ?? resources[0])?.attrs.template?.trim() || undefined;
    const problem = !format
      ? "the layer offers no image format"
      : !chosen
        ? "no tile matrix set on the Web Mercator grid (such as GoogleMapsCompatible)"
        : !template && !kvpUrl
          ? "the service names no address for tiles"
          : undefined;
    if (problem || !chosen) {
      layers.push({ id, title, problem: problem ?? "not usable" });
      continue;
    }
    const tileFormat = template
      ? ((resources.find((r) => r.attrs.template?.trim() === template)?.attrs.format ?? format) as string)
      : format!;
    layers.push({
      id,
      title,
      layer: {
        id,
        title,
        tileSize: chosen.tileSize,
        minzoom: chosen.zooms[0]!,
        maxzoom: chosen.zooms[chosen.zooms.length - 1]!,
        ...(bounds ? { bounds } : {}),
        wmts: {
          ...(template ? { template } : { kvpUrl: kvpUrl! }),
          layer: id,
          style,
          format: tileFormat,
          matrixSet: chosen.set,
          matrices: chosen.matrices,
          dimensions,
        },
      },
    });
  }
  const provider = path(root, "ServiceProvider");
  return {
    kind: "wmts",
    version: root.attrs.version ?? "1.0.0",
    title: childText(path(root, "ServiceIdentification"), "Title"),
    attribution:
      childText(provider, "ProviderName") || childText(path(root, "ServiceIdentification"), "Title"),
    layers,
  };
}

/** Purpose: whether an XYZ tile address has {z}, {x} and {y} (or {-y}, rows counted from the south). */
export function isXyzTemplate(template: string): boolean {
  return template.includes("{z}") && template.includes("{x}") && /\{-?y\}/.test(template);
}

/** Purpose: an XYZ tile address for tile z/x/y; {-y} counts rows from the south (TMS). */
export function fillXyz(template: string, z: number, x: number, y: number): string {
  return template
    .replaceAll("{z}", String(z))
    .replaceAll("{x}", String(x))
    .replaceAll("{-y}", String(2 ** z - 1 - y))
    .replaceAll("{y}", String(y));
}

/** Purpose: the Web Mercator box of tile z/x/y as [minx, miny, maxx, maxy] in metres. */
export function tileBox(z: number, x: number, y: number): [number, number, number, number] {
  const size = (2 * MERCATOR_HALF) / 2 ** z;
  const minx = -MERCATOR_HALF + x * size;
  const maxy = MERCATOR_HALF - y * size;
  return [minx, maxy - size, minx + size, maxy];
}

/** Purpose: set query parameters on an address, replacing any of the same name in any letter case. */
export function setParams(url: URL, params: Record<string, string>): URL {
  const out = new URL(url);
  const lower = new Set(Object.keys(params).map((k) => k.toLowerCase()));
  for (const key of [...out.searchParams.keys()])
    if (lower.has(key.toLowerCase())) out.searchParams.delete(key);
  for (const [k, v] of Object.entries(params)) out.searchParams.set(k, v);
  return out;
}

/**
 * Purpose: the address of map tile z/x/y of a layer, before credentials. Output: null when the layer has no tile
 * there (a WMTS set without that zoom level). The caller checks that z/x/y is a tile of the pyramid.
 */
export function tileUrl(layer: ResolvedLayer, z: number, x: number, y: number): URL | null {
  if (z < layer.minzoom || z > layer.maxzoom) return null;
  if (layer.xyz) return new URL(fillXyz(layer.xyz.template, z, x, y));
  if (layer.wms) {
    const w = layer.wms;
    const v13 = !w.version.startsWith("1.1") && !w.version.startsWith("1.0");
    const box = tileBox(z, x, y)
      .map((v) => v.toFixed(6))
      .join(",");
    return setParams(new URL(w.url), {
      SERVICE: "WMS",
      VERSION: w.version,
      REQUEST: "GetMap",
      LAYERS: layer.id,
      STYLES: w.style,
      FORMAT: w.format,
      TRANSPARENT: /png|gif|webp/i.test(w.format) ? "TRUE" : "FALSE",
      WIDTH: String(layer.tileSize),
      HEIGHT: String(layer.tileSize),
      [v13 ? "CRS" : "SRS"]: w.crs,
      // Web Mercator is easting, northing in both versions.
      BBOX: box,
    });
  }
  const t = layer.wmts;
  if (!t) return null;
  const matrix = t.matrices[String(z)];
  if (matrix === undefined) return null;
  if (t.template) {
    const values: Record<string, string> = {
      tilematrixset: t.matrixSet,
      tilematrix: matrix,
      tilerow: String(y),
      tilecol: String(x),
      style: t.style,
      layer: t.layer,
    };
    for (const [k, v] of Object.entries(t.dimensions)) values[k.toLowerCase()] ??= v;
    const filled = t.template.replace(/\{([^{}]+)\}/g, (whole, name: string) => {
      const v = values[name.toLowerCase()];
      return v === undefined ? whole : encodeURIComponent(v);
    });
    if (/\{[^{}]+\}/.test(filled)) return null;
    return new URL(filled);
  }
  const dims = Object.fromEntries(Object.entries(t.dimensions).map(([k, v]) => [k.toUpperCase(), v]));
  return setParams(new URL(t.kvpUrl!), {
    SERVICE: "WMTS",
    REQUEST: "GetTile",
    VERSION: "1.0.0",
    LAYER: t.layer,
    STYLE: t.style,
    FORMAT: t.format,
    TILEMATRIXSET: t.matrixSet,
    TILEMATRIX: matrix,
    TILEROW: String(y),
    TILECOL: String(x),
    ...dims,
  });
}
