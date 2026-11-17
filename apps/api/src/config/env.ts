import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { LOG_LEVELS, type LoggingConfig } from "../logging/logger";

/** Secret files the API reads from the secrets directory (Docker secrets); master_key and session_secret are optional. */
export const API_SECRETS = ["db_app_password", "master_key", "session_secret"] as const;
export type ApiSecretName = (typeof API_SECRETS)[number];

/** Minimum lengths. Keys are 32 random bytes, base64 encoded (44 chars). */
const MIN_LENGTH: Record<ApiSecretName, number> = {
  db_app_password: 24,
  master_key: 44,
  session_secret: 44,
};

/**
 * Where each secret is read from, first file that exists and is not empty wins. db_app_password: the role's own
 * file (separate role passwords), else the one db_password. master_key and session_secret: only a Docker secret the
 * operator provided; they are optional (see OPTIONAL_SECRETS).
 */
const SECRET_SOURCES: Record<ApiSecretName, (dir: string) => string[]> = {
  db_app_password: (dir) => [join(dir, "db_app_password"), join(dir, "db_password")],
  master_key: (dir) => [join(dir, "master_key")],
  session_secret: (dir) => [join(dir, "session_secret")],
};

/**
 * Secrets the operator may leave out. Without session_secret, a random key is made at each start, kept in memory
 * only: CSRF tokens then end at a restart (people reload the page) and audit IP hashes do not match across restarts.
 * master_key is not used by any code yet.
 */
const OPTIONAL_SECRETS = new Set<ApiSecretName>(["master_key", "session_secret"]);

/** Purpose: the trimmed content of the first of `paths` that can be read and is not empty, or undefined. */
function firstSecret(readFile: (path: string) => string, paths: string[]): string | undefined {
  for (const p of paths) {
    try {
      const v = readFile(p).trim();
      if (v) return v;
    } catch {
      // try the next one
    }
  }
  return undefined;
}

/** Values that appear in examples and tutorials. Never accepted. */
const KNOWN_WEAK = [
  "changeme",
  "change-me",
  "password",
  "secret",
  "example",
  "mobsimlab",
  "postgres",
  "admin",
];

/** Validated runtime configuration. */
export interface AppConfig {
  port: number;
  publicUrl: URL;
  db: { host: string; port: number; name: string };
  bootstrapOwnerEmail?: string;
  bootstrapOwnerSubject?: string;
  /** Bootstrap sign-in provider. Absent: sign-in is disabled until one is configured. */
  oidc?: OidcConfig;
  /**
   * Express `trust proxy` value: which reverse proxies may set X-Forwarded-For. Absent: none, so the client
   * address is the TCP peer. Needed for per-IP rate limits and audit IP hashes behind a TLS proxy.
   */
  trustedProxies?: string[];
  /**
   * Development mode (ADR-0036 §9): only then may an Owner allow unsigned plugins. Never set it on an instance
   * that holds real plans.
   */
  developmentMode: boolean;
  /** Logging (ADR-0022). Absent: INFO to the console, no file. */
  logging?: LoggingConfig;
  /** Token-bucket limits (05 §3.5), in requests per minute. */
  rateLimits: { authPerMinute: number; writesPerMinute: number };
  /** master_key is absent unless the operator provided it; session_secret is random per start if not provided. */
  secrets: { db_app_password: string; session_secret: string; master_key?: string };
  /**
   * Desktop app, "Use on this computer" (local mode): the key the desktop app adds to its own requests so that its
   * single local Owner is signed in without a provider (`POST /api/auth/local`). Absent on a server.
   */
  localLaunchKey?: string;
  /** Interface the API listens on. Absent: every interface (the container). The desktop app uses 127.0.0.1. */
  listenHost?: string;
  /** AI agent endpoints (`/mcp`, OAuth) switched off. The desktop app's local mode starts with them off. */
  agentsDisabled?: boolean;
}

/** The OIDC provider used for the first login (more providers are added in the setup wizard later). */
export interface OidcConfig {
  issuer: URL;
  clientId: string;
  /** Absent for a public client; PKCE is used either way. */
  clientSecret?: string;
  /** Development only: allow an http:// issuer (for a local mock provider). */
  allowInsecureHttp: boolean;
}

/** Error that stops start-up. The message never contains a secret value. */
export class ConfigError extends Error {}

