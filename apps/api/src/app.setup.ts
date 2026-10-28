import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import helmet from "helmet";

/**
 * Purpose: HTTP middleware shared by the server and the tests: security headers and CSP (05 §3.4) and
 * cookie parsing. Side effects: registers middleware on the app.
 */
export function configureApp(app: NestExpressApplication): void {
  app.disable("x-powered-by");
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
}
