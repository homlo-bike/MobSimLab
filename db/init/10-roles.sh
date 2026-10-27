#!/bin/sh
# Runs once, as the PostgreSQL superuser, when the data directory is first created.
# Creates the database and the three MobSimLab roles from Docker secrets.
# Passwords are passed as psql variables and quoted with format(%L): never interpolated into SQL text.
set -eu

read_secret() {
  f="/run/secrets/$1"
  [ -s "$f" ] || { echo "missing secret $1 (run deploy/scripts/init-secrets)" >&2; exit 1; }
  tr -d '\n' < "$f"
}

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v migrator_pw="$(read_secret db_migrator_password)" \
  -v app_pw="$(read_secret db_app_password)" \
  -v worker_pw="$(read_secret db_worker_password)" <<'SQL'
SELECT format('CREATE ROLE mobsimlab_migrator LOGIN PASSWORD %L', :'migrator_pw') \gexec
SELECT format('CREATE ROLE mobsimlab_app LOGIN PASSWORD %L', :'app_pw') \gexec
SELECT format('CREATE ROLE mobsimlab_worker LOGIN PASSWORD %L', :'worker_pw') \gexec
CREATE DATABASE mobsimlab OWNER mobsimlab_migrator;
REVOKE ALL ON DATABASE mobsimlab FROM PUBLIC;
GRANT CONNECT ON DATABASE mobsimlab TO mobsimlab_app, mobsimlab_worker;
SQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname mobsimlab <<'SQL'
CREATE EXTENSION IF NOT EXISTS postgis;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO mobsimlab_migrator;
GRANT USAGE ON SCHEMA public TO mobsimlab_app, mobsimlab_worker;
SQL
