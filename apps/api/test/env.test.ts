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

  it("refuses to start without a database password", () => {
    expect(() => loadConfig(env, (p) => (p.endsWith("db_app_password") ? reader("x") : reader(p)))).toThrow(
      /db_password is missing/,
    );
  });

  it("uses the one db_password when the app role has no password of its own", () => {
    const one: Record<string, string> = { "/s/db_password": strong(40) };
    const c = loadConfig(env, (p) => one[p] ?? reader("x"));
    expect(c.secrets.db_app_password).toBe(strong(40));
    // The role's own file wins when both are there.
    const both: Record<string, string> = { ...files, "/s/db_password": strong(40) };
    expect(loadConfig(env, (p) => both[p] ?? reader("x")).secrets.db_app_password).toBe(strong(32));
  });

  it("starts without master_key and session_secret, and uses them only when provided", () => {
    const only: Record<string, string> = { "/s/db_password": strong(40) };
    const a = loadConfig(env, (p) => only[p] ?? reader("x"));
    const b = loadConfig(env, (p) => only[p] ?? reader("x"));
    expect(a.secrets.master_key).toBeUndefined();
    // A random session key per start, never a fixed default.
    expect(a.secrets.session_secret).toHaveLength(44);
    expect(a.secrets.session_secret).not.toBe(b.secrets.session_secret);
    const c = loadConfig(env, reader);
    expect(c.secrets.master_key).toBe(strong());
    expect(c.secrets.session_secret).toBe(strong());
    // A provided key is still checked.
    expect(() => loadConfig(env, (p) => (p.endsWith("session_secret") ? "short" : reader(p)))).toThrow(
      /shorter/,
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
    expect(d.developmentMode).toBe(false);
    const c = loadConfig(
      { ...env, MOBSIMLAB_TRUSTED_PROXIES: "loopback, 172.16.0.0/12", MOBSIMLAB_RATE_LIMIT_AUTH: "20" },
      reader,
    );
    expect(c.trustedProxies).toEqual(["loopback", "172.16.0.0/12"]);
    expect(c.rateLimits.authPerMinute).toBe(20);
    expect(() => loadConfig({ ...env, MOBSIMLAB_TRUSTED_PROXIES: "*" }, reader)).toThrow(/TRUSTED_PROXIES/);
  });

  describe("desktop local mode", () => {
    const local = {
      ...env,
      MOBSIMLAB_PUBLIC_URL: "http://127.0.0.1:47800",
      MOBSIMLAB_LOCAL_MODE: "true",
      MOBSIMLAB_LISTEN_HOST: "127.0.0.1",
    };
    const withKey = (p: string) => (p === "/s/local_launch_key" ? strong() : reader(p));

    it("starts with a launch key on the loopback address", () => {
      const c = loadConfig(local, withKey);
      expect(c.localLaunchKey).toBe(strong());
      expect(c.listenHost).toBe("127.0.0.1");
      expect(c.agentsDisabled).toBeUndefined();
      expect(loadConfig({ ...local, MOBSIMLAB_AGENTS_ENABLED: "false" }, withKey).agentsDisabled).toBe(true);
    });

    it("refuses local mode without a launch key, off loopback, or with a provider", () => {
      expect(() => loadConfig(local, reader)).toThrow(/local_launch_key is missing/);
      expect(() => loadConfig({ ...local, MOBSIMLAB_LISTEN_HOST: "0.0.0.0" }, withKey)).toThrow(
        /MOBSIMLAB_LISTEN_HOST=127.0.0.1/,
      );
      expect(() =>
        loadConfig({ ...local, MOBSIMLAB_PUBLIC_URL: "https://mobsimlab.example.org" }, withKey),
      ).toThrow(/loopback/);
      expect(() =>
        loadConfig(
          { ...local, MOBSIMLAB_OIDC_ISSUER: "https://idp.example.org", MOBSIMLAB_OIDC_CLIENT_ID: "x" },
          withKey,
        ),
      ).toThrow(/does not use a sign-in provider/);
    });

    it("is off on a server", () => {
      expect(loadConfig(env, reader).localLaunchKey).toBeUndefined();
    });
  });
});
