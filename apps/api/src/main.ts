import "reflect-metadata";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { ConfigError, loadConfig } from "./config/env";

/**
 * Purpose: start the API.
 * Side effects: validates configuration and secrets first; exits with code 78 (EX_CONFIG) if invalid.
 */
async function bootstrap(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      process.stderr.write(`${e.message}\n`);
      process.exit(78);
    }
    throw e;
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ["error", "warn", "log"],
  });
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
          "script-src": ["'self'"],
          "object-src": ["'none'"],
          "frame-ancestors": ["'none'"],
        },
      },
    }),
  );
  // Serve the built SPA from the same origin; unknown non-API GETs fall back to index.html.
  const webDir = process.env.MOBSIMLAB_WEB_DIR ?? join(__dirname, "..", "..", "web", "dist");
  if (existsSync(join(webDir, "index.html"))) {
    app.useStaticAssets(webDir, { index: false, maxAge: "1h" });
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
      res.sendFile(join(webDir, "index.html"));
    });
  }
  app.enableShutdownHooks();
  await app.listen(config.port, "0.0.0.0");
}

void bootstrap();
