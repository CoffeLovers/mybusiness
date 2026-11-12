# ADR 009: Decisión y Arquitectura de Despliegue en Producción

## Estado

Aceptado

## Fecha

2026-11-08

## Contexto

Conforme a la sección §8.3 de `docs/PLAN-INTEGRAL-DESARROLLO.md`, la decisión sobre la plataforma y destino definitivo de despliegue en producción de la plataforma multi-tenant **MyBusiness** debe formalizarse al inicio de la Fase 5.

El sistema se compone actualmente de:

- **6 servicios de aplicación**:
  - `apps/web`: Portal web en Next.js (App Router, Node.js runtime).
  - `apps/api-gateway`: Puerta de entrada HTTP/REST pública en NestJS con autenticación JWT, rate-limiting distribuido y proxy hacia servicios internos.
  - `apps/auth-service`: Microservicio NestJS para gestión de identidad, tenants, RBAC y auditoría de accesos.
  - `apps/finance-service`: Microservicio NestJS para conciliación bancaria, libro mayor contable y resúmenes de flujo de caja.
  - `apps/agent-service`: Microservicio NestJS de orquestación de agentes IA y servidor interno MCP (Model Context Protocol).
  - `apps/audit-service`: Microservicio NestJS de auditoría append-only con encadenamiento criptográfico HMAC-SHA256.
- **2 componentes de infraestructura de datos**:
  - PostgreSQL 16 con Drizzle ORM (aislamiento multi-tenant estricto vía `tenant_id`).
  - Redis 7 (broker de mensajería para microservicios `@nestjs/microservices`, rate limiting de tokens y cache).

### Restricciones y objetivos clave

1. **Eficiencia de costes**: Evitar sobrecostes fijos de clúster inactivo durante la etapa inicial de lanzamiento (Fase 5), manteniendo una curva de coste proporcional al tráfico real.
2. **Complejidad operativa mínima**: El equipo de ingeniería debe enfocar sus esfuerzos en valor de negocio y fiabilidad de software, minimizando la sobrecarga de mantenimiento de planos de control o parches de infraestructura.
3. **Soberanía y aislamiento de datos**: Garantizar estricto cumplimiento normativo (protección de datos financieros en LATAM/Colombia), con cifrado en reposo (KMS), tránsito (TLS 1.3/mTLS) y aislamiento de red.
4. **Reversibilidad y neutralidad OCI**: Cero acoplamiento a APIs propietarias en las aplicaciones. Las imágenes se empaquetan siguiendo el estándar Open Container Initiative (OCI) y los 12 Factores.
5. **Zero-downtime deployments y observabilidad**: Migraciones de base de datos desacopladas mediante pre-deploy jobs compatibles con el patrón _Expand and Contract_, acompañadas de sondas estandarizadas de _liveness_ y _readiness_.

---

## Comparativa Técnica de Alternativas

| Dimensión                         | Opción 1: Kubernetes Gestionado (AWS EKS / GCP GKE)                                                     | Opción 2: Contenedores Serverless (AWS ECS Fargate / GCP Cloud Run)                                         | Opción 3: Clúster HashiCorp Nomad                                                 |
| :-------------------------------- | :------------------------------------------------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------- |
| **Costes Fijos Base**             | Alto (~$73 USD/mes por control plane EKS + nodos EC2 mínimos multi-AZ ~$150 USD/mes).                   | Prácticamente nulo ($0 USD de plano de control; facturación por vCPU/GB por segundo).                       | Moderado (requiere al menos 3 nodos de servidor Nomad/Consul dedicados).          |
| **Complejidad Día 1 / Día 2**     | Muy alta (gestión de Ingress Controllers, Cert-Manager, CNI, CSI, upgrades semestrales de versión k8s). | Baja (plano de control completamente administrado; sin gestión de nodos ni parches de SO).                  | Moderada (binario único pero requiere operar y respaldar clúster Consul y Nomad). |
| **Aislamiento Multi-Tenant**      | Lógico a nivel de Namespaces y NetworkPolicies sobre kernel compartido.                                 | Aislamiento a nivel de microVM/hipervisor por tarea (AWS Firecracker / Nitro).                              | Aislamiento por cgroups/namespaces estándar de Linux sobre nodos compartidos.     |
| **Gestión de Secretos**           | Requiere External Secrets Operator o integración de CSI Secrets Store driver.                           | Integración nativa sin agentes con AWS Secrets Manager / SSM Parameter Store vía Task Definition.           | Requiere integración profunda con HashiCorp Vault.                                |
| **Curva de Aprendizaje**          | Alta (YAML extensos, CRDs, políticas RBAC de Kubernetes).                                               | Baja/Media (Definiciones de tareas declarativas, CLI / Terraform directo).                                  | Media (lenguaje HCL y conceptos de scheduling Nomad).                             |
| **Portabilidad / Reversibilidad** | Estándar de facto en la industria; portabilidad directa entre nubes.                                    | Total a nivel de contenedor OCI; las definiciones de tarea se traducen a pods de K8s sin cambios de código. | Muy portable a nivel de contenedor OCI; configuración HCL propietaria.            |

