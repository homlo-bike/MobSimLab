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
/** Who can open a project: its members only, or anyone signed in to this instance, read-only (0013). */
export const PROJECT_VISIBILITIES = ["private", "public"] as const;
export type ProjectVisibility = (typeof PROJECT_VISIBILITIES)[number];

/** How a simulation run stands (db/migrations/0007_simulation_runs.sql). */
export const RUN_STATUSES = ["queued", "running", "done", "failed", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Where a population layer comes from (db/migrations/0014_population.sql). */
export type PopulationLayerSource = "worldpop" | "ghsl" | "upload";
/** What a population layer holds: grid cells, zone polygons or points. */
export type PopulationLayerKind = "grid" | "zones" | "points";
export type PopulationLayerStatus = "importing" | "ready" | "failed";
export type PopulationConfidence = "high" | "medium" | "low";

/**
 * Kinds of simulation run: the rail capacity run, a sweep of its settings (0008_agent_runs.sql), the road
 * simulation (0009_road_runs.sql), the demand model (0012_demand_runs.sql) and calendar runs
 * (0015_calendar_runs.sql).
 */
export type RunKind = "capacity" | "sweep" | "road" | "demand" | "calendar";

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
    plugin_memory_mb: Generated<number>;
    plugin_time_s: Generated<number>;
    /** ArcGIS API key for Esri World Imagery (db/migrations/0019_esri_imagery.sql); never sent to browsers. */
    esri_api_key: string | null;
    esri_terms_accepted_at: Date | null;
    esri_terms_accepted_by: string | null;
  };
  "iam.user": {
    id: Generated<string>;
    email: string | null;
    email_verified: Generated<boolean>;
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
    /** The provider's ID token, kept only for `id_token_hint` at sign-out; null once revoked. */
    id_token: Generated<string | null>;
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
    visibility: Generated<ProjectVisibility>;
    copied_from: string | null;
    created_at: Generated<Date>;
    updated_at: Timestamp;
    archived_at: Date | null;
    deleted_at: Date | null;
    /** Polygons the planner drew as the project area (projects/area-polygons.ts `AreaPolygon[]`). */
    area_polygons: ColumnType<unknown, string | undefined, string>;
  };
  "project.data_cache": {
    project_id: string;
    kind: "osm" | "height" | "facts";
    key: string;
    body: string;
    fetched_at: Generated<Date>;
  };
  /** Results the project's tools worked out (db/migrations/0023_project_results.sql): gzip-compressed JSON. */
  "project.result": {
    project_id: string;
    kind: string;
    inputs: string;
    body: Buffer;
    computed_by: string | null;
    computed_at: Generated<Date>;
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
  /** Comments on project objects (db/migrations/0016_comments.sql). */
  "collab.comment": {
    id: Generated<string>;
    project_id: string;
    object_type: string;
    object_id: string;
    parent_id: string | null;
    body: string;
    author_id: string | null;
    created_at: Generated<Date>;
    edited_at: Date | null;
    resolved_at: Date | null;
    resolved_by: string | null;
  };
  /** Files a run saves next to its result, such as a demand run's OD matrices (0012_demand_runs.sql). */
  "simulation.run_file": {
    run_id: string;
    name: string;
    media_type: string;
    content: Buffer;
    created_at: Generated<Date>;
  };
  "project.member": {
    project_id: string;
    user_id: string;
    role: ProjectRole;
    added_by: string | null;
    created_at: Generated<Date>;
  };
  /** WMS and WMTS services an Admin added as map layers (db/migrations/0023_map_layer_services.sql). */
  "plugin.map_layer_service": {
    id: Generated<string>;
    kind: "wms" | "wmts" | "xyz";
    name: string;
    url: string;
    auth_type: "none" | "basic" | "query" | "header";
    auth_name: string | null;
    /** Password or key; never sent to browsers, logged or audited. */
    auth_secret: string | null;
    show_as: "basemap" | "overlay";
    attribution: string;
    layers: ColumnType<unknown, string, never>;
    /** Id of a service MobSimLab comes with (builtin-layers.ts); null for an Admin's. */
    builtin: string | null;
    hidden: Generated<boolean>;
    added_by: string | null;
    added_at: Generated<Date>;
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
  "plugin.file": {
    plugin_id: string;
    version: string;
    path: string;
    media_type: string;
    data: Buffer;
    sha256: string;
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
  /** WARN+ log entries, one partition per day (0010_logs.sql). The app role may only insert. */
  "logs.entry": {
    id: Generated<string>;
    at: ColumnType<Date, string | undefined, never>;
    level: string;
    origin: string;
    module: string | null;
    message: string;
    request_id: string | null;
    user_id: string | null;
    project_id: string | null;
    run_id: string | null;
    context: ColumnType<unknown, string | null, never>;
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
