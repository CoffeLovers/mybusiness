# Runbook Operativo — Despliegue en Producción y Rollback (ADR-009)

> **Destino**: AWS ECS Fargate / Docker Compose de Producción  
> **Alcance**: `apps/web`, `apps/api-gateway`, `apps/auth-service`, `apps/finance-service`, `apps/agent-service`, `apps/audit-service`  
> **Referencia**: `docs/adr/009-production-deployment-target.md`

---

## 1. Arquitectura de Despliegue

El despliegue de producción se organiza en dos redes aisladas con segregación perimetral estricta:

```
[ Internet ]
      │
      ▼
[ AWS ALB / Ingress ]
      │
 ┌────┴──────────────────────────┐
 │ edge_network                  │
 │  ├── apps/web (port 3000)     │
 │  └── api-gateway (port 3000)  │
 └────┬──────────────────────────┘
      │
 ┌────┴───────────────────────────────────────────────────────┐
 │ internal_network                                           │
 │  ├── auth-service    (Redis + aux health 3001)             │
 │  ├── finance-service (Redis + aux health 3002)             │
 │  ├── agent-service   (Redis + aux health 3003)             │
 │  ├── audit-service   (Redis + aux health 3004)             │
 │  ├── PostgreSQL 16   (Port 5432 - RDS / Aurora multi-AZ)   │
 │  └── Redis 7         (Port 6379 - ElastiCache cluster)     │
 └────────────────────────────────────────────────────────────┘
```

Todos los contenedores backend se ejecutan con usuario no privilegiado `node` (UID 1000) y el frontend con `nextjs` (UID 1001).

---

## 2. Prerrequisitos y Gestión de Secretos

1. **Gestor de Secretos**: Los secretos residen en **AWS Secrets Manager** bajo la ruta `production/mybusiness/*`.
2. **Políticas IAM**: Las tareas de ECS asumen el rol `ecsTaskExecutionRole` con permisos de solo lectura `secretsmanager:GetSecretValue` sobre el prefijo autorizado.
3. **Rotación**: No se almacenan credenciales en variables de entorno fijas en repositorios Git ni en imágenes de contenedor.

Variables críticas inyectadas en runtime:

- `DATABASE_URL`: Conexión segura a PostgreSQL con SSL obligatorio (`sslmode=require`).
- `REDIS_URL`: Conexión a Redis con autenticación TLS activada.
- `JWT_SECRET`: Clave HMAC-SHA256 mínima de 256 bits para firma de tokens.
- `AUDIT_HMAC_SECRET`: Semilla criptográfica para encadenamiento del log de auditoría.

---

## 3. Procedimiento de Despliegue (Zero-Downtime)

### Paso 1: Ejecución del Pre-Deploy Job (Migraciones de BD)

Antes de desplegar cualquier nueva versión de los contenedores de aplicación, debe ejecutarse la migración de base de datos bajo el principio _Expand and Contract_:

```bash
# Ejecutar tarea efímera de migración en ECS
aws ecs run-task \
  --cluster mybusiness-prod \
  --task-definition mybusiness-db-migration:<nueva-version> \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-priv-a,subnet-priv-b],securityGroups=[sg-db-migration]}"
```

> **Regla de oro**: Si el job de migración falla, **el despliegue se detiene automáticamente**. Ningún contenedor en producción se reinicia ni actualiza.

### Paso 2: Despliegue Progresivo (Rolling Update)

1. Se actualizan primero los microservicios del núcleo (`audit-service`, `auth-service`, `finance-service`, `agent-service`).
2. Se actualiza el `api-gateway`.
3. Se actualiza el portal `apps/web`.

Para entornos basados en Compose o Docker Swarm:

```bash
# 1. Pull de las nuevas imágenes verificadas por CI
docker compose -f docker/docker-compose.prod.yml pull

# 2. Despliegue en caliente de los servicios internos
docker compose -f docker/docker-compose.prod.yml up -d --no-deps audit-service auth-service finance-service agent-service

# 3. Despliegue del gateway y frontend
docker compose -f docker/docker-compose.prod.yml up -d --no-deps api-gateway web
```

### Paso 3: Verificación de Sondas de Salud (Healthchecks)

Cada nuevo contenedor debe responder afirmativamente antes de recibir tráfico del balanceador:

