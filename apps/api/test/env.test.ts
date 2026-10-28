import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, secretProblem } from "../src/config/env";

const strong = (n = 44) => "Zx9!kQ2#vB7@mN4$pL6%tR8^yW3&cF5*hJ1(dS0)".repeat(3).slice(0, n);
const env = {
  MOBSIMLAB_PUBLIC_URL: "https://mobsimlab.internal.example.org",
  MOBSIMLAB_DB_HOST: "postgres",
  MOBSIMLAB_SECRETS_DIR: "/s",
};
const files: Record<string, string> = {
  "/s/db_app_password": strong(32),
  "/s/master_key": strong(),
  "/s/session_secret": strong(),
};
const reader = (p: string) => {
  const v = files[p];
  if (v === undefined) throw new Error("ENOENT");
  return v;
};

describe("loadConfig", () => {
  it("accepts strong secrets and a valid environment", () => {
    const c = loadConfig(env, reader);
    expect(c.port).toBe(8080);
    expect(c.db).toEqual({ host: "postgres", port: 5432, name: "mobsimlab" });
    expect(c.oidc).toBeUndefined();
  });

  it("refuses to start when a secret is missing", () => {
    expect(() => loadConfig(env, (p) => (p.endsWith("master_key") ? reader("x") : reader(p)))).toThrow(
      /master_key is missing/,
    );
  });

  it("refuses short, example and low-variety secrets", () => {
    expect(secretProblem("session_secret", "short")).toMatch(/shorter/);
    expect(secretProblem("db_app_password", "changeme-changeme-changeme")).toMatch(/example/);
    expect(secretProblem("master_key", "a".repeat(60))).toMatch(/variety/);
  });

  it("refuses a missing public URL and never echoes secret values", () => {
    const { MOBSIMLAB_PUBLIC_URL: _omit, ...rest } = env;
    void _omit;
    try {
      loadConfig(rest, reader);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as Error).message).toMatch(/MOBSIMLAB_PUBLIC_URL/);
      expect((e as Error).message).not.toContain(strong());
    }
  });

  it("reads the bootstrap OIDC provider and refuses an http issuer unless allowed", () => {
    const oidcEnv = {
      ...env,
      MOBSIMLAB_OIDC_ISSUER: "https://id.example.org",
      MOBSIMLAB_OIDC_CLIENT_ID: "msl",
    };
    const c = loadConfig(oidcEnv, reader);
    expect(c.oidc?.issuer.href).toBe("https://id.example.org/");
    expect(c.oidc?.clientSecret).toBeUndefined();
    expect(() => loadConfig({ ...oidcEnv, MOBSIMLAB_OIDC_ISSUER: "http://id.example.org" }, reader)).toThrow(
      /https/,
    );
    expect(() => loadConfig({ ...env, MOBSIMLAB_OIDC_CLIENT_ID: "msl" }, reader)).toThrow(/set together/);
  });

  it("treats empty optional variables as unset", () => {
    expect(
      loadConfig({ ...env, MOBSIMLAB_BOOTSTRAP_OWNER_EMAIL: "" }, reader).bootstrapOwnerEmail,
    ).toBeUndefined();
  });

  it("reads trusted proxies and rate limits with safe defaults", () => {
    const d = loadConfig(env, reader);
    expect(d.trustedProxies).toBeUndefined();
    expect(d.rateLimits).toEqual({ authPerMinute: 10, writesPerMinute: 120 });
    const c = loadConfig(
      { ...env, MOBSIMLAB_TRUSTED_PROXIES: "loopback, 172.16.0.0/12", MOBSIMLAB_RATE_LIMIT_AUTH: "20" },
      reader,
    );
    expect(c.trustedProxies).toEqual(["loopback", "172.16.0.0/12"]);
    expect(c.rateLimits.authPerMinute).toBe(20);
    expect(() => loadConfig({ ...env, MOBSIMLAB_TRUSTED_PROXIES: "*" }, reader)).toThrow(/TRUSTED_PROXIES/);
  });
});
