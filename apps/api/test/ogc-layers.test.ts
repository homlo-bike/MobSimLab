import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BUILTIN_SERVICES } from "../src/basemaps/builtin-layers";
import { TileError } from "../src/basemaps/esri.client";
import { addressOf } from "../src/basemaps/map-layers.service";
import {
  capabilitiesUrl,
  fillXyz,
  isXyzTemplate,
  isMercator,
  readCapabilities,
  CapabilitiesError,
  serviceBase,
  tileBox,
  tileUrl,
} from "../src/basemaps/ogc";
import {
  keyInQuery,
  OgcClient,
  OgcError,
  requestUrl,
  serviceUrlAllowed,
  signed,
} from "../src/basemaps/ogc.client";
import { parseXml, XmlError } from "../src/basemaps/xml";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", "ogc", name), "utf8");
// A made-up secret with little variety, so secret scanners do not take it for a real one.
const SECRET = `test-${"x".repeat(20)}KEY9`;

describe("XML reader", () => {
  it("reads elements, attributes, text and entities without namespace prefixes", () => {
    const root = parseXml(
      `<?xml version="1.0"?><a:root xmlns:a="x" b:k="1 &amp; 2"><a:c>t &lt; u<![CDATA[<raw>]]></a:c><d/></a:root>`,
    );
    expect(root.name).toBe("root");
    expect(root.attrs).toEqual({ k: "1 & 2" });
    expect(root.children.map((c) => c.name)).toEqual(["c", "d"]);
    expect(root.children[0]!.text).toBe("t < u<raw>");
  });

  it("never expands entities a document type declares", () => {
    const root = parseXml(`<!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><r>&x;</r>`);
    expect(root.text).toBe("&x;");
  });

  it("refuses documents that are not well formed", () => {
    expect(() => parseXml("<a><b></a>")).toThrow(XmlError);
    expect(() => parseXml("<html><body>")).toThrow(XmlError);
    expect(() => parseXml("not xml")).toThrow(XmlError);
  });
});

describe("Service addresses", () => {
  it("drops the GetCapabilities request from the typed address and keeps the rest", () => {
    const base = serviceBase(
      "https://api.example.com/v3/ogc/wmts/085f?request=getCapabilities&token=abc&SERVICE=wmts",
    );
    expect(base.toString()).toBe("https://api.example.com/v3/ogc/wmts/085f?token=abc");
    expect(capabilitiesUrl("wmts", base).toString()).toBe(
      "https://api.example.com/v3/ogc/wmts/085f?token=abc&SERVICE=WMTS&REQUEST=GetCapabilities",
    );
    const rest = serviceBase("https://tiles.example.org/wmts/1.0.0/WMTSCapabilities.xml");
    expect(capabilitiesUrl("wmts", rest).toString()).toBe(rest.toString());
  });

  it("accepts https addresses of public hosts only", () => {
    expect(serviceUrlAllowed("https://ows.example.de/services/service")).toBe(true);
    expect(serviceUrlAllowed("http://ows.example.de/services/service")).toBe(false);
    expect(serviceUrlAllowed("https://127.0.0.1/wms")).toBe(false);
    expect(serviceUrlAllowed("https://geoserver.internal/wms")).toBe(false);
    expect(serviceUrlAllowed("https://user:pw@ows.example.de/wms")).toBe(false);
  });

  it("finds a key in a typed address's query", () => {
    expect(keyInQuery("https://t.example.org/{z}/{x}/{y}.png?apikey=abc")).toBe(true);
    expect(keyInQuery("https://t.example.org/{z}/{x}/{y}.png?access_token=abc")).toBe(true);
    expect(keyInQuery("https://maps.example.org/wms?key=abc")).toBe(true);
    expect(keyInQuery("https://maps.example.org/wms?map=/srv/topo.map&layers=a")).toBe(false);
  });

  it("shows only host and path, never a key in the query", () => {
    expect(addressOf("https://api.example.com/wms?token=secret")).toBe("api.example.com/wms");
  });

  it("knows Web Mercator under its codes", () => {
    for (const c of [
      "EPSG:3857",
      "urn:ogc:def:crs:EPSG::3857",
      "urn:ogc:def:crs:EPSG:6.18.3:3857",
      "EPSG:900913",
      "http://www.opengis.net/def/crs/EPSG/0/3857",
    ])
      expect(isMercator(c)).toBe(true);
    for (const c of ["EPSG:4326", "urn:ogc:def:crs:OGC:1.3:CRS84", "EPSG:38570"])
      expect(isMercator(c)).toBe(false);
  });
});