const envSchema = z.object({
  MOBSIMLAB_PUBLIC_URL: z.url({ protocol: /^https?$/ }),
  MOBSIMLAB_DB_HOST: z.string().min(1),
  MOBSIMLAB_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  MOBSIMLAB_SECRETS_DIR: z.string().min(1).default("/run/secrets"),
  MOBSIMLAB_DB_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  MOBSIMLAB_DB_NAME: z.string().min(1).default("mobsimlab"),
  MOBSIMLAB_BOOTSTRAP_OWNER_EMAIL: z.preprocess(emptyToUndefined, z.email().optional()),
  MOBSIMLAB_BOOTSTRAP_OWNER_SUBJECT: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  MOBSIMLAB_OIDC_ISSUER: z.preprocess(emptyToUndefined, z.url({ protocol: /^https?$/ }).optional()),
  MOBSIMLAB_OIDC_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  MOBSIMLAB_OIDC_ALLOW_INSECURE_HTTP: z.enum(["true", "false"]).default("false"),
  MOBSIMLAB_TRUSTED_PROXIES: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  MOBSIMLAB_DEVELOPMENT_MODE: z.enum(["true", "false"]).default("false"),
  MOBSIMLAB_RATE_LIMIT_AUTH: z.coerce.number().int().min(1).max(10_000).default(10),
  MOBSIMLAB_RATE_LIMIT_WRITES: z.coerce.number().int().min(1).max(100_000).default(120),
  MOBSIMLAB_LOG_LEVEL: z.preprocess(
    (v) => (typeof v === "string" && v ? v.toLowerCase() : undefined),
    z.enum(LOG_LEVELS).default("info"),
  ),
  MOBSIMLAB_LOG_DIR: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  MOBSIMLAB_LOCAL_MODE: z.enum(["true", "false"]).default("false"),
  MOBSIMLAB_LISTEN_HOST: z.preprocess(emptyToUndefined, z.ipv4().or(z.ipv6()).optional()),
  MOBSIMLAB_AGENTS_ENABLED: z.enum(["true", "false"]).default("true"),
});

/** Loopback host names the desktop app's local mode may use. */
const LOOPBACK = new Set(["127.0.0.1", "[::1]", "localhost"]);

/** Accepted entries for MOBSIMLAB_TRUSTED_PROXIES: an IP, a CIDR range, or an Express keyword. */
const PROXY_ENTRY = /^(loopback|linklocal|uniquelocal|[0-9a-fA-F:.]+(\/\d{1,3})?)$/;

/** Compose passes unset variables from .env as empty strings; treat them as absent. */
function emptyToUndefined(v: unknown): unknown {
  return v === "" ? undefined : v;
}

/**
 * Purpose: check that a secret is strong enough to use.
 * Inputs: secret name and value. Output: a problem description, or null if acceptable.
 */
export function secretProblem(name: ApiSecretName, value: string): string | null {
  if (value.length < MIN_LENGTH[name]) return `${name} is shorter than ${MIN_LENGTH[name]} characters`;
  const lower = value.toLowerCase();
  if (KNOWN_WEAK.some((w) => lower.includes(w))) return `${name} contains a well-known example value`;
  if (new Set(value).size < 10) return `${name} has too little variety (fewer than 10 distinct characters)`;
  return null;
}

