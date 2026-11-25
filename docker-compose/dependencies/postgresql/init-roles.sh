#!/usr/bin/env bash
# One non-superuser login role per database. Each app gets only its own role:
#
#   role       databases                       used by
#   middleman  middleman                       middleman-web/-workflows/-migration
#   provider   provider                        provider-web/-workflows/-migration
#   temporal   temporal, temporal_visibility   the Temporal server
#
# Each role OWNS its databases and every object in them, and PUBLIC loses
# CONNECT, so a role cannot open another stack's database.
#
# Idempotent, and used two ways:
# - Fresh volume: the postgres image runs it once from /docker-entrypoint-initdb.d.
# - Existing install (the volume already holds data, owned by the bootstrap
#   superuser): run it by hand, once, from the dependencies folder:
#     docker compose exec postgresql /docker-entrypoint-initdb.d/init-roles.sh
#   It creates the missing roles and databases, then hands every existing table,
#   sequence, view, type, function and schema over to the right role.
#
# Passwords come from the container environment (dependencies/.env); none is
# written here. Re-running it resets the three passwords to the env values.
set -euo pipefail

: "${POSTGRES_USER:?}"
: "${MIDDLEMAN_DB_PASSWORD:?MIDDLEMAN_DB_PASSWORD is empty}"
: "${PROVIDER_DB_PASSWORD:?PROVIDER_DB_PASSWORD is empty}"
: "${TEMPORAL_DB_PASSWORD:?TEMPORAL_DB_PASSWORD is empty}"

psql_su() {
  psql -v ON_ERROR_STOP=1 --no-psqlrc --username "$POSTGRES_USER" "$@"
}

ensure_role() { # role password
  psql_su --dbname postgres -v role="$1" -v pw="$2" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN', :'role')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role') \gexec
-- NOSUPERUSER etc. are the CREATE ROLE defaults; stated again in case the
-- role already existed with more.
ALTER ROLE :"role" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'pw';
SQL
}

ensure_db() { # db owner
  psql_su --dbname postgres -v db="$1" -v owner="$2" <<'SQL'
SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'owner')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db') \gexec
ALTER DATABASE :"db" OWNER TO :"owner";
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"db" TO :"owner";
SQL

  # Hand over objects created before this script existed (all owned by the
  # bootstrap superuser). REASSIGN OWNED BY cannot be used: the bootstrap
  # superuser also owns system objects. Objects that belong to an extension, and
  # sequences owned by a table column (they follow ALTER TABLE), are skipped.
  psql_su --dbname "$1" -v owner="$2" <<'SQL'
SET igniter.new_owner = :'owner';
DO $$
DECLARE
  new_owner text := current_setting('igniter.new_owner');
  r record;
BEGIN
  -- Schemas (drizzle keeps its migrations journal in schema "drizzle").
  FOR r IN
    SELECT n.oid, n.nspname FROM pg_namespace n
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND n.nspname NOT LIKE 'pg_temp_%' AND n.nspname NOT LIKE 'pg_toast_temp_%'
      AND n.nspname <> 'public'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_namespace'::regclass AND d.objid = n.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER SCHEMA %I OWNER TO %I', r.nspname, new_owner);
  END LOOP;

  -- Tables, views, materialized views, foreign tables, sequences.
  FOR r IN
    SELECT c.oid, n.nspname, c.relname, c.relkind FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
      AND NOT (c.relkind = 'S' AND EXISTS (
        SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
          AND d.refclassid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')))
  LOOP
    EXECUTE format('ALTER %s %I.%I OWNER TO %I',
      CASE r.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW'
                     WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'f' THEN 'FOREIGN TABLE'
                     ELSE 'TABLE' END,
      r.nspname, r.relname, new_owner);
  END LOOP;

  -- Enums, domains, standalone composite types.
  FOR r IN
    SELECT t.oid, n.nspname, t.typname, t.typtype FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typtype IN ('e', 'd', 'c', 'r', 'm')
      AND (t.typtype <> 'c' OR (SELECT c.relkind FROM pg_class c WHERE c.oid = t.typrelid) = 'c')
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER %s %I.%I OWNER TO %I',
      CASE r.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END,
      r.nspname, r.typname, new_owner);
  END LOOP;

  -- Functions and procedures.
  FOR r IN
    SELECT p.oid FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER ROUTINE %s OWNER TO %I', r.oid::regprocedure, new_owner);
  END LOOP;
END
$$;
SQL
}

ensure_role middleman "$MIDDLEMAN_DB_PASSWORD"
ensure_role provider "$PROVIDER_DB_PASSWORD"
ensure_role temporal "$TEMPORAL_DB_PASSWORD"

ensure_db middleman middleman
ensure_db provider provider
ensure_db temporal temporal
ensure_db temporal_visibility temporal

echo "init-roles: roles middleman, provider, temporal ensured; databases owned and PUBLIC CONNECT revoked."