describe("WMS capabilities", () => {
  it("lists named layers, inheriting Web Mercator, bounds and attribution", () => {
    const c = readCapabilities("wms", fixture("wms-130.xml"));
    expect(c).toMatchObject({ kind: "wms", version: "1.3.0", title: "Example terrain & OSM WMS" });
    expect(c.attribution).toBe("© Example contributors");
    expect(c.layers.map((l) => [l.id, Boolean(l.layer)])).toEqual([
      ["TOPO-OSM-WMS", true],
      ["SRTM30-Colored", true],
      ["UTM-only", false],
    ]);
    expect(c.layers[2]!.problem).toMatch(/Web Mercator/);
    const topo = c.layers[0]!.layer!;
    expect(topo).toMatchObject({ title: "Topographic map & OSM", tileSize: 256, minzoom: 0, maxzoom: 22 });
    // EPSG:3857 is preferred to the older code, PNG to JPEG.
    expect(topo.wms).toMatchObject({ version: "1.3.0", crs: "EPSG:3857", format: "image/png" });
    expect(topo.bounds).toEqual([-180, -85.0511, 180, 85.0511]);
    // Scale hints become a zoom range.
    expect(c.layers[1]!.layer).toMatchObject({ minzoom: 4, maxzoom: 19 });
  });

  it("asks for each tile's Web Mercator box with GetMap", () => {
    const layer = readCapabilities("wms", fixture("wms-130.xml")).layers[0]!.layer!;
    const u = tileUrl(layer, 1, 1, 0)!;
    expect(u.origin + u.pathname).toBe("http://maps.example.org/services/service");
    const p = Object.fromEntries(u.searchParams);
    expect(p).toMatchObject({
      SERVICE: "WMS",
      VERSION: "1.3.0",
      REQUEST: "GetMap",
      LAYERS: "TOPO-OSM-WMS",
      STYLES: "",
      FORMAT: "image/png",
      TRANSPARENT: "TRUE",
      WIDTH: "256",
      HEIGHT: "256",
      CRS: "EPSG:3857",
      BBOX: "0.000000,0.000000,20037508.342789,20037508.342789",
    });
  });

  it("reads WMS 1.1.1 with SRS lists and keeps the GetMap address's own parameters", () => {
    const c = readCapabilities("wms", fixture("wms-111.xml"));
    const layer = c.layers[0]!.layer!;
    expect(layer.wms).toMatchObject({ version: "1.1.1", crs: "EPSG:900913", format: "image/png; mode=8bit" });
    expect(layer.bounds).toEqual([5.8, 47.2, 15.1, 55.1]);
    const u = tileUrl(layer, 0, 0, 0)!;
    expect(u.searchParams.get("map")).toBe("/srv/x.map");
    expect(u.searchParams.get("SRS")).toBe("EPSG:900913");
    expect(u.searchParams.has("CRS")).toBe(false);
  });

  it("explains a service exception and a WMTS document given as WMS", () => {
    expect(() =>
      readCapabilities(
        "wms",
        `<ServiceExceptionReport><ServiceException>Layer not defined</ServiceException></ServiceExceptionReport>`,
      ),
    ).toThrow(/error/);
    expect(() => readCapabilities("wms", fixture("wmts-rest.xml"))).toThrow(/choose WMTS/);
    expect(() => readCapabilities("wmts", fixture("wms-111.xml"))).toThrow(CapabilitiesError);
  });
});

