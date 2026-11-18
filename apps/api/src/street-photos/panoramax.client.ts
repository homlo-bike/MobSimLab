import { maxAgeOf } from "../basemaps/esri.client";
import { defaultOutbound, Outbound, type OutboundOptions, PhotoError } from "./outbound";
import {
  boxAround,
  isImageType,
  metresBetween,
  type PhotoImage,
  type PhotoSize,
  type StreetPhoto,
} from "./types";

/**
 * Panoramax (https://panoramax.fr), the free and open street photo commons: the bundled plugin
 * `org.mobsimlab.panoramax`. The API searches the federated meta-catalog for photos near a point and passes their
 * pictures on, without storing them, so the browser only loads the coverage tiles from Panoramax itself. No key.
 * The pictures live on the instance that holds them (OpenStreetMap France, IGN and others); their addresses come
 * from the catalogue and are read with the outbound gateway's rules (public https hosts only).
 */

export const PANORAMAX_API = "https://api.panoramax.xyz/api";
/** The meta-catalog's own viewer, which opens any photo of the federation. */
export const PANORAMAX_VIEWER = "https://api.panoramax.xyz/";

/** Photos looked up around a point at most, and listed at most. */
const SEARCH_LIMIT = 100;
const LIST_LIMIT = 12;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** Picture addresses learnt from searches, so a picture needs no extra catalogue request. */
const HREF_CACHE = 5000;

/** A Panoramax photo id is `<collection>_<picture>`, both UUIDs. */
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const REF = new RegExp(`^(${UUID})_(${UUID})$`);

/** Purpose: whether a string is a Panoramax photo id as `near` lists it. */
export function validPanoramaxRef(ref: string): boolean {
  return REF.test(ref);
}

interface StacItem {
  id?: unknown;
  collection?: unknown;
  geometry?: { type?: unknown; coordinates?: unknown };
  properties?: Record<string, unknown>;
  providers?: { name?: unknown; roles?: unknown }[];
  assets?: Record<string, { href?: unknown } | undefined>;
  links?: { rel?: unknown; href?: unknown; title?: unknown }[];
}

const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null;

