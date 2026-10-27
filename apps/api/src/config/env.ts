import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/** Secret files the API needs, read from the secrets directory (Docker secrets). */
export const API_SECRETS = ["db_app_password", "master_key", "session_secret"] as const;
export type ApiSecretName = (typeof API_SECRETS)[number];

/** Minimum lengths. Keys are 32 random bytes, base64 encoded (44 chars). */
const MIN_LENGTH: Record<ApiSecretName, number> = {
  db_app_password: 24,
  master_key: 44,
  session_secret: 44,
};

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
  secrets: Record<ApiSecretName, string>;
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
});

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
  const secrets = {} as Record<ApiSecretName, string>;
  for (const name of API_SECRETS) {
    let value: string;
    try {
      value = readFile(join(dir, name)).trim();
    } catch {
      problems.push(`secret ${name} is missing (run deploy/scripts/init-secrets)`);
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
  if (parsed.success) {
    const d = parsed.data;
    if (Boolean(d.MOBSIMLAB_OIDC_ISSUER) !== Boolean(d.MOBSIMLAB_OIDC_CLIENT_ID)) {
      problems.push("MOBSIMLAB_OIDC_ISSUER and MOBSIMLAB_OIDC_CLIENT_ID must be set together");
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
    secrets,
  };
}