---

## Decisión

Se adopta una **estrategia de despliegue bi-etápica (Two-Stage Deployment Strategy)**:

### 1. Fase 5 y Go-To-Market Inicial: AWS ECS sobre Fargate (Serverless Containers)

Para la Fase 5 y el lanzamiento inicial de MyBusiness (hasta 50.000 usuarios activos y ~100 RPS sostenidos), la infraestructura de producción se desplegará sobre **AWS ECS con AWS Fargate**.

**Justificación:**

- **Coste cero de control plane inactivo**: No se paga tarifa horaria de clúster, solo los recursos vCPU y memoria efectivamente reservados y consumidos por los contenedores.
- **Aislamiento de seguridad superior**: Cada tarea corre en una microVM dedicada con hardware Nitro/Firecracker, proporcionando un perímetro de seguridad estricto para datos financieros multi-tenant.
- **Reducción radical de carga cognitiva**: Cero mantenimiento de nodos, kernels, parches de sistema operativo o actualizaciones forzosas de versiones de Kubernetes.
- **Despliegues seguros**: Soporte nativo para despliegues _Rolling Update_ y _Blue/Green_ mediante AWS CodeDeploy con rollback automático ante fallo en sondas de salud.

### 2. Criterios de Transición hacia Kubernetes (Fase 6+)

La migración hacia un clúster gestionado de Kubernetes (AWS EKS o GCP GKE) se activará únicamente si se cumple al menos uno de los siguientes umbrales operativos:

1. **Volumen de servicios**: Superar los 25 microservicios o 60 réplicas activas simultáneas.
2. **Optimización de costes de cómputo**: Cuando el gasto mensual de cómputo en Fargate supere los **$3.000 USD/mes** y el uso de instancias EC2 reservadas o _Savings Plans_ con nodos gestionados k8s genere un ahorro superior al 40% después de considerar las horas de ingeniería requeridas para operar el clúster.
3. **Requerimientos avanzados de red**: Necesidad estricta de Service Mesh avanzado (ej. Istio o Linkerd) para mTLS granular a nivel de socket interno y enrutamiento L7 intra-malla complejo.

---

## Arquitectura de Producción

### 1. Gestión Segura de Secretos Desacoplada

- **Cero secretos en artefactos**: Queda terminantemente prohibido incorporar credenciales, tokens, certificados o cadenas de conexión en el repositorio Git o en las imágenes Docker (`Dockerfile.microservice` y `Dockerfile.web`).
- **Proveedor**: AWS Secrets Manager (con fallback para entornos híbridos/on-premise hacia HashiCorp Vault).
- **Inyección en Runtime**: Las credenciales se inyectan como variables de entorno al momento de instanciar las tareas utilizando la directiva `secrets` de la definición de tarea de ECS respaldada por IAM Roles for Tasks (IRSA), sin agentes en el contenedor ni volúmenes montados en texto plano.
- **Rotación**: Rotación automática cada 90 días para credenciales de PostgreSQL y Redis gestionada por AWS Secrets Manager Rotation Lambdas.

### 2. Estandarización de Sondas de Salud (Healthchecks)

Todos los servicios del monorepo exponen de forma obligatoria los siguientes dos endpoints HTTP sin autenticación de red perimetral:

1. **Liveness Probe (`GET /healthz/liveness`)**:
   - **Propósito**: Verificar que el proceso Node.js está vivo, respondiendo al bucle de eventos y sin bloqueos de memoria.
   - **Comportamiento**: Devuelve siempre código HTTP `200 OK` con carga JSON `{ "status": "ok", "uptime": <segundos>, "timestamp": "<ISO8601>" }`.
   - **Acción del orquestador ante fallo**: Reinicio inmediato del contenedor.

2. **Readiness Probe (`GET /healthz/readiness`)**:
   - **Propósito**: Verificar que el servicio está listo para aceptar tráfico y que sus dependencias operativas críticas están conectadas.
   - **Comportamiento**:
     - Retorna HTTP `200 OK` cuando las dependencias críticas (PostgreSQL y Redis según el rol del servicio) están operativas: `{ "status": "ok", "services": { "postgres": "up", "redis": "up" } }`.
     - Retorna HTTP `503 Service Unavailable` si alguna dependencia crítica no responde o está degradada: `{ "status": "error", "services": { "postgres": "down", "redis": "up" } }`.
   - **Acción del orquestador ante fallo**: Retiro inmediato del contenedor del balanceador de carga (ALB) o pausa en el consumo de eventos sin matar el proceso.