/**
 * Purpose: load and validate configuration at start-up.
 * Inputs: environment variables and a file reader (injectable for tests).
 * Output: AppConfig. Throws ConfigError listing every problem, so the operator can fix all at once.
 * Side effects: reads secret files.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  readFile: (path: string) => string = (p) => readFileSync(p, "utf8"),
): AppConfig {
  const problems: string[] = [];
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) problems.push(`${issue.path.join(".")}: ${issue.message}`);
  }
  const dir = parsed.success ? parsed.data.MOBSIMLAB_SECRETS_DIR : "/run/secrets";
  const secrets: Partial<Record<ApiSecretName, string>> = {};
  for (const name of API_SECRETS) {
    const value = firstSecret(readFile, SECRET_SOURCES[name](dir));
    if (value === undefined) {
      if (!OPTIONAL_SECRETS.has(name))
        problems.push("secret db_password is missing (run deploy/scripts/init-secrets)");
      continue;
    }
    const p = secretProblem(name, value);
    if (p) problems.push(p);
    secrets[name] = value;
  }
  let oidcSecret: string | undefined;
  try {
    oidcSecret = readFile(join(dir, "oidc_client_secret")).trim() || undefined;
  } catch {
    oidcSecret = undefined;
  }
  let localLaunchKey: string | undefined;
  if (parsed.success && parsed.data.MOBSIMLAB_LOCAL_MODE === "true") {
    try {
      localLaunchKey = readFile(join(dir, "local_launch_key")).trim();
      if (localLaunchKey.length < 44 || new Set(localLaunchKey).size < 10)
        problems.push("local_launch_key is too short or has too little variety");
    } catch {
      problems.push("secret local_launch_key is missing (local mode is started by the desktop app)");
    }
  }
  if (parsed.success) {
    const d = parsed.data;
    if (d.MOBSIMLAB_LOCAL_MODE === "true") {
      // Local mode signs its Owner in without a provider, so it must never be reachable from the network.
      if (!LOOPBACK.has(new URL(d.MOBSIMLAB_PUBLIC_URL).hostname))
        problems.push("MOBSIMLAB_LOCAL_MODE needs a loopback MOBSIMLAB_PUBLIC_URL (http://127.0.0.1:<port>)");
      if (d.MOBSIMLAB_LISTEN_HOST !== "127.0.0.1" && d.MOBSIMLAB_LISTEN_HOST !== "::1")
        problems.push("MOBSIMLAB_LOCAL_MODE needs MOBSIMLAB_LISTEN_HOST=127.0.0.1");
      if (d.MOBSIMLAB_OIDC_ISSUER) problems.push("MOBSIMLAB_LOCAL_MODE does not use a sign-in provider");
    }
    if (Boolean(d.MOBSIMLAB_OIDC_ISSUER) !== Boolean(d.MOBSIMLAB_OIDC_CLIENT_ID)) {
      problems.push("MOBSIMLAB_OIDC_ISSUER and MOBSIMLAB_OIDC_CLIENT_ID must be set together");
    }
    for (const p of splitList(d.MOBSIMLAB_TRUSTED_PROXIES)) {
      if (!PROXY_ENTRY.test(p))
        problems.push(`MOBSIMLAB_TRUSTED_PROXIES: "${p}" is not an IP, CIDR or keyword`);
    }
    if (d.MOBSIMLAB_OIDC_ISSUER?.startsWith("http:") && d.MOBSIMLAB_OIDC_ALLOW_INSECURE_HTTP !== "true") {
      problems.push("MOBSIMLAB_OIDC_ISSUER must use https");
    }
  }
  if (problems.length > 0 || !parsed.success) {
    throw new ConfigError(`MobSimLab refuses to start:\n - ${problems.join("\n - ")}`);
  }
  const d = parsed.data;
  return {
    port: d.MOBSIMLAB_PORT,
    publicUrl: new URL(d.MOBSIMLAB_PUBLIC_URL),
    db: { host: d.MOBSIMLAB_DB_HOST, port: d.MOBSIMLAB_DB_PORT, name: d.MOBSIMLAB_DB_NAME },
    bootstrapOwnerEmail: d.MOBSIMLAB_BOOTSTRAP_OWNER_EMAIL,
    bootstrapOwnerSubject: d.MOBSIMLAB_BOOTSTRAP_OWNER_SUBJECT,
    oidc:
      d.MOBSIMLAB_OIDC_ISSUER && d.MOBSIMLAB_OIDC_CLIENT_ID
        ? {
            issuer: new URL(d.MOBSIMLAB_OIDC_ISSUER),
            clientId: d.MOBSIMLAB_OIDC_CLIENT_ID,
            clientSecret: oidcSecret,
            allowInsecureHttp: d.MOBSIMLAB_OIDC_ALLOW_INSECURE_HTTP === "true",
          }
        : undefined,
    trustedProxies: d.MOBSIMLAB_TRUSTED_PROXIES ? splitList(d.MOBSIMLAB_TRUSTED_PROXIES) : undefined,
    developmentMode: d.MOBSIMLAB_DEVELOPMENT_MODE === "true",
    logging: { level: d.MOBSIMLAB_LOG_LEVEL, dir: d.MOBSIMLAB_LOG_DIR },
    rateLimits: {
      authPerMinute: d.MOBSIMLAB_RATE_LIMIT_AUTH,
      writesPerMinute: d.MOBSIMLAB_RATE_LIMIT_WRITES,
    },
    secrets: {
      db_app_password: secrets.db_app_password ?? "",
      session_secret: secrets.session_secret ?? randomBytes(32).toString("base64"),
      master_key: secrets.master_key,
    },
    localLaunchKey,
    listenHost: d.MOBSIMLAB_LISTEN_HOST,
    agentsDisabled: d.MOBSIMLAB_AGENTS_ENABLED === "false" ? true : undefined,
  };
}

function splitList(v: string | undefined): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Purpose: whether the operator named the first Owner (MOBSIMLAB_BOOTSTRAP_OWNER_EMAIL or _SUBJECT). Without one,
 * setup mode refuses every sign-in, so nobody else who can sign in at the provider can claim the instance first.
 */
export function bootstrapOwnerSet(
  config: Pick<AppConfig, "bootstrapOwnerEmail" | "bootstrapOwnerSubject">,
): boolean {
  return Boolean(config.bootstrapOwnerEmail || config.bootstrapOwnerSubject);
}