describe("WMTS capabilities", () => {
  it("picks the Web Mercator tile matrix set and fills the RESTful template", () => {
    const c = readCapabilities("wmts", fixture("wmts-rest.xml"));
    expect(c).toMatchObject({ kind: "wmts", title: "Land cover", attribution: "Example Drive" });
    const layer = c.layers[0]!.layer!;
    expect(layer).toMatchObject({
      id: "a1b2_c3d4",
      tileSize: 256,
      minzoom: 0,
      maxzoom: 2,
      bounds: [35.7, 33.3, 36.6, 33.7],
    });
    expect(layer.wmts).toMatchObject({
      matrixSet: "EPSG3857",
      matrices: { 0: "0", 1: "1", 2: "2" },
      dimensions: { Time: "2020-01-01" },
    });
    expect(tileUrl(layer, 2, 3, 1)!.toString()).toBe(
      "https://tiles.example.com/v3/ogc/wmts/abc/default/2020-01-01/EPSG3857/2/1/3.png",
    );
    expect(tileUrl(layer, 3, 0, 0)).toBeNull();
  });

  it("uses KVP GetTile with 512-pixel matrices named by their own identifiers", () => {
    const c = readCapabilities("wmts", fixture("wmts-kvp.xml"));
    const [lc, geo] = c.layers;
    expect(geo!.problem).toMatch(/Web Mercator/);
    const layer = lc!.layer!;
    expect(layer).toMatchObject({ tileSize: 512, minzoom: 3, maxzoom: 4 });
    const p = Object.fromEntries(tileUrl(layer, 4, 9, 5)!.searchParams);
    expect(p).toEqual({
      SERVICE: "WMTS",
      REQUEST: "GetTile",
      VERSION: "1.0.0",
      LAYER: "lc100",
      STYLE: "default",
      FORMAT: "image/jpeg",
      TILEMATRIXSET: "GoogleMapsCompatible",
      TILEMATRIX: "GoogleMapsCompatible:4",
      TILEROW: "5",
      TILECOL: "9",
    });
  });

  it("puts tile z/x/y in the Web Mercator square", () => {
    expect(tileBox(0, 0, 0).map(Math.round)).toEqual([-20037508, -20037508, 20037508, 20037508]);
  });
});

function answer(body: BodyInit | null, init: ResponseInit) {
  return vi.fn(async (...args: [string | URL | Request, RequestInit?]) => {
    void args;
    return new Response(body, init);
  });
}
const publicDns = async () => ["93.184.216.34"];

