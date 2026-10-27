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
  dbHost: string;
  bootstrapOwnerEmail?: string;
  secrets: Record<ApiSecretName, string>;
}

/** Error that stops start-up. The message never contains a secret value. */
export class ConfigError extends Error {}

const envSchema = z.object({
  MOBSIMLAB_PUBLIC_URL: z.url({ protocol: /^https?$/ }),
  MOBSIMLAB_DB_HOST: z.string().min(1),
  MOBSIMLAB_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  MOBSIMLAB_SECRETS_DIR: z.string().min(1).default("/run/secrets"),
  MOBSIMLAB_BOOTSTRAP_OWNER_EMAIL: z.email().optional(),
});

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
  if (problems.length > 0 || !parsed.success) {
    throw new ConfigError(`MobSimLab refuses to start:\n - ${problems.join("\n - ")}`);
  }
  const d = parsed.data;
  return {
    port: d.MOBSIMLAB_PORT,
    publicUrl: new URL(d.MOBSIMLAB_PUBLIC_URL),
    dbHost: d.MOBSIMLAB_DB_HOST,
    bootstrapOwnerEmail: d.MOBSIMLAB_BOOTSTRAP_OWNER_EMAIL,
    secrets,
  };
}
