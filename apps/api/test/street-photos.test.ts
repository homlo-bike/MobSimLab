import { describe, expect, it, vi } from "vitest";
import { PhotoError } from "../src/street-photos/outbound";
import { PanoramaxClient, panoramaxPhoto, validPanoramaxRef } from "../src/street-photos/panoramax.client";
import { boxAround, metresBetween } from "../src/street-photos/types";

const COL = "11111111-2222-4333-8444-555555555555";
const PIC = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PIC2 = "aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff";
const AT: [number, number] = [2.3522, 48.8566];

function item(id: string, lon: number, lat: number, extra: Record<string, unknown> = {}) {
  return {
    type: "Feature",
    id,
    collection: COL,
    geometry: { type: "Point", coordinates: [lon, lat] },
    properties: {
      datetime: "2025-06-01T10:00:00+00:00",
      "view:azimuth": 92,
      "pers:interior_orientation": { field_of_view: 360 },
      license: "CC-BY-SA-4.0",
      ...extra,
    },
    providers: [{ name: "Camille", roles: ["producer"] }],
    links: [{ rel: "license", href: "https://spdx.org/licenses/CC-BY-SA-4.0.html", title: "CC BY-SA 4.0" }],
    assets: {
      thumb: { href: `https://pics.example.org/${id}/thumb.jpg` },
      sd: { href: `https://pics.example.org/${id}/sd.jpg` },
      hd: { href: `https://pics.example.org/${id}/hd.jpg` },
    },
  };
}

type Call = [string | URL | Request, RequestInit?];
function routes(table: Record<string, () => Response>) {
  return vi.fn(async (...args: Call) => {
    const url = String(args[0]);
    for (const [prefix, answer] of Object.entries(table)) if (url.startsWith(prefix)) return answer();
    return new Response("", { status: 404 });
  });
}
const publicDns = async () => ["93.184.216.34"];

