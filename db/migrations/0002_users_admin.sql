-- 0002: user administration, group mappings, auto-registration rules and rate limiting (05 §3.2, §3.5, §4).

-- Auto-registration rules. Empty lists mean "no restriction".
ALTER TABLE iam.instance
  ADD COLUMN allowed_email_domains text[] NOT NULL DEFAULT '{}',
  ADD COLUMN allowed_groups        text[] NOT NULL DEFAULT '{}';

ALTER TABLE iam."user" ADD COLUMN deleted_at timestamptz;

-- IdP group claim value -> instance role. Recomputed on every sign-in unless the user's role is pinned
-- (role_override). Owner cannot be granted by a mapping. issuer NULL matches every provider.
CREATE TABLE iam.group_mapping (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issuer        text,
  group_value   text NOT NULL CHECK (length(group_value) BETWEEN 1 AND 200),
  instance_role text NOT NULL CHECK (instance_role IN ('admin', 'user', 'viewer', 'restricted')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX group_mapping_uniq ON iam.group_mapping (coalesce(issuer, ''), group_value);

-- Token buckets for rate limiting. Unlogged: losing them on a crash only resets the limits.
CREATE UNLOGGED TABLE iam.rate_limit (
  key        text PRIMARY KEY,
  tokens     double precision NOT NULL,
  updated_at timestamptz NOT NULL
);

-- Purpose: take one token from a bucket that holds `capacity` tokens and refills at `per_second`.
-- Returns true when a token was available. The row lock serialises concurrent requests for one key.
CREATE FUNCTION iam.take_token(p_key text, p_capacity double precision, p_per_second double precision)
RETURNS boolean
LANGUAGE plpgsql SET search_path = pg_catalog, iam AS $$
DECLARE
  available double precision;
BEGIN
  INSERT INTO iam.rate_limit AS r (key, tokens, updated_at) VALUES (p_key, p_capacity, clock_timestamp())
  ON CONFLICT (key) DO UPDATE
    SET tokens = least(p_capacity,
                       r.tokens + extract(epoch FROM clock_timestamp() - r.updated_at) * p_per_second),
        updated_at = clock_timestamp()
  RETURNING tokens INTO available;
  IF available < 1 THEN
    RETURN false;
  END IF;
  UPDATE iam.rate_limit SET tokens = available - 1 WHERE key = p_key;
  RETURN true;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON iam.group_mapping TO mobsimlab_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON iam.rate_limit TO mobsimlab_app;
GRANT EXECUTE ON FUNCTION iam.take_token(text, double precision, double precision) TO mobsimlab_app;
