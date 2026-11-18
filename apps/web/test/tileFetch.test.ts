import { describe, expect, it, vi } from "vitest";
import { fetchTileWithRetry } from "../src/geodata/tileFetch";

const answer = (status: number) => new Response("<osm/>", { status });

describe("fetching a tile from a busy OpenStreetMap", () => {
  it("tries again after a 502 and gets the tile", async () => {
    const f = vi.fn().mockResolvedValueOnce(answer(502)).mockResolvedValueOnce(answer(200));
    const wait = vi.fn(async () => {});
    const res = await fetchTileWithRetry("/t", {}, f as unknown as typeof fetch, wait);
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(1000);
  });

  it("gives up after a few tries, and does not retry a bad request", async () => {
    const busy = vi.fn(async () => answer(503));
    expect((await fetchTileWithRetry("/t", {}, busy as unknown as typeof fetch, async () => {})).status).toBe(503);
    expect(busy).toHaveBeenCalledTimes(4);
    const bad = vi.fn(async () => answer(400));
    expect((await fetchTileWithRetry("/t", {}, bad as unknown as typeof fetch, async () => {})).status).toBe(400);
    expect(bad).toHaveBeenCalledTimes(1);
  });
});
