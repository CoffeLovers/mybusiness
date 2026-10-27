#!/bin/bash
set -euo pipefail

# ==============================================================================
# MyBusiness — Inicialización Idempotente de Bases de Datos y Roles
# Stack: PostgreSQL 16 con extensión pgvector
# Principio: Database-per-Service con Mínimos Privilegios
#
# Las credenciales se leen de variables de entorno y se pasan a psql mediante
# \getenv. De este modo no se interpolan en SQL ni se exponen en la línea de
# comandos. Los identificadores se citan con %I / :"var" y los valores con %L /
# :'var'.
# ==============================================================================

AUTH_USER="${AUTH_DB_USER:?AUTH_DB_USER is required}"
AUTH_PASS="${AUTH_DB_PASSWORD:?AUTH_DB_PASSWORD is required}"

FINANCE_USER="${FINANCE_DB_USER:?FINANCE_DB_USER is required}"
FINANCE_PASS="${FINANCE_DB_PASSWORD:?FINANCE_DB_PASSWORD is required}"

AGENT_USER="${AGENT_DB_USER:?AGENT_DB_USER is required}"
AGENT_PASS="${AGENT_DB_PASSWORD:?AGENT_DB_PASSWORD is required}"

AUDIT_USER="${AUDIT_DB_USER:?AUDIT_DB_USER is required}"
AUDIT_PASS="${AUDIT_DB_PASSWORD:?AUDIT_DB_PASSWORD is required}"

ADMIN_USER="${POSTGRES_USER:?POSTGRES_USER is required}"

export AUTH_USER AUTH_PASS FINANCE_USER FINANCE_PASS AGENT_USER AGENT_PASS AUDIT_USER AUDIT_PASS

echo "🔧 Iniciando configuración de roles y bases de datos en PostgreSQL..."

# ------------------------------------------------------------------------------
# 1. Crear o actualizar roles dedicados por microservicio
# ------------------------------------------------------------------------------
psql -v ON_ERROR_STOP=1 --username "$ADMIN_USER" --dbname "postgres" <<'EOSQL'
\getenv auth_user AUTH_USER
\getenv auth_pass AUTH_PASS
\getenv finance_user FINANCE_USER
\getenv finance_pass FINANCE_PASS
\getenv agent_user AGENT_USER
\getenv agent_pass AGENT_PASS
\getenv audit_user AUDIT_USER
\getenv audit_pass AUDIT_PASS

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'auth_user', :'auth_pass')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'auth_user')\gexec
SELECT format('ALTER ROLE %I WITH PASSWORD %L', :'auth_user', :'auth_pass')
WHERE EXISTS (SELECT FROM pg_roles WHERE rolname = :'auth_user')\gexec

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'finance_user', :'finance_pass')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'finance_user')\gexec
SELECT format('ALTER ROLE %I WITH PASSWORD %L', :'finance_user', :'finance_pass')
WHERE EXISTS (SELECT FROM pg_roles WHERE rolname = :'finance_user')\gexec

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'agent_user', :'agent_pass')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'agent_user')\gexec
SELECT format('ALTER ROLE %I WITH PASSWORD %L', :'agent_user', :'agent_pass')
WHERE EXISTS (SELECT FROM pg_roles WHERE rolname = :'agent_user')\gexec

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'audit_user', :'audit_pass')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'audit_user')\gexec
SELECT format('ALTER ROLE %I WITH PASSWORD %L', :'audit_user', :'audit_pass')
WHERE EXISTS (SELECT FROM pg_roles WHERE rolname = :'audit_user')\gexec
EOSQL

# ------------------------------------------------------------------------------
# 2. Crear bases de datos independientes por servicio si no existen
# ------------------------------------------------------------------------------
psql -v ON_ERROR_STOP=1 --username "$ADMIN_USER" --dbname "postgres" <<'EOSQL'
\getenv auth_user AUTH_USER
\getenv finance_user FINANCE_USER
\getenv agent_user AGENT_USER
\getenv audit_user AUDIT_USER

