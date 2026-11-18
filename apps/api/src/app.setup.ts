import { Logger } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { populationSettings } from "./population/layers.service";
import cookieParser from "cookie-parser";
import { json, type NextFunction, raw, type Request, type Response } from "express";
import helmet from "helmet";
import type { AppConfig } from "./config/env";
import { requestLogContext } from "./logging/context";

/**
 * The only other sites the browser loads from: the basemap tile servers, including NASA GIBS for the bundled
 * `org.mobsimlab.nasa-gibs` plugin (tools/plugins/check.py refuses a plugin basemap on a host not listed here).
 * The static viewer's `_headers` matches.
 */
export const MAP_ORIGINS = [
  "https://tiles.openfreemap.org",
  "https://tiles.maps.eox.at",
  "https://gibs.earthdata.nasa.gov",
  // Panoramax street photo coverage (vector tiles); the photos themselves come through the API.
  "https://api.panoramax.xyz",
];

/**
 * Purpose: HTTP middleware shared by the server and the tests: security headers and CSP (05 §3.4) and
 * cookie parsing, and which reverse proxies are trusted for the client address.
 * Side effects: registers middleware on the app.
 */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustedProxies ?? false);
  // HTTPS only (security review): when the public address is https and a trusted proxy reports that the browser
  // came over plain http, send it to the https address. Without MOBSIMLAB_TRUSTED_PROXIES nothing is redirected
  // (an untrusted X-Forwarded-Proto means nothing), nor are requests that came without a proxy (the health check).
  if (config.publicUrl.protocol === "https:" && config.trustedProxies)
    app.use(redirectToHttps(config.publicUrl));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "default-src": ["'self'"],
          // Basemaps: OpenFreeMap styles and tiles, EOX's Sentinel-2 aerial imagery (apps/web/src/map/basemaps.ts) and
          // NASA GIBS imagery from the bundled plugin.
          "img-src": ["'self'", "data:", "blob:", ...MAP_ORIGINS],
          // data: lets MapLibre load the pictures the app draws itself (population lattice, noise map) as image
          // sources: it fetches their data: URLs. A data: URL carries its own bytes, so nothing leaves the page.
          "connect-src": ["'self'", "data:", ...MAP_ORIGINS],
          "worker-src": ["'self'", "blob:"],
          "style-src": ["'self'"],
          // WebAssembly street router (ADR-0031) needs wasm compilation, not general eval.
          "script-src": ["'self'", "'wasm-unsafe-eval'"],
          "object-src": ["'none'"],
          "frame-ancestors": ["'none'"],
          "base-uri": ["'none'"],
          "form-action": ["'self'"],
        },
      },
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    }),
  );
  // Browser features the app never uses are switched off; clipboard writes (copy link) stay allowed.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()",
    );
    next();
  });
  // API answers carry people's projects and settings: no browser or proxy keeps them unless a route says so.
  app.use(["/api", "/oauth", "/mcp"], (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  // AI agents switched off (the desktop app's local mode until the person turns them on): the MCP and OAuth
  // endpoints do not exist.
  if (config.agentsDisabled)
    app.use(
      ["/mcp", "/oauth", "/.well-known/oauth-protected-resource", "/.well-known/oauth-authorization-server"],
      (_req: Request, res: Response) => {
        res.status(404).json({ statusCode: 404, message: "AI agents are switched off" });
      },
    );
  app.use(cookieParser());
  // Drawings are whole documents (a railway design can be a few MB), terrain requests carry every track
  // of a design, a simulation run carries the topology and lines it runs; every other route keeps the
  // 100 kB default.
  // Nest adds no JSON parser of its own once one is registered, so both are registered here.
  app.use("/api/projects/:id/drawings", json({ limit: "8mb" }));
  app.use("/api/terrain", json({ limit: "2mb" }));
  // Station catchments for the benefit tables: up to 400 areas of up to 200 corners (about 3.5 MB of JSON).
  app.use("/api/projects/:id/population/catchments", json({ limit: "4mb" }));
  app.use("/api/benefits/population", json({ limit: "4mb" }));
  app.use("/api/projects/:id/simulation-runs", json({ limit: "16mb" }));
  // Plugin packages (ADR-0036 §9) are uploaded as the raw .msplugin file, at most 10 MB.
  app.use("/api/admin/plugins", raw({ type: "application/octet-stream", limit: "10mb" }));
  // A .mslab project file (ADR-0021) is uploaded as the raw file, at most 200 MB; the sandboxed reader checks it.
  app.use(
    "/api/projects/import",
    raw({
      type: ["application/octet-stream", "application/zip", "application/vnd.mobsimlab.project+zip"],
      limit: "200mb",
    }),
  );
  // Planners' own population files (GeoTIFF, GeoJSON, CSV) are uploaded raw, up to MOBSIMLAB_POPULATION_UPLOAD_MB.
  app.use(
    "/api/projects/:id/population/uploads",
    raw({ type: "application/octet-stream", limit: populationSettings().maxUploadBytes }),
  );
  app.use(json({ limit: "100kb" }));
  // After the body parsers, whose stream callbacks would lose the context: every log entry of the request
  // carries its request ID (ADR-0022).
  app.use(requestLogContext);
}

/**
 * Purpose: middleware that redirects a request the trusted reverse proxy received over plain http to the same path
 * on the https public address (308 keeps the method and body). Only `X-Forwarded-Proto` from a trusted proxy
 * counts, so a direct request is never redirected. A header from an address outside MOBSIMLAB_TRUSTED_PROXIES is
 * ignored (and logged once): Express then reports "http" for every request, and redirecting on that would loop.
 */
export function redirectToHttps(publicUrl: URL) {
  let warned = false;
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.header("x-forwarded-proto")) return next();
    const trust = req.app.get("trust proxy fn") as ((addr: string, i: number) => boolean) | undefined;
    if (!trust?.(req.socket.remoteAddress ?? "", 0)) {
      if (!warned) {
        warned = true;
        new Logger("security").warn(
          "X-Forwarded-Proto came from a proxy that is not in MOBSIMLAB_TRUSTED_PROXIES; it is ignored. " +
            "Add the reverse proxy's address so the client address and https are taken from it.",
        );
      }
      return next();
    }
    if (req.protocol !== "http") return next();
    // The path is appended as text, so a path such as `//other.host/` stays on this host (no open redirect).
    const path = req.originalUrl.startsWith("/") ? req.originalUrl : `/${req.originalUrl}`;
    res.redirect(308, `${publicUrl.origin}${path}`);
  };
}
