import { Injectable } from "@nestjs/common";
import { PanoramaxClient, validPanoramaxRef } from "./panoramax.client";
import { PhotoError } from "./outbound";
import type { PhotoImage, PhotoSize, StreetPhoto } from "./types";

/** The street photo sources the API knows (the `provider` of a plugin's `streetPhotos`). */
export const PHOTO_PROVIDERS = ["panoramax"] as const;
export type PhotoProvider = (typeof PHOTO_PROVIDERS)[number];

/** Purpose: whether a string names a street photo source the API knows. */
export function isPhotoProvider(v: string): v is PhotoProvider {
  return (PHOTO_PROVIDERS as readonly string[]).includes(v);
}

/**
 * Street-level photos (docs/architecture/06-gis.md §8.1): the photos near a point and their pictures, from the
 * sources of the bundled street photo plugins. Nothing is stored: not the search, not the pictures, and nothing
 * goes into a project or its `.mslab` export.
 */
@Injectable()
export class StreetPhotosService {
  constructor(private readonly panoramax: PanoramaxClient) {}

  /** Purpose: the sources members can use now. Panoramax needs no key, so it is always there. */
  async available(): Promise<PhotoProvider[]> {
    return ["panoramax"];
  }

  /** Purpose: the photos within `radiusM` metres of a point, nearest first. */
  async near(provider: PhotoProvider, at: [number, number], radiusM: number): Promise<StreetPhoto[]> {
    switch (provider) {
      case "panoramax":
        return this.panoramax.near(at, radiusM);
    }
  }

  /** Purpose: whether `ref` has the form of a photo id of the source. */
  validRef(provider: PhotoProvider, ref: string): boolean {
    switch (provider) {
      case "panoramax":
        return validPanoramaxRef(ref);
    }
  }

  /** Purpose: one picture of a photo, passed on and not stored. Throws PhotoError. */
  async image(provider: PhotoProvider, ref: string, size: PhotoSize): Promise<PhotoImage> {
    if (!this.validRef(provider, ref)) throw new PhotoError("no such photo", 400);
    switch (provider) {
      case "panoramax":
        return this.panoramax.image(ref, size);
    }
  }
}
