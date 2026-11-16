import { randomBytes } from "node:crypto";
import { Test, type TestingModuleBuilder } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "../../src/app.module";
import { configureApp } from "../../src/app.setup";
import type { AppConfig } from "../../src/config/env";

/** Random secrets for each test run, so no secret-looking value is committed. */
export const TEST_SECRETS = {
  db_app_password: randomBytes(24).toString("hex"),
  master_key: randomBytes(32).toString("base64"),
  session_secret: randomBytes(32).toString("base64"),
};

/** Purpose: a config for tests; override any field. */
export function testConfig(over: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0,
    publicUrl: new URL("http://127.0.0.1:8080"),
    db: { host: "127.0.0.1", port: 5432, name: "mobsimlab" },
    rateLimits: { authPerMinute: 1000, writesPerMinute: 1000 },
    developmentMode: false,
    logging: { level: "info", console: false },
    secrets: { ...TEST_SECRETS },
    // Setup mode only lets the named person claim the instance; the integration tests' first user is alice.
    bootstrapOwnerSubject: "alice",
    ...over,
  };
}

/**
 * Purpose: build and initialise the app with production middleware. `override` can replace providers (for
 * example the outbound gateway clients) before the module is compiled.
 */
export async function createApp(
  config: AppConfig,
  override: (b: TestingModuleBuilder) => TestingModuleBuilder = (b) => b,
): Promise<NestExpressApplication> {
  const mod = await override(Test.createTestingModule({ imports: [AppModule.forRoot(config)] })).compile();
  const app = mod.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app, config);
  await app.init();
  return app;
}