SELECT format('CREATE DATABASE %I OWNER %I', 'auth_db', :'auth_user')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'auth_db')\gexec
SELECT format('CREATE DATABASE %I OWNER %I', 'finance_db', :'finance_user')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'finance_db')\gexec
SELECT format('CREATE DATABASE %I OWNER %I', 'agent_db', :'agent_user')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'agent_db')\gexec
SELECT format('CREATE DATABASE %I OWNER %I', 'audit_db', :'audit_user')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'audit_db')\gexec

SELECT format('ALTER DATABASE %I OWNER TO %I', 'auth_db', :'auth_user')\gexec
SELECT format('ALTER DATABASE %I OWNER TO %I', 'finance_db', :'finance_user')\gexec
SELECT format('ALTER DATABASE %I OWNER TO %I', 'agent_db', :'agent_user')\gexec
SELECT format('ALTER DATABASE %I OWNER TO %I', 'audit_db', :'audit_user')\gexec

REVOKE CONNECT ON DATABASE auth_db FROM PUBLIC;
REVOKE CONNECT ON DATABASE finance_db FROM PUBLIC;
REVOKE CONNECT ON DATABASE agent_db FROM PUBLIC;
REVOKE CONNECT ON DATABASE audit_db FROM PUBLIC;
EOSQL

# ------------------------------------------------------------------------------
# 3. Limpiar el rol legacy mybusiness_user de volúmenes anteriores
#    (PR #19). Se reasignan sus objetos al dueño de cada base y luego se
#    eliminan sus privilegios restantes.
# ------------------------------------------------------------------------------
cleanup_legacy_role() {
  local db="$1"
  local target="$2"

  psql -v ON_ERROR_STOP=1 --username "$ADMIN_USER" --dbname "$db" -v target="$target" <<'EOSQL'
SELECT format('REASSIGN OWNED BY %I TO %I', 'mybusiness_user', :'target')
WHERE EXISTS (SELECT FROM pg_roles WHERE rolname = 'mybusiness_user')\gexec
SELECT 'DROP OWNED BY mybusiness_user'
WHERE EXISTS (SELECT FROM pg_roles WHERE rolname = 'mybusiness_user')\gexec
EOSQL
}

cleanup_legacy_role "auth_db" "$AUTH_USER"
cleanup_legacy_role "finance_db" "$FINANCE_USER"
cleanup_legacy_role "agent_db" "$AGENT_USER"
cleanup_legacy_role "audit_db" "$AUDIT_USER"

psql -v ON_ERROR_STOP=1 --username "$ADMIN_USER" --dbname "postgres" <<'EOSQL'
SELECT 'DROP OWNED BY mybusiness_user'
WHERE EXISTS (SELECT FROM pg_roles WHERE rolname = 'mybusiness_user')\gexec
DROP ROLE IF EXISTS mybusiness_user;
EOSQL

# ------------------------------------------------------------------------------
# 4. Configurar esquemas, extensiones y permisos mínimos en cada base de datos
# ------------------------------------------------------------------------------
configure_db() {
  local db="$1"
  local owner="$2"
  local other1="$3"
  local other2="$4"
  local other3="$5"

  psql -v ON_ERROR_STOP=1 --username "$ADMIN_USER" --dbname "$db" \
    -v db="$db" -v owner="$owner" -v other1="$other1" -v other2="$other2" -v other3="$other3" <<'EOSQL'
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

GRANT CONNECT ON DATABASE :"db" TO :"owner";
GRANT ALL ON SCHEMA public TO :"owner";
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO :"owner";
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO :"owner";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO :"owner";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO :"owner";

REVOKE CONNECT ON DATABASE :"db" FROM :"other1", :"other2", :"other3";
EOSQL
}

configure_db "auth_db" "$AUTH_USER" "$FINANCE_USER" "$AGENT_USER" "$AUDIT_USER"
configure_db "finance_db" "$FINANCE_USER" "$AUTH_USER" "$AGENT_USER" "$AUDIT_USER"
configure_db "agent_db" "$AGENT_USER" "$AUTH_USER" "$FINANCE_USER" "$AUDIT_USER"
configure_db "audit_db" "$AUDIT_USER" "$AUTH_USER" "$FINANCE_USER" "$AGENT_USER"

echo "✅ Inicialización de bases de datos, extensiones y roles completada exitosamente."
