/** A street-level photo near the point a planner clicked, as `GET /api/street-photos/<provider>/near` lists it. */
export interface StreetPhoto {
  provider: "panoramax" | "mapillary";
  /** The provider's id of the photo, as the picture address takes it (`/photos/<ref>/<size>`). */
  ref: string;
  lon: number;
  lat: number;
  /** Straight-line distance from the clicked point, metres. */
  distanceM: number;
  /** When the photo was taken (ISO 8601), when the provider says. */
  takenAt: string | null;
  /** Who took or uploaded it, when the provider says. */
  author: string | null;
  /** The photo's licence, when the provider says. */
  licence: { name: string; url: string | null } | null;
  /** Direction the camera looked, degrees clockwise from north; null when unknown. */
  heading: number | null;
  /** A 360° panorama. */
  panorama: boolean;
  /** The photo in the provider's own viewer. */
  pageUrl: string;
}

/** The sizes of a photo the API passes on: a small preview and one large enough to look at. */
export const PHOTO_SIZES = ["thumb", "sd"] as const;
export type PhotoSize = (typeof PHOTO_SIZES)[number];

/** A picture as the API sends it on, without storing it. */
export interface PhotoImage {
  body: Buffer;
  contentType: string;
  maxAgeS: number;
}

/** Purpose: metres between two points (haversine, spherical Earth). */
export function metresBetween(a: [number, number], b: [number, number]): number {
  const R = 6_371_008.8;
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Purpose: a box of `radiusM` metres around a point, as west, south, east, north. */
export function boxAround([lon, lat]: [number, number], radiusM: number): [number, number, number, number] {
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  return [lon - dLon, Math.max(-90, lat - dLat), lon + dLon, Math.min(90, lat + dLat)];
}

/** Purpose: only image types are passed on to the browser. */
export function isImageType(contentType: string): boolean {
  return /^image\/(jpeg|png|webp)$/.test(contentType);
}
