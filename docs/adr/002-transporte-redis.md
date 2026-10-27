# ADR 002 — Transporte Inter-servicio: Redis Broker (RPC, Eventos y BullMQ)

- **Estado:** Aceptado
- **Fecha:** 2026-10-26
- **Issues:** #2 (Infraestructura PostgreSQL y Redis), #11 (ADRs iniciales)

## Contexto

El backend de MyBusiness está estructurado bajo una arquitectura de microservicios con NestJS compuesta por un API Gateway y cuatro servicios de dominio (`auth-service`, `finance-service`, `agent-service`, `audit-service`).
El proyecto requería unificar la estrategia de comunicación entre microservicios, eliminando la discrepancia inicial en la que el README y los issues declaraban Redis como broker mientras el código base utilizaba `Transport.TCP`.

Requisitos de la solución:

- Soportar comunicación síncrona RPC (`send` / `@MessagePattern`) entre el Gateway y los servicios.
- Soportar emisión y suscripción a eventos de dominio (`emit` / `@EventPattern`) de forma desacoplada y no bloqueante.
- Integrar procesamiento de colas en segundo plano con reintentos y tolerancia a fallos mediante **BullMQ**.
- Evitar duplicar brokers o infraestructuras paralelas innecesarias.

## Decisión

Adoptar **Redis 7** como bus de mensajería y broker unificado mediante `@nestjs/microservices` con `Transport.REDIS`:

1. **RPC síncrono (`@MessagePattern`)**: Gestionado vía canales Redis Pub/Sub con canales de respuesta efímeros correlacionados por ID de mensaje.
2. **Eventos asíncronos (`@EventPattern`)**: Publicación fire-and-forget a través de Redis Pub/Sub hacia consumidores suscritos (ej. registro inmutable en `audit-service`).
3. **Colas durables (BullMQ)**: Para tareas que exigen persistencia ante caídas, reintentos con backoff exponencial y dead-letter queues, se utiliza BullMQ aprovechando la misma infraestructura autenticada de Redis (`getBullMQConnectionOptions`).
   > _Nota:_ Redis Pub/Sub es volátil y at-most-once. No debe considerarse sustituto de colas durables.
4. **Seguridad y Aislamiento de Red**:
   - Redis configurado con contraseña obligatoria (`--requirepass` y variable `REDISCLI_AUTH` para evitar contraseñas en procesos).
   - Persistencia activada mediante **AOF (Append-Only File)** con volumen persistente `redis_data`.
   - Exposición estricta a localhost (`127.0.0.1:6379`), bloqueando acceso desde redes externas.

## Consecuencias

**Positivas:**

- Elimina el acoplamiento directo por IP/puerto TCP entre el API Gateway y los microservicios.
- Escalabilidad horizontal simplificada: múltiples réplicas de microservicios pueden escuchar los mismos canales o colas.
- Pila de infraestructura unificada: un único contenedor Redis atiende mensajería de microservicios, caché, rate-limiting (`@nestjs/throttler`) y colas de trabajo (`BullMQ`).

**A vigilar:**

- Pub/Sub no retiene mensajes desconectados: trabajos críticos deben despacharse mediante BullMQ.
- Requiere `maxRetriesPerRequest: null` en las conexiones cliente utilizadas por BullMQ.

## Alternativas descartadas

- **Transport.TCP puro:** Acopla al Gateway a direcciones IP y puertos específicos de cada servicio, complicando la orquestación en contenedores y balanceo dinámico.
- **RabbitMQ / Kafka:** Sobrecarga operativa innecesaria para la escala de la Fase 1 frente a Redis 7.
