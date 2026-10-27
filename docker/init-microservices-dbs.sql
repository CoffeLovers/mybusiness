-- ==============================================================================
-- MyBusiness — Inicialización de Bases de Datos y Roles con Privilegio Mínimo
-- Stack: PostgreSQL 16 con extensión pgvector
-- Principio: Database-per-Service
-- ==============================================================================

-- 1. Crear roles y usuarios dedicados por microservicio (idempotente)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'auth_user') THEN
    CREATE ROLE auth_user LOGIN PASSWORD 'change_in_production_auth_pass';
  END IF;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'finance_user') THEN
    CREATE ROLE finance_user LOGIN PASSWORD 'change_in_production_finance_pass';
  END IF;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'agent_user') THEN
    CREATE ROLE agent_user LOGIN PASSWORD 'change_in_production_agent_pass';
  END IF;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'audit_user') THEN
    CREATE ROLE audit_user LOGIN PASSWORD 'change_in_production_audit_pass';
  END IF;

  -- Usuario de compatibilidad / administración de desarrollo
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mybusiness_user') THEN
    CREATE ROLE mybusiness_user LOGIN PASSWORD 'change_in_production_dev_pass';
  END IF;
END $$;

-- 2. Crear bases de datos aisladas por servicio si aún no existen
SELECT 'CREATE DATABASE auth_db OWNER auth_user'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'auth_db')\gexec

SELECT 'CREATE DATABASE finance_db OWNER finance_user'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'finance_db')\gexec

SELECT 'CREATE DATABASE agent_db OWNER agent_user'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'agent_db')\gexec

SELECT 'CREATE DATABASE audit_db OWNER audit_user'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'audit_db')\gexec

-- 3. Asignar ownership y revocar conexión pública por defecto
ALTER DATABASE auth_db OWNER TO auth_user;
ALTER DATABASE finance_db OWNER TO finance_user;
ALTER DATABASE agent_db OWNER TO agent_user;
ALTER DATABASE audit_db OWNER TO audit_user;

REVOKE CONNECT ON DATABASE auth_db FROM PUBLIC;
REVOKE CONNECT ON DATABASE finance_db FROM PUBLIC;
REVOKE CONNECT ON DATABASE agent_db FROM PUBLIC;
REVOKE CONNECT ON DATABASE audit_db FROM PUBLIC;

-- ==============================================================================
-- Configuración de auth_db
-- ==============================================================================
\c auth_db
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

GRANT CONNECT ON DATABASE auth_db TO auth_user;
GRANT ALL ON SCHEMA public TO auth_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO auth_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO auth_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO auth_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO auth_user;

GRANT CONNECT ON DATABASE auth_db TO mybusiness_user;
GRANT ALL ON SCHEMA public TO mybusiness_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO mybusiness_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO mybusiness_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO mybusiness_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO mybusiness_user;

REVOKE CONNECT ON DATABASE auth_db FROM finance_user, agent_user, audit_user;

-- ==============================================================================
-- Configuración de finance_db
-- ==============================================================================
\c finance_db
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

GRANT CONNECT ON DATABASE finance_db TO finance_user;
GRANT ALL ON SCHEMA public TO finance_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO finance_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO finance_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO finance_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO finance_user;

GRANT CONNECT ON DATABASE finance_db TO mybusiness_user;
GRANT ALL ON SCHEMA public TO mybusiness_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO mybusiness_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO mybusiness_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO mybusiness_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO mybusiness_user;

REVOKE CONNECT ON DATABASE finance_db FROM auth_user, agent_user, audit_user;

-- ==============================================================================
-- Configuración de agent_db
-- ==============================================================================
\c agent_db
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

GRANT CONNECT ON DATABASE agent_db TO agent_user;
GRANT ALL ON SCHEMA public TO agent_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO agent_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO agent_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO agent_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO agent_user;

GRANT CONNECT ON DATABASE agent_db TO mybusiness_user;
GRANT ALL ON SCHEMA public TO mybusiness_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO mybusiness_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO mybusiness_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO mybusiness_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO mybusiness_user;

REVOKE CONNECT ON DATABASE agent_db FROM auth_user, finance_user, audit_user;

-- ==============================================================================
-- Configuración de audit_db
-- ==============================================================================
\c audit_db
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

GRANT CONNECT ON DATABASE audit_db TO audit_user;
GRANT ALL ON SCHEMA public TO audit_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO audit_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO audit_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO audit_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO audit_user;

GRANT CONNECT ON DATABASE audit_db TO mybusiness_user;
GRANT ALL ON SCHEMA public TO mybusiness_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO mybusiness_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO mybusiness_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO mybusiness_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO mybusiness_user;

REVOKE CONNECT ON DATABASE audit_db FROM auth_user, finance_user, agent_user;