describe("OGC client", () => {
  it("sends credentials only to the service's own host, moving it to https", () => {
    const own = requestUrl(
      "https://maps.example.org/services/service?token=t1",
      "http://maps.example.org/services/service?LAYERS=a",
    )!;
    expect(own.ownHost).toBe(true);
    expect(own.url.toString()).toBe("https://maps.example.org/services/service?LAYERS=a&token=t1");
    const other = requestUrl("https://maps.example.org/wms", "https://cdn.example.net/tiles/1.png")!;
    expect(other.ownHost).toBe(false);
    expect(requestUrl("https://maps.example.org/wms", "http://cdn.example.net/tiles/1.png")).toBeNull();
    expect(requestUrl("https://maps.example.org/wms", "https://10.0.0.5/tiles/1.png")).toBeNull();

    const basic = signed(own.url, { type: "basic", name: "ana", secret: SECRET }, true);
    expect(basic.headers.Authorization).toBe(`Basic ${Buffer.from(`ana:${SECRET}`).toString("base64")}`);
    expect(
      signed(own.url, { type: "query", name: "apikey", secret: SECRET }, true).url.searchParams.get("apikey"),
    ).toBe(SECRET);
    expect(signed(own.url, { type: "header", name: "X-API-Key", secret: SECRET }, true).headers).toEqual({
      "X-API-Key": SECRET,
    });
    const elsewhere = signed(other.url, { type: "header", name: "X-API-Key", secret: SECRET }, false);
    expect(elsewhere.headers).toEqual({});
  });

  it("reads capabilities with the credentials and without following redirects", async () => {
    const fetchImpl = answer(fixture("wms-130.xml"), {
      status: 200,
      headers: { "content-type": "text/xml" },
    });
    const client = new OgcClient({ fetchImpl: fetchImpl as unknown as typeof fetch, resolveImpl: publicDns });
    const c = await client.capabilities(
      "wms",
      "https://maps.example.org/services/service?request=GetCapabilities",
      {
        type: "query",
        name: "token",
        secret: SECRET,
      },
    );
    expect(c.layers).toHaveLength(3);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      `https://maps.example.org/services/service?SERVICE=WMS&REQUEST=GetCapabilities&token=${SECRET}`,
    );
    expect(init).toMatchObject({ redirect: "error" });
  });

  it("refuses a host that resolves inside a private network", async () => {
    const fetchImpl = answer("", { status: 200 });
    const client = new OgcClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolveImpl: async () => ["10.1.2.3"],
    });
    const e = await client
      .capabilities("wms", "https://maps.example.org/wms", { type: "none" })
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(OgcError);
    expect((e as OgcError).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("says when the service refuses the credentials, without naming them", async () => {
    const client = new OgcClient({
      fetchImpl: answer("denied", { status: 401 }) as unknown as typeof fetch,
      resolveImpl: publicDns,
    });
    const e = (await client
      .capabilities("wmts", "https://maps.example.org/wmts", { type: "basic", name: "ana", secret: SECRET })
      .catch((x: unknown) => x)) as OgcError;
    expect(e.status).toBe(502);
    expect(e.message).toMatch(/sign-in/);
    expect(e.message).not.toContain(SECRET);
  });

  it("shows the service's own reason for a failed answer, without the key", async () => {
    const reason = async (body: string, type: string) => {
      const client = new OgcClient({
        fetchImpl: answer(body, {
          status: 400,
          headers: { "content-type": type },
        }) as unknown as typeof fetch,
        resolveImpl: publicDns,
      });
      return (
        (await client
          .capabilities("wmts", "https://maps.example.org/wmts", {
            type: "query",
            name: "token",
            secret: SECRET,
          })
          .catch((x: unknown) => x)) as OgcError
      ).message;
    };
    expect(await reason('{"status":400,"message":"Given path does not exist."}', "application/json")).toBe(
      "the service answered 400: Given path does not exist.",
    );
    expect(
      await reason(
        `<ows:ExceptionReport><ows:Exception><ows:ExceptionText>Bad token ${SECRET}\n</ows:ExceptionText></ows:Exception></ows:ExceptionReport>`,
        "application/xml",
      ),
    ).toBe("the service answered 400: Bad token …");
    expect(await reason("<html>Bad</html>", "text/html")).toBe("the service answered 400");
  });

  it("passes images on and refuses a WMS exception sent with status 200", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const ok = new OgcClient({
      fetchImpl: answer(png, {
        status: 200,
        headers: { "content-type": "image/png", "cache-control": "max-age=600" },
      }) as unknown as typeof fetch,
      resolveImpl: publicDns,
    });
    const tile = await ok.tile(
      "https://maps.example.org/wms",
      new URL("http://maps.example.org/wms?LAYERS=a"),
      { type: "none" },
    );
    expect(tile).toMatchObject({ contentType: "image/png", maxAgeS: 600 });
    expect([...tile.body]).toEqual([...png]);

    const xml = new OgcClient({
      fetchImpl: answer("<ServiceExceptionReport/>", {
        status: 200,
        headers: { "content-type": "application/vnd.ogc.se_xml" },
      }) as unknown as typeof fetch,
      resolveImpl: publicDns,
    });
    const e = await xml
      .tile("https://maps.example.org/wms", new URL("https://maps.example.org/wms"), { type: "none" })
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(TileError);
    expect((e as TileError).status).toBe(502);

    const missing = new OgcClient({
      fetchImpl: answer("TileOutOfRange", { status: 400 }) as unknown as typeof fetch,
      resolveImpl: publicDns,
    });
    const m = await missing
      .tile("https://maps.example.org/wmts", new URL("https://maps.example.org/wmts"), { type: "none" })
      .catch((x: unknown) => x);
    expect((m as TileError).status).toBe(404);
  });

  it("stops reading a tile that is too large", async () => {
    const client = new OgcClient({
      fetchImpl: answer(new Uint8Array(2048), {
        status: 200,
        headers: { "content-type": "image/png" },
      }) as unknown as typeof fetch,
      resolveImpl: publicDns,
      maxTileBytes: 1024,
    });
    const e = await client
      .tile("https://maps.example.org/wms", new URL("https://maps.example.org/wms"), { type: "none" })
      .catch((x: unknown) => x);
    expect((e as TileError).status).toBe(502);
  });
});