```bash
# Validar liveness (proceso respondiendo)
curl -fsS http://127.0.0.1:3000/healthz/liveness
curl -fsS http://127.0.0.1:3001/healthz/liveness
curl -fsS http://127.0.0.1:3002/healthz/liveness
curl -fsS http://127.0.0.1:3003/healthz/liveness
curl -fsS http://127.0.0.1:3004/healthz/liveness

# Validar readiness (Postgres y Redis en verde)
curl -fsS http://127.0.0.1:3000/healthz/readiness
curl -fsS http://127.0.0.1:3001/healthz/readiness
curl -fsS http://127.0.0.1:3002/healthz/readiness
curl -fsS http://127.0.0.1:3003/healthz/readiness
curl -fsS http://127.0.0.1:3004/healthz/readiness
```

Respuesta esperada en readiness (HTTP 200):

```json
{
  "status": "ok",
  "services": {
    "postgres": "up",
    "redis": "up"
  }
}
```

---

## 4. Procedimiento de Rollback de Emergencia

Si tras el despliegue se detectan errores 5xx sostenidos, incremento en latencia P99 > 500ms o fallas de readiness (`status: error` / HTTP 503):

### Rollback Automático (CodeDeploy / ECS)

En ECS Fargate con CodeDeploy, si la alarma de CloudWatch `Target5xxRateHigh` o el probe de salud del ALB detecta fallas durante el _traffic shifting_, el despliegue se cancela y el 100% del tráfico se redirige inmediatamente a la versión anterior sin intervención manual.

### Rollback Manual Inmediato

Si se requiere forzar el regreso a la versión estable previa (`<sha-anterior>`):

```bash
# 1. Actualizar servicio ECS a la Task Definition anterior
aws ecs update-service \
  --cluster mybusiness-prod \
  --service api-gateway \
  --task-definition mybusiness-api-gateway:<version-anterior> \
  --force-new-deployment

# 2. En caso de docker-compose.prod.yml:
export IMAGE_TAG=<sha-anterior>
docker compose -f docker/docker-compose.prod.yml up -d --no-deps api-gateway auth-service finance-service agent-service audit-service web

# 3. Verificar recuperación de sondas
pnpm run check:health-endpoints
```

> **Aviso sobre Base de Datos**: Debido al patrón _Expand and Contract_, no es necesario revertir el esquema de base de datos inmediatamente, ya que los cambios introducidos en la fase _Expand_ son totalmente retrocompatibles con la versión anterior del código.

---

## 5. Rotación de Credenciales

En caso de rotación periódica (cada 90 días) o incidente de seguridad:

1. Crear un usuario alternativo en PostgreSQL (`app_user_v2`) con los mismos privilegios.
2. Actualizar el secreto en AWS Secrets Manager: `production/mybusiness/database_url`.
3. Disparar un despliegue rodante (_rolling restart_) para que los contenedores refresquen la conexión:
   ```bash
   aws ecs update-service --cluster mybusiness-prod --service api-gateway --force-new-deployment
   ```
4. Confirmar que todas las sondas `/healthz/readiness` responden `200 OK`.
5. Revocar el usuario anterior (`app_user_v1`) en la base de datos.

---

## 6. Diagnóstico y Troubleshooting

| Síntoma                                           | Causa Probable                                                  | Comando de Diagnóstico                                    | Acción Correctiva                                                                     |
| :------------------------------------------------ | :-------------------------------------------------------------- | :-------------------------------------------------------- | :------------------------------------------------------------------------------------ |
| `503 Service Unavailable` en `/healthz/readiness` | PostgreSQL o Redis no alcanzable o saturación de pool           | `curl -s http://localhost:3002/healthz/readiness \| jq .` | Verificar estado de RDS/Redis, conectividad de Security Groups y conexiones activas.  |
| Contenedor reinicia continuamente (_CrashLoop_)   | Fallo en probe `/healthz/liveness` por OOM o error no capturado | `docker logs --tail 100 <container_id>`                   | Revisar asignación de memoria en límites o errores fatales al arrancar.               |
| Permiso denegado al arrancar contenedor           | Proceso intentó escribir en raíz con `USER node` no root        | `docker inspect <container_id> \| grep User`              | Asegurar que solo se escriba en `/tmp` o en volúmenes montados con permisos UID 1000. |
