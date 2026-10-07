-- F-14: cluster bootstrap as a psql script, for the Postgres image's first-setup script (F-170).
-- Run as a superuser, connected to the `postgres` database, with:
--   psql -v ON_ERROR_STOP=1 -v dbname=budmon -v migrator_password_sql="'<quoted literal>'" -f cluster-bootstrap.sql
-- `migrator_password_sql` must already be a quoted SQL literal (a password or a SCRAM verifier).
-- Every statement is idempotent. apps/server's TypeScript bootstrapCluster runs the same ones.

SELECT 'CREATE ROLE budmon_migrator LOGIN CREATEROLE NOINHERIT'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'budmon_migrator') \gexec

ALTER ROLE budmon_migrator PASSWORD :migrator_password_sql;

SELECT format('CREATE DATABASE %I OWNER budmon_migrator', :'dbname')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'dbname') \gexec

SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'dbname') \gexec

\connect :dbname

ALTER SCHEMA public OWNER TO budmon_migrator;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE EXTENSION IF NOT EXISTS amcheck;
GRANT EXECUTE ON FUNCTION bt_index_check(regclass, boolean) TO budmon_migrator;
GRANT pg_read_all_data TO budmon_migrator WITH INHERIT TRUE;
GRANT pg_monitor TO budmon_migrator WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;