**Matriz de puertos y dependencias por servicio:**

| Servicio               | Tipo                       | Puerto HTTP Healthcheck | Dependencia Readiness                         |
| :--------------------- | :------------------------- | :---------------------- | :-------------------------------------------- |
| `apps/web`             | Frontend Web (Next.js)     | `3000`                  | Proceso web y conectividad downstream         |
| `apps/api-gateway`     | Edge Gateway (NestJS HTTP) | `3000`                  | Redis (bus/rate limit) y conectividad interna |
| `apps/auth-service`    | Microservicio Redis        | `3001` (auxiliar)       | PostgreSQL y Redis                            |
| `apps/finance-service` | Microservicio Redis        | `3002` (auxiliar)       | PostgreSQL y Redis                            |
| `apps/agent-service`   | Microservicio Redis        | `3003` (auxiliar)       | Redis                                         |
| `apps/audit-service`   | Microservicio Redis        | `3004` (auxiliar)       | PostgreSQL y Redis                            |

### 3. Seguridad de Contenedores y Privilegios Mínimos

- **Usuarios no privilegiados**:
  - En microservicios backend: ejecución obligatoria bajo usuario `node` (UID `1000`, GID `1000`).
  - En frontend Next.js: ejecución obligatoria bajo usuario `nextjs` (UID `1001`, GID `1001`).
  - Queda expresamente prohibida la ejecución de procesos como `root` (UID `0`).
- **Sistemas de archivos de solo lectura**: Contenedores arrancados con `read_only: true` excepto en directorios efímeros explícitos (`/tmp`).
- **Límites de recursos (Limits & Reservations)**:
  - Todo contenedor en producción cuenta con directivas de CPU y memoria estrictas definidas en `docker-compose.prod.yml` y manifiestos IaC, previniendo ataques de denegación de servicio por agotamiento de recursos o fallos de tipo OOM (_Out Of Memory_).
- **Segmentación de Red**:
  - `edge_network`: Red perimetral donde solo residen `apps/web` y `apps/api-gateway` expuestos tras el balanceador de carga.
  - `internal_network`: Red privada no expuesta al exterior donde residen los microservicios (`auth`, `finance`, `agent`, `audit`) y los almacenes de datos (`postgres`, `redis`).

### 4. Estrategia de Migraciones Zero-Downtime

Para evitar caídas de servicio o bloqueos de tablas durante los despliegues continuos, se implementa el patrón **Expand and Contract**:

1. **Compatibilidad Retroactiva en Base de Datos (Expand)**:
   - Toda modificación de esquema en Drizzle ORM debe ser retrocompatible con la versión de código actualmente en ejecución.
   - Las nuevas columnas deben ser opcionales (`NULL`) o poseer un valor por defecto.
   - Prohibido renombrar o eliminar columnas activas en un solo paso.
2. **Pre-Deploy Migration Job**:
   - En el pipeline de despliegue, antes de actualizar cualquier contenedor de aplicación, se ejecuta un contenedor efímero aislado (_ECS RunTask_ o _Pre-Deploy Hook_) que corre `pnpm db:migrate`.
   - Si la migración falla, el pipeline se aborta de inmediato con estado `failed`; los contenedores de la versión anterior continúan sirviendo tráfico sin impacto alguno.
3. **Contracción (Contract)**:
   - Una vez que la versión $N+1$ del software está desplegada y estabilizada en el 100% del tráfico, una migración posterior en un sprint siguiente elimina campos o tablas en desuso.

---

## Consecuencias

### Positivas

- **Reducción del TCO**: Coste de infraestructura mínimo durante los primeros meses sin incurrir en cuotas fijas de mantenimiento de clústeres Kubernetes vacíos.
- **Fiabilidad y Resiliencia**: Sondas de liveness y readiness desacopladas garantizan que ninguna petición de usuario llegue a una instancia no inicializada o desconectada de Postgres/Redis.
- **Seguridad Robusta**: Aislamiento a nivel de microVM, ejecución sin permisos de superusuario (`non-root`), y secretos totalmente protegidos contra fugas en repositorios o imágenes.
- **Portabilidad Asegurada**: Imágenes 100% compatibles con el estándar OCI empaquetadas con multi-stage builds; migrar a Kubernetes en Fase 6 no requerirá cambiar ni una sola línea del código fuente.

### Negativas / Deuda Técnica Aceptada

- Los microservicios NestJS basados en bus Redis requieren levantar un listener HTTP auxiliar ligero (`startAuxiliaryHealthServer`) exclusivamente para responder a las sondas de salud del orquestador en puertos dedicados (`3001`-`3004`).
- Las definiciones de tareas de ECS requerirán una traducción a manifiestos de Kubernetes (o Helm charts) cuando el volumen de negocio supere los umbrales de escala estipulados para la Fase 6.
