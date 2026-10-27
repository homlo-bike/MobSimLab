import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "../../src/app.module";
import { configureApp } from "../../src/app.setup";
import type { AppConfig } from "../../src/config/env";

/** Strong dummy secrets for tests (never used outside tests). */
export const TEST_SECRETS = {
  db_app_password: "unused-in-unit-tests-9f8e7d6c5b4a",
  master_key: "Qm9ndXMtdGVzdC1tYXN0ZXIta2V5LTAxMjM0NTY3ODk=",
  session_secret: "VGVzdC1zZXNzaW9uLXNlY3JldC0wMTIzNDU2Nzg5YWI=",
};

/** Purpose: a config for tests; override any field. */
export function testConfig(over: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0,
    publicUrl: new URL("http://127.0.0.1:8080"),
    db: { host: "127.0.0.1", port: 5432, name: "mobsimlab" },
    secrets: { ...TEST_SECRETS },
    ...over,
  };
}

/** Purpose: build and initialise the app with production middleware. */
export async function createApp(config: AppConfig): Promise<NestExpressApplication> {
  const mod = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] }).compile();
  const app = mod.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}
