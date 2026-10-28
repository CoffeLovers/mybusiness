# ADR 005: Estrategia de Resiliencia y Fallback para Rate-Limiting Distribuido

## Estado

Aceptado

## Fecha

2026-10-28

## Contexto

En una arquitectura distribuida donde el API Gateway delega el conteo de peticiones y las cuotas de tasa a un clúster de Redis centralizado, surge la necesidad de definir el comportamiento del sistema cuando Redis se encuentra inaccesible, degradado o experimenta fallos de conectividad de red transitorios.

Existen dos extremos arquitectónicos:

1. **Fail-Open Total**: Se omiten los límites y todas las peticiones pasan sin verificar.
   - _Riesgo_: Durante una interrupción de Redis, el perímetro queda completamente desprotegido frente a ataques de fuerza bruta en `/auth/login` y saturación DoS.
2. **Fail-Closed Total**: Se bloquea todo el tráfico (`500` o `503 Service Unavailable`).
   - _Riesgo_: Una caída de Redis tumba la disponibilidad completa del negocio para todos los usuarios legítimos.

## Decisión

Se adopta una **Estrategia Híbrida Resiliente con Fallback Local en Memoria**:

1. **Timeout Estricto y Reducido**: Se configura `connectTimeout: 1000ms` y `maxRetriesPerRequest: 1` en el cliente de Redis para que fallos de red no penalicen la latencia de las peticiones HTTP con demoras prolongadas.
2. **Fallback Local en Memoria (`memoryFallback`)**: Ante cualquier excepción en la evaluación de Redis, el almacenamiento conmuta inmediatamente a un mapa en memoria local por réplica del API Gateway.
   - Si un atacante intenta fuerza bruta contra `/auth/login` durante una interrupción de Redis, cada pod/instancia continuará limitando y bloqueando tras 5 intentos.
   - Para endpoints de negocio (`api` y `heavy`), las cuotas se continúan aplicando localmente sin suspender el servicio.
3. **Métrica y Alerta**: Cada activación del fallback se registra mediante `Logger.warn` con la clave afectada, permitiendo su monitoreo perimetral.

## Consecuencias

### Positivas

- **Seguridad Continua**: La protección contra fuerza bruta en credenciales no desaparece durante incidentes de infraestructura en Redis.
- **Alta Disponibilidad**: El servicio permanece operativo para usuarios legítimos aun en caídas totales del clúster de caché.
- **Baja Latencia**: El timeout de 1s evita acumulación de conexiones en Express.

### Negativas / Mitigaciones

- Durante una caída de Redis, los contadores dejan de ser coordinados globalmente entre réplicas (el límite efectivo pasa a ser $N \times \text{límite}$, donde $N$ es el número de instancias activas del Gateway).
- _Mitigación_: Esta ventana temporal es preferible a una degradación total de seguridad (fail-open) o una indisponibilidad general (fail-closed). Una vez que Redis se restablece, el Gateway retoma la sincronización distribuida automáticamente sin reinicios.
