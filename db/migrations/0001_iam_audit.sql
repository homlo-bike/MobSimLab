-- 0001: identity, sessions and the hash-chained audit log (05 §3.1–3.2, 04 §3.4).
-- Runs as mobsimlab_migrator, which owns every object. The app role gets only what it needs.

CREATE SCHEMA iam;
CREATE SCHEMA audit;
GRANT USAGE ON SCHEMA iam, audit TO mobsimlab_app;

-- Instance state. Exactly one row (id is always true).
CREATE TABLE iam.instance (
  id                boolean PRIMARY KEY DEFAULT true CHECK (id),
  mode              text NOT NULL DEFAULT 'setup' CHECK (mode IN ('setup', 'open')),
  name              text NOT NULL DEFAULT 'MobSimLab' CHECK (length(name) BETWEEN 1 AND 100),
  auto_registration boolean NOT NULL DEFAULT false,
  default_role      text NOT NULL DEFAULT 'viewer' CHECK (default_role IN ('user', 'viewer')),
  setup_finished_at timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
INSERT INTO iam.instance DEFAULT VALUES;

CREATE TABLE iam."user" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text,
  display_name  text,
  instance_role text NOT NULL CHECK (instance_role IN ('owner', 'admin', 'user', 'viewer', 'restricted')),
  status        text NOT NULL CHECK (status IN ('pending', 'active', 'deleted')),
  role_override boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE INDEX user_role_idx ON iam."user" (instance_role) WHERE status = 'active';

-- Accounts are matched by (issuer, subject), never by e-mail alone.
CREATE TABLE iam.identity (
  issuer       text NOT NULL,
  subject      text NOT NULL,
  user_id      uuid NOT NULL REFERENCES iam."user" (id),
  email        text,
  groups       jsonb NOT NULL DEFAULT '[]',
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer, subject)
);
CREATE INDEX identity_user_idx ON iam.identity (user_id);

-- Pending OIDC authorisation requests. Keyed by a hash of the state value; rows live 10 minutes.
CREATE TABLE iam.auth_flow (
  state_hash    bytea PRIMARY KEY,
  code_verifier text NOT NULL,
  nonce         text NOT NULL,
  return_to     text NOT NULL DEFAULT '/',
  expires_at    timestamptz NOT NULL
);

-- Server-side sessions. Only a SHA-256 hash of the cookie value is stored.
CREATE TABLE iam.session (
  token_hash          bytea PRIMARY KEY,
  user_id             uuid NOT NULL REFERENCES iam."user" (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  idle_expires_at     timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at          timestamptz
);
CREATE INDEX session_user_idx ON iam.session (user_id) WHERE revoked_at IS NULL;

GRANT SELECT, UPDATE ON iam.instance TO mobsimlab_app;
GRANT SELECT, INSERT, UPDATE ON iam."user", iam.identity TO mobsimlab_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON iam.auth_flow, iam.session TO mobsimlab_app;

-- Audit log. One hash chain per project and one for the instance ('instance').
-- hash = sha256(prev_hash || canonical JSON of the record). jsonb sorts keys, so its text form is canonical.
CREATE TABLE audit.record (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chain         text NOT NULL,
  seq           bigint NOT NULL,
  at            timestamptz NOT NULL DEFAULT now(),
  actor_id      uuid,
  actor_ip_hash text,
  action        text NOT NULL,
  object_type   text NOT NULL,
  object_id     text,
  project_id    uuid,
  before        jsonb,
  after         jsonb,
  reason        text,
  request_id    text,
  prev_hash     bytea,
  hash          bytea NOT NULL,
  UNIQUE (chain, seq)
);

CREATE TABLE audit.chain_head (
  chain text PRIMARY KEY,
  seq   bigint NOT NULL,
  hash  bytea NOT NULL
);

-- Purpose: the canonical bytes that are hashed for one record.
CREATE FUNCTION audit.canonical(r audit.record) RETURNS bytea
LANGUAGE sql IMMUTABLE AS $$
  SELECT convert_to(jsonb_build_object(
    'chain', r.chain, 'seq', r.seq, 'at', to_char(r.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'actor_id', r.actor_id, 'actor_ip_hash', r.actor_ip_hash, 'action', r.action,
    'object_type', r.object_type, 'object_id', r.object_id, 'project_id', r.project_id,
    'before', r.before, 'after', r.after, 'reason', r.reason, 'request_id', r.request_id
  )::text, 'UTF8')
$$;

-- Purpose: append one record to a chain. The chain head row lock serialises writers per chain.
-- The app role can only call this function; it cannot insert, update or delete records directly.
CREATE FUNCTION audit.append(
  p_chain text, p_actor_id uuid, p_actor_ip_hash text, p_action text, p_object_type text,
  p_object_id text, p_project_id uuid, p_before jsonb, p_after jsonb, p_reason text, p_request_id text
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, audit AS $$
DECLARE
  h  audit.chain_head;
  r  audit.record;
BEGIN
  INSERT INTO audit.chain_head (chain, seq, hash) VALUES (p_chain, 0, '\x'::bytea) ON CONFLICT (chain) DO NOTHING;
  SELECT * INTO h FROM audit.chain_head WHERE chain = p_chain FOR UPDATE;
  r.chain := p_chain; r.seq := h.seq + 1; r.at := clock_timestamp();
  r.actor_id := p_actor_id; r.actor_ip_hash := p_actor_ip_hash; r.action := p_action;
  r.object_type := p_object_type; r.object_id := p_object_id; r.project_id := p_project_id;
  r.before := p_before; r.after := p_after; r.reason := p_reason; r.request_id := p_request_id;
  r.prev_hash := CASE WHEN h.seq = 0 THEN NULL ELSE h.hash END;
  r.hash := sha256(coalesce(r.prev_hash, '\x'::bytea) || audit.canonical(r));
  INSERT INTO audit.record (chain, seq, at, actor_id, actor_ip_hash, action, object_type, object_id,
                            project_id, before, after, reason, request_id, prev_hash, hash)
  VALUES (r.chain, r.seq, r.at, r.actor_id, r.actor_ip_hash, r.action, r.object_type, r.object_id,
          r.project_id, r.before, r.after, r.reason, r.request_id, r.prev_hash, r.hash)
  RETURNING id INTO r.id;
  UPDATE audit.chain_head SET seq = r.seq, hash = r.hash WHERE chain = p_chain;
  RETURN r.id;
END
$$;

-- Purpose: verify one chain. Returns the seq of the first broken record, or NULL if the chain is intact.
CREATE FUNCTION audit.verify(p_chain text) RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, audit AS $$
DECLARE
  r    audit.record;
  prev bytea := NULL;
  n    bigint := 0;
BEGIN
  FOR r IN SELECT * FROM audit.record WHERE chain = p_chain ORDER BY seq LOOP
    n := n + 1;
    IF r.seq <> n OR r.prev_hash IS DISTINCT FROM prev
       OR r.hash <> sha256(coalesce(prev, '\x'::bytea) || audit.canonical(r)) THEN
      RETURN r.seq;
    END IF;
    prev := r.hash;
  END LOOP;
  IF n <> coalesce((SELECT seq FROM audit.chain_head WHERE chain = p_chain), 0) THEN
    RETURN n + 1;
  END IF;
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION audit.append, audit.verify FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.append, audit.verify TO mobsimlab_app;
GRANT SELECT ON audit.record TO mobsimlab_app;
