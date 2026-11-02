-- 0003: AI agent connections through MCP (ADR-0035): OAuth 2.1 clients, connections and tokens, personal access
-- tokens, and the agent scenarios they work in. Only SHA-256 hashes of tokens and codes are stored.

CREATE SCHEMA agent;
GRANT USAGE ON SCHEMA agent TO mobsimlab_app;

-- Admins can switch off Dynamic Client Registration (RFC 7591); then only pre-registered clients connect.
ALTER TABLE iam.instance ADD COLUMN agent_registration boolean NOT NULL DEFAULT true;

-- OAuth clients (Claude, other MCP clients). Public clients: no secret, PKCE is mandatory.
CREATE TABLE agent.client (
  id            text PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 100),
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  redirect_uris text[] NOT NULL CHECK (cardinality(redirect_uris) BETWEEN 1 AND 10),
  client_uri    text,
  registered_by text NOT NULL CHECK (registered_by IN ('dynamic', 'admin')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz
);

-- Authorization requests waiting for the user's consent (10 minutes).
CREATE TABLE agent.consent_request (
  id_hash        bytea PRIMARY KEY,
  client_id      text NOT NULL REFERENCES agent.client (id) ON DELETE CASCADE,
  redirect_uri   text NOT NULL,
  scopes         text[] NOT NULL,
  code_challenge text NOT NULL,
  state          text,
  resource       text NOT NULL,
  expires_at     timestamptz NOT NULL
);

-- One connection: an OAuth consent of a user to a client, or a personal access token.
CREATE TABLE agent.connection (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES iam."user" (id),
  client_id    text REFERENCES agent.client (id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('oauth', 'pat')),
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  scopes       text[] NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  CHECK ((kind = 'oauth') = (client_id IS NOT NULL))
);
CREATE INDEX connection_user_idx ON agent.connection (user_id) WHERE revoked_at IS NULL;

-- Authorization codes (single use, 1 minute), access tokens (1 hour), refresh tokens (rotating, 30 days
-- of non-use) and personal access tokens (until their expiry date).
CREATE TABLE agent.token (
  token_hash     bytea PRIMARY KEY,
  connection_id  uuid NOT NULL REFERENCES agent.connection (id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('code', 'access', 'refresh', 'pat')),
  redirect_uri   text,
  code_challenge text,
  resource       text,
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX token_connection_idx ON agent.token (connection_id);
CREATE INDEX token_expiry_idx ON agent.token (expires_at);

-- Scenarios agents create and edit (ADR-0013 overlays, ADR-0035 §3). Until the projects module arrives they
-- live in the user's own workspace. The document holds stops, lines and service levels; see
-- apps/api/src/agents/scenario.ts.
CREATE TABLE agent.scenario (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES iam."user" (id),
  connection_id uuid REFERENCES agent.connection (id) ON DELETE SET NULL,
  origin      text NOT NULL CHECK (origin IN ('agent', 'user')),
  client_name text,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 4000),
  parent_id   uuid REFERENCES agent.scenario (id) ON DELETE SET NULL,
  version     integer NOT NULL DEFAULT 1,
  doc         jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scenario_owner_idx ON agent.scenario (owner_id, updated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON agent.client, agent.consent_request, agent.connection, agent.token,
  agent.scenario TO mobsimlab_app;
