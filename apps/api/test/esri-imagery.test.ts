import { describe, expect, it, vi } from "vitest";
import { EsriImageryClient, maxAgeOf, TileError, validTile } from "../src/basemaps/esri.client";

// A made-up key with little variety, so secret scanners do not take it for a real one.
const KEY = `test-${"x".repeat(26)}WXYZ`;

function answer(body: BodyInit, init: ResponseInit) {
  return vi.fn(async (...args: [string | URL | Request, RequestInit?]) => {
    void args;
    return new Response(body, init);
  });
}

describe("Esri World Imagery tiles", () => {
  it("asks Esri for z/y/x with the key and passes the image on", async () => {
    const fetchImpl = answer(new Uint8Array([0xff, 0xd8, 0xff]), {
      status: 200,
      headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=3600" },
    });
    const client = new EsriImageryClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const tile = await client.tile(KEY, 12, 2145, 1434);
    const url = String(fetchImpl.mock.calls[0]![0]);
    expect(url).toBe(
      `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/12/1434/2145?token=${KEY}`,
    );
    expect(tile).toMatchObject({ contentType: "image/jpeg", maxAgeS: 3600 });
    expect([...tile.body]).toEqual([0xff, 0xd8, 0xff]);
  });

  it("does not pass on Esri's JSON error for a bad key, and never names the key", async () => {
    const fetchImpl = answer(JSON.stringify({ error: { code: 498, message: "Invalid token." } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const client = new EsriImageryClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const e = await client.tile(KEY, 1, 0, 0).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(TileError);
    expect((e as TileError).status).toBe(502);
    expect((e as TileError).message).not.toContain(KEY);
  });

  it("answers 404 where Esri has no tile, 502 when it refuses the key or fails, 504 on timeout", async () => {
    const status = async (fetchImpl: unknown) =>
      (
        (await new EsriImageryClient({ fetchImpl: fetchImpl as typeof fetch })
          .tile(KEY, 3, 1, 1)
          .catch((x: unknown) => x)) as TileError
      ).status;
    expect(await status(answer("", { status: 404 }))).toBe(404);
    expect(await status(answer("", { status: 403 }))).toBe(502);
    expect(await status(answer("", { status: 500 }))).toBe(502);
    const timeout = vi.fn(async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    });
    expect(await status(timeout)).toBe(504);
  });

  it("refuses tiles larger than the limit", async () => {
    const fetchImpl = answer(new Uint8Array(20), { status: 200, headers: { "content-type": "image/png" } });
    const client = new EsriImageryClient({ fetchImpl: fetchImpl as unknown as typeof fetch, maxBytes: 10 });
    expect(((await client.tile(KEY, 0, 0, 0).catch((x: unknown) => x)) as TileError).status).toBe(502);
  });

  it("checks tile numbers and reads Esri's max-age", () => {
    expect(validTile(0, 0, 0)).toBe(true);
    expect(validTile(2, 3, 3)).toBe(true);
    expect(validTile(2, 4, 0)).toBe(false);
    expect(validTile(24, 0, 0)).toBe(false);
    expect(validTile(-1, 0, 0)).toBe(false);
    expect(validTile(1.5, 0, 0)).toBe(false);
    expect(maxAgeOf("public, max-age=600")).toBe(600);
    expect(maxAgeOf("max-age=999999")).toBe(86_400);
    expect(maxAgeOf("no-store")).toBe(0);
    expect(maxAgeOf(null)).toBe(0);
  });
});
