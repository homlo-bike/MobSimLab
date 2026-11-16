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

/** How a simulation run stands (db/migrations/0007_simulation_runs.sql). */
export const RUN_STATUSES = ["queued", "running", "done", "failed", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Where a population layer comes from (db/migrations/0014_population.sql). */
export type PopulationLayerSource = "worldpop" | "ghsl" | "upload";
/** What a population layer holds: grid cells, zone polygons or points. */
export type PopulationLayerKind = "grid" | "zones" | "points";
export type PopulationLayerStatus = "importing" | "ready" | "failed";
export type PopulationConfidence = "high" | "medium" | "low";

/** Kinds of simulation run: the rail capacity run, and a sweep of its settings (0008_agent_runs.sql). */
export type RunKind = "capacity" | "sweep" | "road";

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
    allow_unsigned_plugins: Generated<boolean>;
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
    /** Buffer round the box of everything drawn, km (projects/project-area.ts). */
    area_buffer_km: Generated<number>;
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
  "geo.population_layer": {
    id: Generated<string>;
    project_id: string;
    name: string;
    source: PopulationLayerSource;
    kind: PopulationLayerKind;
    status: Generated<PopulationLayerStatus>;
    error: string | null;
    progress: ColumnType<Record<string, unknown> | null, string | null, string | null>;
    licence: Generated<string>;
    source_url: Generated<string>;
    citation: Generated<string>;
    confidence: PopulationConfidence;
    reference_year: number | null;
    resolution_m: number | null;
    coverage: ColumnType<unknown, never, never>;
    people_total: Generated<number>;
    feature_count: Generated<number>;
    is_primary: Generated<boolean>;
    options: ColumnType<Record<string, unknown>, string, string>;
    created_by: string | null;
    created_at: Generated<Date>;
    updated_at: Timestamp;
  };
  "geo.population_feature": {
    layer_id: string;
    n: number;
    zone_id: string | null;
    people: number;
    geom: ColumnType<unknown, never, never>;
  };
  "simulation.run": {
    id: Generated<string>;
    project_id: string;
    kind: RunKind;
    status: Generated<RunStatus>;
    input: ColumnType<unknown, string, string>;
    network: string;
    lines: string;
    progress: ColumnType<unknown, string | null, string | null>;
    result: ColumnType<unknown, string | null, string | null>;
    error: string | null;
    cancel_requested: Generated<boolean>;
    job_id: string | null;
    created_by: string | null;
    created_at: Generated<Date>;
    started_at: Date | null;
    finished_at: Date | null;
    /** The agent connection that started the run (db/migrations/0008_agent_runs.sql), null for people. */
    agent_connection_id: Generated<string | null>;
  };
  /** The replay of a road run, gzipped JSON (db/migrations/0009_road_runs.sql). */
  "simulation.run_replay": {
    run_id: string;
    data: Buffer;
    created_at: Generated<Date>;
  };
  "project.member": {
    project_id: string;
    user_id: string;
    role: ProjectRole;
    added_by: string | null;
    created_at: Generated<Date>;
  };
  "plugin.trusted_key": {
    id: Generated<string>;
    name: string;
    public_key: string;
    fingerprint: string;
    added_by: string | null;
    added_at: Generated<Date>;
  };
  "plugin.package": {
    plugin_id: string;
    version: string;
    manifest: ColumnType<unknown, string, string>;
    entry: ColumnType<unknown, string, string>;
    sha256: string;
    size_bytes: number;
    signature: "trusted" | "unsigned";
    signed_by: string | null;
    signer_name: string | null;
    installed_by: string | null;
    installed_at: Generated<Date>;
  };
  "project.plugin": {
    project_id: string;
    plugin_id: string;
    enabled: boolean;
    version: string | null;
    updated_by: string | null;
    updated_at: Timestamp;
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
