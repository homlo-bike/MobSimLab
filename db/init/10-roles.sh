#!/bin/sh
# Runs once, as the PostgreSQL superuser, when the data directory is first created.
# Creates the database and the three MobSimLab roles from Docker secrets.
# Each role takes its own secret file (db_<role>_password) if there is one, otherwise the shared db_password.
# Passwords are passed as psql variables and quoted with format(%L): never interpolated into SQL text.
set -eu

read_secret() {
  f="/run/secrets/$1"
  [ -s "$f" ] || f=/run/secrets/db_password
  [ -s "$f" ] || { echo "missing secret db_password (run deploy/scripts/init-secrets)" >&2; exit 1; }
  tr -d '\n' < "$f"
}

# Plain assignments, so that `set -e` stops the script when a secret is missing
# (an exit inside "$(...)" in a command's arguments would not).
migrator_pw=$(read_secret db_migrator_password)
app_pw=$(read_secret db_app_password)
worker_pw=$(read_secret db_worker_password)

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v migrator_pw="$migrator_pw" \
  -v app_pw="$app_pw" \
  -v worker_pw="$worker_pw" <<'SQL'
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

# The superuser got db_password only so that the database could be created. Remove its password, so that
# db_password, which the mobsimlab container also holds, can never sign in as superuser over the network.
# Maintenance still works inside the postgres container: docker compose exec postgres psql -U postgres
if [ -s /run/secrets/db_password ]; then
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
    -c "ALTER ROLE \"$POSTGRES_USER\" PASSWORD NULL"
fi
