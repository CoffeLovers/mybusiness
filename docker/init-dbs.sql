-- Habilitar extensiones en la base de datos principal
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Crear bases de datos aisladas para los microservicios
CREATE DATABASE finance_db;
CREATE DATABASE agent_db;
CREATE DATABASE audit_db;

-- Conceder privilegios
GRANT ALL PRIVILEGES ON DATABASE auth_db TO mybusiness_user;
GRANT ALL PRIVILEGES ON DATABASE finance_db TO mybusiness_user;
GRANT ALL PRIVILEGES ON DATABASE agent_db TO mybusiness_user;
GRANT ALL PRIVILEGES ON DATABASE audit_db TO mybusiness_user;

-- Habilitar extensión vector en agent_db
\c agent_db
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