describe("Panoramax street photos", () => {
  it("lists the photos near a point, nearest first, within the radius", async () => {
    const near = item(PIC, AT[0] + 0.00005, AT[1]);
    const nearer = item(PIC2, AT[0], AT[1] + 0.00001);
    const far = item("aaaaaaaa-bbbb-4ccc-8ddd-000000000000", AT[0] + 0.001, AT[1]);
    const fetchImpl = routes({
      "https://api.panoramax.xyz/api/search?": () =>
        Response.json({ type: "FeatureCollection", features: [near, far, nearer, { id: 3 }] }),
    });
    const client = new PanoramaxClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolveImpl: publicDns,
    });
    const photos = await client.near(AT, 30);
    const url = new URL(String(fetchImpl.mock.calls[0]![0]));
    expect(url.searchParams.get("bbox")!.split(",").map(Number)[0]).toBeLessThan(AT[0]);
    expect(photos.map((p) => p.ref)).toEqual([`${COL}_${PIC2}`, `${COL}_${PIC}`]);
    expect(photos[1]).toMatchObject({
      provider: "panoramax",
      takenAt: "2025-06-01T10:00:00+00:00",
      author: "Camille",
      licence: { name: "CC-BY-SA-4.0", url: "https://spdx.org/licenses/CC-BY-SA-4.0.html" },
      heading: 92,
      panorama: true,
      distanceM: 4,
    });
    expect(photos[1]!.pageUrl).toContain(`pic=${PIC}`);
  });

  it("passes a picture on from the address the search gave, and checks every redirect", async () => {
    const fetchImpl = routes({
      "https://api.panoramax.xyz/api/search?": () => Response.json({ features: [item(PIC, AT[0], AT[1])] }),
      [`https://pics.example.org/${PIC}/sd.jpg`]: () =>
        new Response(null, { status: 302, headers: { location: "https://storage.example.net/x.jpg" } }),
      "https://storage.example.net/x.jpg": () =>
        new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { "content-type": "image/jpeg" } }),
    });
    const resolveImpl = vi.fn(async (host: string) => (void host, ["93.184.216.34"]));
    const client = new PanoramaxClient({ fetchImpl: fetchImpl as unknown as typeof fetch, resolveImpl });
    await client.near(AT, 30);
    const img = await client.image(`${COL}_${PIC}`, "sd");
    expect(img.contentType).toBe("image/jpeg");
    expect([...img.body]).toEqual([0xff, 0xd8, 0xff]);
    expect(resolveImpl.mock.calls.map((c) => c[0])).toEqual([
      "api.panoramax.xyz",
      "pics.example.org",
      "storage.example.net",
    ]);
  });

  it("looks a photo up in the catalogue when no search listed it", async () => {
    const fetchImpl = routes({
      [`https://api.panoramax.xyz/api/collections/${COL}/items/${PIC}`]: () => Response.json(item(PIC, 1, 2)),
      [`https://pics.example.org/${PIC}/thumb.jpg`]: () =>
        new Response(new Uint8Array([1]), { headers: { "content-type": "image/webp" } }),
    });
    const client = new PanoramaxClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolveImpl: publicDns,
    });
    expect((await client.image(`${COL}_${PIC}`, "thumb")).contentType).toBe("image/webp");
  });

  it("refuses picture addresses inside a private network, and answers that are not pictures", async () => {
    const fetchImpl = routes({
      [`https://api.panoramax.xyz/api/collections/${COL}/items/${PIC}`]: () => Response.json(item(PIC, 1, 2)),
      [`https://pics.example.org/${PIC}/sd.jpg`]: () =>
        new Response("<html>", { headers: { "content-type": "text/html" } }),
    });
    const inside = new PanoramaxClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolveImpl: async (h) => (h === "pics.example.org" ? ["10.0.0.5"] : ["93.184.216.34"]),
    });
    const e1 = (await inside.image(`${COL}_${PIC}`, "sd").catch((x: unknown) => x)) as PhotoError;
    expect(e1).toBeInstanceOf(PhotoError);
    expect(e1.status).toBe(502);
    expect(fetchImpl.mock.calls.map((c) => String(c[0]))).not.toContain(
      `https://pics.example.org/${PIC}/sd.jpg`,
    );

    const html = new PanoramaxClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolveImpl: publicDns,
    });
    const e2 = (await html.image(`${COL}_${PIC}`, "sd").catch((x: unknown) => x)) as PhotoError;
    expect(e2.status).toBe(502);
    expect(e2.message).toBe("Panoramax did not answer with a picture");
  });

  it("refuses http picture addresses and endless redirects", async () => {
    const plain = { ...item(PIC, 1, 2), assets: { sd: { href: "http://pics.example.org/a.jpg" } } };
    const loop = routes({
      [`https://api.panoramax.xyz/api/collections/${COL}/items/${PIC}`]: () => Response.json(plain),
    });
    const c1 = new PanoramaxClient({ fetchImpl: loop as unknown as typeof fetch, resolveImpl: publicDns });
    expect(((await c1.image(`${COL}_${PIC}`, "sd").catch((x: unknown) => x)) as PhotoError).status).toBe(502);

    const again = routes({
      [`https://api.panoramax.xyz/api/collections/${COL}/items/${PIC}`]: () => Response.json(item(PIC, 1, 2)),
      "https://pics.example.org/": () =>
        new Response(null, { status: 302, headers: { location: `https://pics.example.org/${PIC}/sd.jpg` } }),
    });
    const c2 = new PanoramaxClient({ fetchImpl: again as unknown as typeof fetch, resolveImpl: publicDns });
    const e = (await c2.image(`${COL}_${PIC}`, "sd").catch((x: unknown) => x)) as PhotoError;
    expect(e.message).toBe("Panoramax sent too many redirects");
  });

  it("checks photo ids and reads items without optional fields", () => {
    expect(validPanoramaxRef(`${COL}_${PIC}`)).toBe(true);
    expect(validPanoramaxRef(`${COL}_../../etc`)).toBe(false);
    expect(validPanoramaxRef(PIC)).toBe(false);
    const bare = panoramaxPhoto(
      { id: PIC, collection: COL, geometry: { type: "Point", coordinates: [1, 2] }, properties: {} },
      [1, 2],
    );
    expect(bare).toMatchObject({
      takenAt: null,
      author: null,
      licence: null,
      heading: null,
      panorama: false,
    });
    expect(panoramaxPhoto({ id: PIC, collection: COL }, [1, 2])).toBeNull();
  });

  it("measures distances and boxes in metres", () => {
    expect(Math.round(metresBetween([0, 0], [0, 1]))).toBe(111_195);
    const [w, s, e, n] = boxAround([10, 50], 100);
    expect(Math.round(metresBetween([w, 50], [e, 50]))).toBeGreaterThanOrEqual(199);
    expect(Math.round(metresBetween([10, s], [10, n]))).toBeGreaterThanOrEqual(199);
  });
});
