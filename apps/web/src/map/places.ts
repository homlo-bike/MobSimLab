/** One place found by the API's place search (apps/api/src/places). */
export interface Place {
  name: string;
  /** Street, city, region and country, joined with ", ". */
  context: string;
  kind: string;
  lonLat: [number, number];
  /** [west, south, east, north] for areas; null for points. */
  bbox: [number, number, number, number] | null;
}

/**
 * Purpose: places matching a text, best first, from OpenStreetMap through the API's geocoder.
 * Inputs: the text, the reader's language, the map centre (nearer places first) and a signal to drop it.
 */
export async function searchPlaces(
  q: string,
  opts: { lang?: string; near?: [number, number]; signal?: AbortSignal } = {},
): Promise<Place[]> {
  const params = new URLSearchParams({ q: q.trim() });
  if (opts.lang) params.set("lang", opts.lang);
  if (opts.near) {
    params.set("lon", opts.near[0].toFixed(4));
    params.set("lat", opts.near[1].toFixed(4));
  }
  const res = await fetch(`/api/places/search?${params}`, { signal: opts.signal });
  if (!res.ok) {
    const msg = ((await res.json().catch(() => null)) as { message?: string } | null)?.message;
    throw new Error(msg || `the server answered ${res.status}`);
  }
  return ((await res.json()) as { places?: Place[] }).places ?? [];
}