/** Purpose: the licence of a photo from its STAC item: the `license` property and a `license` link. */
function licenceOf(item: StacItem): StreetPhoto["licence"] {
  const link = item.links?.find((l) => l?.rel === "license");
  const href = text(link?.href);
  const name = text(item.properties?.license) ?? text(link?.title);
  if (!name) return null;
  return { name, url: href && /^https:\/\//.test(href) ? href : null };
}

/** Purpose: who took a photo: the producer, or the first provider the item names. */
function authorOf(item: StacItem): string | null {
  const producer = text(item.properties?.["geovisio:producer"]);
  if (producer) return producer;
  const providers = Array.isArray(item.providers) ? item.providers : [];
  const p = providers.find((x) => Array.isArray(x?.roles) && x.roles.includes("producer")) ?? providers[0];
  return text(p?.name);
}

/**
 * Purpose: a STAC item of the Panoramax catalogue as a street photo, or null when it is not a located picture.
 * Inputs: the item and the clicked point.
 */
export function panoramaxPhoto(item: StacItem, at: [number, number]): StreetPhoto | null {
  const id = text(item.id);
  const collection = text(item.collection);
  const c = item.geometry?.coordinates;
  if (!id || !collection || !Array.isArray(c) || typeof c[0] !== "number" || typeof c[1] !== "number")
    return null;
  const ref = `${collection}_${id}`;
  if (!validPanoramaxRef(ref)) return null;
  const lon = c[0];
  const lat = c[1];
  const p = item.properties ?? {};
  const azimuth = Number(p["view:azimuth"]);
  const orientation = p["pers:interior_orientation"] as
    { field_of_view?: unknown; sensor_array_dimensions?: unknown } | undefined;
  const fov = Number(orientation?.field_of_view);
  // Most items give no field of view, only the picture size: a 2:1 picture is an equirectangular 360° panorama.
  const dims = orientation?.sensor_array_dimensions;
  const twoToOne =
    Array.isArray(dims) && typeof dims[0] === "number" && typeof dims[1] === "number" && dims[1] > 0
      ? Math.abs(dims[0] / dims[1] - 2) < 0.01
      : false;
  const takenAt = text(p.datetime);
  return {
    provider: "panoramax",
    ref,
    lon,
    lat,
    distanceM: Math.round(metresBetween(at, [lon, lat])),
    takenAt: takenAt && !Number.isNaN(Date.parse(takenAt)) ? takenAt : null,
    author: authorOf(item),
    licence: licenceOf(item),
    heading: Number.isFinite(azimuth) && p["view:azimuth"] !== null ? ((azimuth % 360) + 360) % 360 : null,
    panorama: orientation?.field_of_view != null && Number.isFinite(fov) ? fov === 360 : twoToOne,
    pageUrl: `${PANORAMAX_VIEWER}#focus=pic&pic=${id}&map=19/${lat.toFixed(6)}/${lon.toFixed(6)}`,
  };
}

/** Purpose: the picture address of one size from a STAC item's assets (`thumb`, `sd`, falling back to `hd`). */
function hrefOf(item: StacItem, size: PhotoSize): string | null {
  const a = item.assets ?? {};
  const order = size === "thumb" ? ["thumb", "sd"] : ["sd", "hd"];
  for (const k of order) {
    const h = text(a[k]?.href);
    if (h) return h;
  }
  return null;
}

export class PanoramaxClient {
  private readonly out: Outbound;
  private readonly hrefs = new Map<string, Partial<Record<PhotoSize, string>>>();

  constructor(
    options: Partial<OutboundOptions> = {},
    private readonly api: string = PANORAMAX_API,
  ) {
    this.out = new Outbound({ ...defaultOutbound(), ...options }, "Panoramax");
  }

  /**
   * Purpose: the photos taken within `radiusM` metres of a point, nearest first, at most twelve.
   * Side effects: one request to the Panoramax meta-catalog; remembers the picture addresses it lists.
   */
  async near(at: [number, number], radiusM: number): Promise<StreetPhoto[]> {
    const [w, s, e, n] = boxAround(at, radiusM);
    const q = new URLSearchParams({
      bbox: [w, s, e, n].map((v) => v.toFixed(6)).join(","),
      limit: String(SEARCH_LIMIT),
    });
    const body = (await this.out.json(`${this.api}/search?${q}`, MAX_JSON_BYTES)) as { features?: unknown };
    const items = Array.isArray(body?.features) ? (body.features as StacItem[]) : [];
    const photos: StreetPhoto[] = [];
    for (const item of items) {
      const photo = panoramaxPhoto(item, at);
      if (!photo || photo.distanceM > radiusM) continue;
      photos.push(photo);
      this.remember(photo.ref, item);
    }
    photos.sort((a, b) => a.distanceM - b.distanceM);
    return photos.slice(0, LIST_LIMIT);
  }

  /**
   * Purpose: one picture of a photo, passed on without storing it. Inputs: a ref from `near` and a size.
   * Throws PhotoError: 404 when Panoramax has no such photo, 502 when it fails or answers with no image.
   */
  async image(ref: string, size: PhotoSize): Promise<PhotoImage> {
    const m = REF.exec(ref);
    if (!m) throw new PhotoError("no such photo", 400);
    let href = this.hrefs.get(ref)?.[size];
    if (!href) {
      const item = (await this.out.json(
        `${this.api}/collections/${m[1]}/items/${m[2]}`,
        MAX_JSON_BYTES,
      )) as StacItem;
      this.remember(ref, item);
      href = this.hrefs.get(ref)?.[size];
      if (!href) throw new PhotoError("Panoramax has no picture of this photo", 404);
    }
    const r = await this.out.get(href, "image/*", MAX_IMAGE_BYTES);
    if (r.status === 404 || r.status === 410)
      throw new PhotoError("Panoramax has no picture of this photo", 404);
    if (r.status < 200 || r.status >= 300) throw new PhotoError(`Panoramax answered ${r.status}`, 502);
    if (!isImageType(r.contentType)) throw new PhotoError("Panoramax did not answer with a picture", 502);
    return { body: r.body, contentType: r.contentType, maxAgeS: Math.max(maxAgeOf(r.cacheControl), 3600) };
  }

  private remember(ref: string, item: StacItem): void {
    const entry: Partial<Record<PhotoSize, string>> = {};
    const thumb = hrefOf(item, "thumb");
    const sd = hrefOf(item, "sd");
    if (thumb) entry.thumb = thumb;
    if (sd) entry.sd = sd;
    if (this.hrefs.size >= HREF_CACHE) this.hrefs.delete(this.hrefs.keys().next().value!);
    this.hrefs.set(ref, entry);
  }
}
