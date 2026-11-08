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

/** Project roles (05 §3.2), highest first. */
export const PROJECT_ROLES = ["owner", "editor", "commenter", "viewer"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

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
    agent_registration: Generated<boolean>;
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
    preferences: ColumnType<Record<string, unknown>, never, string>;
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
  "agent.client": {
    id: string;
    name: string;
    redirect_uris: ColumnType<string[], string[], string[]>;
    client_uri: string | null;
    registered_by: "dynamic" | "admin";
    created_at: Generated<Date>;
    last_used_at: Date | null;
  };
  "agent.consent_request": {
    id_hash: Buffer;
    client_id: string;
    redirect_uri: string;
    scopes: ColumnType<string[], string[], string[]>;
    code_challenge: string;
    state: string | null;
    resource: string;
    expires_at: Date;
  };
  "agent.connection": {
    id: Generated<string>;
    user_id: string;
    client_id: string | null;
    kind: "oauth" | "pat";
    name: string;
    scopes: ColumnType<string[], string[], string[]>;
    created_at: Generated<Date>;
    last_used_at: Date | null;
    expires_at: Date | null;
    revoked_at: Date | null;
  };
  "agent.token": {
    token_hash: Buffer;
    connection_id: string;
    kind: "code" | "access" | "refresh" | "pat";
    redirect_uri: string | null;
    code_challenge: string | null;
    resource: string | null;
    expires_at: Date;
    used_at: Date | null;
    created_at: Generated<Date>;
  };
  "agent.scenario": {
    id: Generated<string>;
    owner_id: string;
    connection_id: string | null;
    origin: "agent" | "user";
    client_name: string | null;
    name: string;
    description: Generated<string>;
    parent_id: string | null;
    version: Generated<number>;
    doc: ColumnType<unknown, string, string>;
    created_at: Generated<Date>;
    updated_at: Timestamp;
  };
  "project.project": {
    id: Generated<string>;
    name: string;
    description: Generated<string>;
    area_name: string | null;
    modes: ColumnType<string[], string[] | undefined, string[]>;
    link_access: Generated<boolean>;
    copied_from: string | null;
    created_at: Generated<Date>;
    updated_at: Timestamp;
    archived_at: Date | null;
    deleted_at: Date | null;
  };
  "project.drawing": {
    project_id: string;
    kind: string;
    schema_version: Generated<number>;
    doc: ColumnType<unknown, string, string>;
    version: Generated<number>;
    updated_by: string | null;
    updated_at: Timestamp;
  };
  "project.member": {
    project_id: string;
    user_id: string;
    role: ProjectRole;
    added_by: string | null;
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