describe("XYZ tiles", () => {
  it("fills {z}, {x}, {y} and {-y}", () => {
    expect(isXyzTemplate("https://a.tile.example.org/{z}/{x}/{y}.png")).toBe(true);
    expect(isXyzTemplate("https://a.tile.example.org/{z}/{x}.png")).toBe(false);
    expect(fillXyz("https://t.example.org/{z}/{x}/{-y}.png", 3, 2, 1)).toBe(
      "https://t.example.org/3/2/6.png",
    );
    expect(serviceUrlAllowed("https://a.tile.example.org/{z}/{x}/{y}.png")).toBe(true);
    expect(serviceUrlAllowed("https://localhost/{z}/{x}/{y}.png")).toBe(false);
  });

  it("checks the world tile with the key and offers one layer up to the zoom given", async () => {
    const fetchImpl = answer(null, { status: 404 });
    const client = new OgcClient({ fetchImpl: fetchImpl as unknown as typeof fetch, resolveImpl: publicDns });
    const auth = { type: "query" as const, name: "apikey", secret: SECRET };
    const c = await client.xyz("https://a.tile.example.org/{z}/{x}/{y}.png", auth, 17);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe(`https://a.tile.example.org/0/0/0.png?apikey=${SECRET}`);
    const layer = c.layers[0]!.layer!;
    expect(layer).toMatchObject({ id: "tiles", title: "a.tile.example.org", minzoom: 0, maxzoom: 17 });
    expect(tileUrl(layer, 12, 2145, 1434)!.toString()).toBe("https://a.tile.example.org/12/2145/1434.png");
    expect(tileUrl(layer, 18, 0, 0)).toBeNull();

    const refused = new OgcClient({
      fetchImpl: answer("no", { status: 403 }) as unknown as typeof fetch,
      resolveImpl: publicDns,
    });
    const e = await refused
      .xyz("https://a.tile.example.org/{z}/{x}/{y}.png", auth, 17)
      .catch((x: unknown) => x);
    expect((e as OgcError).status).toBe(502);
    expect((e as OgcError).message).not.toContain(SECRET);
  });
});

describe("built-in map layers", () => {
  it("are public https services the API may read, with stable ids and their layers named", () => {
    expect(new Set(BUILTIN_SERVICES.map((b) => b.id)).size).toBe(BUILTIN_SERVICES.length);
    for (const b of BUILTIN_SERVICES) {
      expect(b.id).toMatch(/^[a-z0-9-]{1,64}$/);
      expect(serviceUrlAllowed(b.url)).toBe(true);
      expect(b.kind !== "xyz" || isXyzTemplate(b.url)).toBe(true);
      expect(b.layers.length).toBeGreaterThan(0);
      expect(b.attribution.length).toBeGreaterThan(0);
    }
  });
});
