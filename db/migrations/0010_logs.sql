-- 0010: the PostgreSQL log sink (ADR-0022, 03 §6). Only WARN, ERROR and CRITICAL are stored here; every level
-- goes to the console and the log file. The table is split into one partition per UTC day, and a partition is
-- dropped once it is older than 30 days, so the logs never bloat the database (C-13).
-- AUDIT is not a log level here: audit records go to audit.record (ADR-0012).

CREATE SCHEMA logs;
GRANT USAGE ON SCHEMA logs TO mobsimlab_app, mobsimlab_worker;

CREATE TABLE logs.entry (
  id         bigint GENERATED ALWAYS AS IDENTITY,
  at         timestamptz NOT NULL DEFAULT now(),
  level      text NOT NULL CHECK (level IN ('WARN', 'ERROR', 'CRITICAL')),
  -- Where the entry was written: the API, a browser (sent to POST /api/logs), or the simulation worker.
  origin     text NOT NULL CHECK (origin IN ('backend', 'frontend', 'worker')),
  module     text CHECK (length(module) <= 100),
  message    text NOT NULL CHECK (length(message) <= 4000),
  request_id text CHECK (length(request_id) <= 100),
  -- The user's internal ID (pseudonymous: no name or e-mail). No foreign key, so deleting a user keeps logs.
  user_id    uuid,
  project_id uuid,
  run_id     uuid,
  -- Other fields of the entry, already redacted by the writer.
  context    jsonb CHECK (pg_column_size(context) < 16384),
  PRIMARY KEY (at, id)
) PARTITION BY RANGE (at);
CREATE INDEX entry_level_at ON logs.entry (level, at DESC);
CREATE INDEX entry_request ON logs.entry (request_id) WHERE request_id IS NOT NULL;

-- Purpose: make sure the partitions for today and the next `days_ahead` days (UTC) exist, and drop partitions
-- whose whole day is older than `keep_days`. Output: the number of partitions dropped.
-- Runs as the owner, so the app role can call it without owning the table. The API calls it at start-up and
-- every hour (apps/api/src/logging/maintenance.service.ts).
CREATE FUNCTION logs.maintain(days_ahead integer DEFAULT 7, keep_days integer DEFAULT 30) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, logs AS $$
DECLARE
  today   date := (now() AT TIME ZONE 'UTC')::date;
  d       date;
  part    record;
  dropped integer := 0;
BEGIN
  IF days_ahead NOT BETWEEN 0 AND 60 OR keep_days NOT BETWEEN 1 AND 3650 THEN
    RAISE EXCEPTION 'logs.maintain: days_ahead must be 0..60 and keep_days 1..3650';
  END IF;
  FOR i IN 0..days_ahead LOOP
    d := today + i;
    IF to_regclass(format('logs.entry_%s', to_char(d, 'YYYYMMDD'))) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE logs.%I PARTITION OF logs.entry FOR VALUES FROM (%L) TO (%L)',
        'entry_' || to_char(d, 'YYYYMMDD'),
        (d::timestamp AT TIME ZONE 'UTC'),
        ((d + 1)::timestamp AT TIME ZONE 'UTC')
      );
    END IF;
  END LOOP;
  FOR part IN
    SELECT c.relname FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE i.inhparent = 'logs.entry'::regclass AND n.nspname = 'logs' AND c.relname ~ '^entry_\d{8}$'
  LOOP
    IF to_date(substr(part.relname, 7), 'YYYYMMDD') < today - keep_days THEN
      EXECUTE format('DROP TABLE logs.%I', part.relname);
      dropped := dropped + 1;
    END IF;
  END LOOP;
  RETURN dropped;
END;
$$;
REVOKE ALL ON FUNCTION logs.maintain(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION logs.maintain(integer, integer) TO mobsimlab_app;

-- Purpose: let the simulation worker store its WARN+ entries. Origin is always 'worker' and the request and user
-- fields stay empty, so the worker cannot pass its entries off as the API's. Output: nothing.
CREATE FUNCTION logs.append_worker(
  p_level text, p_module text, p_message text, p_run_id uuid, p_context jsonb
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, logs AS $$
  INSERT INTO logs.entry (level, origin, module, message, run_id, context)
  VALUES (p_level, 'worker', p_module, left(p_message, 4000), p_run_id, p_context);
$$;
REVOKE ALL ON FUNCTION logs.append_worker(text, text, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION logs.append_worker(text, text, text, uuid, jsonb) TO mobsimlab_worker;

GRANT INSERT ON logs.entry TO mobsimlab_app;

SELECT logs.maintain();
