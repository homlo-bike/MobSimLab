import type { ColumnType, Generated } from "kysely";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { AppConfig } from "../config/env";

/** Instance roles (05 §3.2), highest first. */
export const INSTANCE_ROLES = ["owner", "admin", "user", "viewer", "restricted"] as const;
export type InstanceRole = (typeof INSTANCE_ROLES)[number];

/** Roles a group mapping may grant. Owner is never granted automatically. */
export const MAPPABLE_ROLES = ["admin", "user", "viewer", "restricted"] as const;
export type MappableRole = (typeof MAPPABLE_ROLES)[number];

/**
 * Purpose: rank of a role (0 = owner, highest).
 * Inputs: role. Output: index in INSTANCE_ROLES.
 */
export function roleRank(role: InstanceRole): number {
  return INSTANCE_ROLES.indexOf(role);
}

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

/** Table types for the tables the API reads and writes (db/migrations). */
export interface DB {
  "iam.instance": {
    id: Generated<boolean>;
    mode: "setup" | "open";
    name: string;
    auto_registration: boolean;
    default_role: "user" | "viewer";
    allowed_email_domains: ColumnType<string[], never, string[]>;
    allowed_groups: ColumnType<string[], never, string[]>;
    setup_finished_at: Date | null;
    updated_at: Timestamp;
  };
  "iam.user": {
    id: Generated<string>;
    email: string | null;
    display_name: string | null;
    instance_role: InstanceRole;
    status: "pending" | "active" | "deleted";
    role_override: Generated<boolean>;
    created_at: Generated<Date>;
    last_login_at: Date | null;
    deleted_at: ColumnType<Date | null, never, Date | null>;
  };
  "iam.identity": {
    issuer: string;
    subject: string;
    user_id: string;
    email: string | null;
    groups: ColumnType<string[], string, string>;
    last_seen_at: Timestamp;
  };
  "iam.auth_flow": {
    state_hash: Buffer;
    code_verifier: string;
    nonce: string;
    return_to: string;
    expires_at: Date;
  };
  "iam.session": {
    token_hash: Buffer;
    user_id: string;
    created_at: Generated<Date>;
    last_seen_at: Timestamp;
    idle_expires_at: Date;
    absolute_expires_at: Date;
    revoked_at: Date | null;
  };
  "iam.group_mapping": {
    id: Generated<string>;
    issuer: string | null;
    group_value: string;
    instance_role: MappableRole;
    created_at: Generated<Date>;
  };
  "audit.record": {
    id: Generated<string>;
    chain: string;
    seq: string;
    at: Date;
    actor_id: string | null;
    action: string;
    object_type: string;
    object_id: string | null;
    before: unknown;
    after: unknown;
    reason: string | null;
  };
}

/** Injection token for the Kysely instance. */
export const DATABASE = Symbol("DATABASE");
export type Database = Kysely<DB>;

/**
 * Purpose: create the connection pool for the app role.
 * Inputs: validated config. Output: a Kysely instance; no connection is opened until the first query.
 */
export function createDatabase(config: AppConfig): Database {
  const pool = new Pool({
    host: config.db.host,
    port: config.db.port,
    database: config.db.name,
    user: "mobsimlab_app",
    password: config.secrets.db_app_password,
    max: 10,
  });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}
