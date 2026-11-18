/**
 * Street and walk tiles come from OpenStreetMap through the API (Overpass, cached server-side). Overpass is busy at
 * times and answers 429 or 5xx for a moment; one such tile used to fail the whole calculation (a cargo bike trip
 * of 7 tiles failed on "walk tile …: 502").
 */

/** Waits before each new try of a tile the server could not get yet, ms. */
const RETRY_MS = [1_000, 3_000, 8_000];

/**
 * Purpose: GET a tile, trying again after a short wait when the server or OpenStreetMap is busy (429, 502, 503,
 * 504) or the network dropped; any other answer comes back at once.
 * Inputs: the URL, fetch options, and (tests) the fetch and wait to use.
 */
export async function fetchTileWithRetry(
  url: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = (...a) => fetch(...a),
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= RETRY_MS.length;
    try {
      const res = await fetchImpl(url, init);
      if (last || ![429, 502, 503, 504].includes(res.status)) return res;
    } catch (err) {
      // A cancelled request (its signal aborted) is not tried again.
      if (last || init.signal?.aborted) throw err;
    }
    await wait(RETRY_MS[attempt]!);
    init.signal?.throwIfAborted();
  }
}
