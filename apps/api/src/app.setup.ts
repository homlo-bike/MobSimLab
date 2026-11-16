import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import { json, raw } from "express";
import helmet from "helmet";
import type { AppConfig } from "./config/env";

/**
 * Purpose: HTTP middleware shared by the server and the tests: security headers and CSP (05 §3.4) and
 * cookie parsing, and which reverse proxies are trusted for the client address.
 * Side effects: registers middleware on the app.
 */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustedProxies ?? false);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "default-src": ["'self'"],
          "img-src": ["'self'", "data:", "blob:", "https://tiles.openfreemap.org"],
          "connect-src": ["'self'", "https://tiles.openfreemap.org"],
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
  app.use(cookieParser());
  // Drawings are whole documents (a railway design can be a few MB), terrain requests carry every track
  // of a design, a simulation run carries the topology and lines it runs; every other route keeps the
  // 100 kB default.
  // Nest adds no JSON parser of its own once one is registered, so both are registered here.
  app.use("/api/projects/:id/drawings", json({ limit: "8mb" }));
  app.use("/api/terrain", json({ limit: "2mb" }));
  app.use("/api/projects/:id/simulation-runs", json({ limit: "16mb" }));
  // Plugin packages (ADR-0036 §9) are uploaded as the raw .msplugin file, at most 10 MB.
  app.use("/api/admin/plugins", raw({ type: "application/octet-stream", limit: "10mb" }));
  app.use(json({ limit: "100kb" }));
}
