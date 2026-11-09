import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import { json } from "express";
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
  // of a design; every other route keeps the 100 kB default.
  // Nest adds no JSON parser of its own once one is registered, so both are registered here.
  app.use("/api/projects/:id/drawings", json({ limit: "8mb" }));
  app.use("/api/terrain", json({ limit: "2mb" }));
  app.use(json({ limit: "100kb" }));
}
