# Fase 4 — Experiencia avanzada web y Android (Sprints 7 y 8)

> **Ventana:** 2026-12-28 → 2027-01-22 · **Equipo:** 2 personas (Umbrex47 y JuanchR4) · **Capacidad:** 84 SP planificados sobre 84 disponibles (42 SP por sprint)
> **Issues:** [`ISSUES.md`](ISSUES.md) · **Plan marco:** [`../../PLAN-INTEGRAL-DESARROLLO.md`](../../PLAN-INTEGRAL-DESARROLLO.md) · **Fase previa:** [`../fase-3/README.md`](../fase-3/README.md) · **Reglas de diseño:** [`../../design/DESIGN-RULES.md`](../../design/DESIGN-RULES.md) · **MCP:** [`../../mcp.md`](../../mcp.md) · **ADR-008:** [`../../adr/008-mcp-internal-transport.md`](../../adr/008-mcp-internal-transport.md)

## 1. Objetivo de la fase

Convertir el asistente determinista de Fase 3 en una experiencia conversacional de tiempo real, sin contraseña y administrable, y llevar la presencia del producto al sistema operativo Android. Al cerrar la fase, un usuario puede conversar con el asistente en streaming desde web y Android, entrar con passkey, y un administrador puede gestionar usuarios, roles e invitaciones con auditoría y consumo visibles; la app Android ofrece widget, Quick Settings Tile, notificaciones push y consulta por voz, todo con accesibilidad AA+ y SLOs medidos.

## 2. Alcance

**Dentro**

- Streaming del asistente en web (SSE sobre el BFF) y en Android (OkHttp/Flow), con cancelación y reconexión.
- Passkeys/WebAuthn: registro y login con clave residente, gestión y revocación de credenciales.
- Panel de administración de tenant: usuarios, roles, invitaciones y salvaguardas RBAC.
- Visor de auditoría y consumo por tenant, con exportación CSV.
- Historial de conversaciones y feedback del chat reutilizado en el set dorado.
- Glance widget y Quick Settings Tile con datos reales y actualización eficiente.
- Notificaciones push con FCM: token por dispositivo, topics por tenant, deduplicación por `eventId`.
- `VoiceInteractionService` con reconocimiento local, TTS y confirmación visual, sin persistir audio.
- Accesibilidad avanzada (AA+): teclado completo, `aria-live` en streaming, contraste y modo denso.
- SLOs de streaming y chat: métricas, paneles y alertas de primer token, duración y cancelación.

**Fuera**

- iOS y Flutter (fuera de alcance, ver ADR-006).
- Despliegue en Kubernetes y endurecimiento de producción (Fase 6).
- Multi-región y lectura geográfica de datos.
- Nuevas pasarelas de pago distintas de PayPal.
- Rediseño de marca blanca y theming por cliente.
- Migración de proveedor LLM o cambio de modelo de orquestación.

## 3. Prerrequisitos

| Requisito                                                          | Motivo de bloqueo                                                              |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Fase 3 cerrada (#75, #76, #78–#83)                                 | Sin chat determinista, MCP auditado y PayPal no hay base sobre la que avanzar. |
| Dominio HTTPS estable con `RP ID` y origin definitivos             | WebAuthn exige un origen seguro y estable; cambiarlo invalida credenciales.    |
| Proyecto FCM creado con `google-services.json` por variante        | Sin proyecto y credenciales no hay registro de token ni entrega verificable.   |
| Permisos Android declarados (`POST_NOTIFICATIONS`, `RECORD_AUDIO`) | Sin ellos las issues móviles no pueden validarse en dispositivo ni emulador.   |
| Proveedor LLM con streaming habilitado y límite de gasto vigente   | El streaming de tokens depende de la capacidad del proveedor elegido.          |
| `OTEL` operativo de extremo a extremo (#77)                        | Los SLOs de SF4-12 se calculan sobre trazas y métricas ya instrumentadas.      |

## 4. Calendario y capacidad

| Sprint | Fechas                  | Foco                                                                     | SP  |
| ------ | ----------------------- | ------------------------------------------------------------------------ | --- |
| 7      | 2026-12-28 → 2027-01-08 | Streaming web/Android, passkeys, historial, accesibilidad, widget y tile | 42  |
| 8      | 2027-01-11 → 2027-01-22 | Administración, auditoría, push, voz, E2E y SLOs                         | 42  |

Supuestos de capacidad: dos personas a jornada completa, 10 días hábiles por sprint, 42 SP por sprint y 84 SP en la fase, con 15 % de buffer para ceremonias, revisión de diseño y soporte. La fase planifica el 100 % de la capacidad disponible, sin colchón entre sprints: cualquier desvío se absorbe recortando SF4-05 (visor de consumo) y SF4-10 (modo denso), nunca los controles de seguridad (passkeys, RBAC, push) ni los SLOs. El pico individual es de 26 SP en el Sprint 7 (Umbrex47) y se compensa con 18 SP en el Sprint 8.

| Persona   | Sprint 7 | Sprint 8 | Total  |
| --------- | -------- | -------- | ------ |
| Umbrex47  | 26       | 18       | 44     |
| JuanchR4  | 16       | 24       | 40     |
| **Total** | **42**   | **42**   | **84** |

Reparto de issues: **44 SP en Umbrex47** (streaming web, passkeys, historial, accesibilidad, administración, visor de auditoría y SLOs) y **40 SP en JuanchR4** (streaming Android, widget/tile, push, voz y E2E). Si la capacidad real cambia, se renegocia el reparto antes de empezar el Sprint 7, nunca el alcance ni los criterios de aceptación.

## 5. Sprint 7 — Streaming, passkeys y presencia (2026-12-28 → 2027-01-08)

**Objetivo:** que el asistente responda en tiempo real en web y Android con cancelación y reconexión fiables, que el acceso pueda hacerse sin contraseña y que la app Android tenga presencia en el sistema operativo, sin degradar la accesibilidad.

| ID     | Issue                                          | Owner    | SP  | Depende de | Entregable verificable                                                                        |
| ------ | ---------------------------------------------- | -------- | --- | ---------- | --------------------------------------------------------------------------------------------- |
| SF4-01 | [Web] Streaming del asistente con SSE          | Umbrex47 | 8   | #72        | `/agente` recibe tokens por BFF, permite cancelar y reconectar sin duplicar mensajes.         |
| SF4-02 | [Mobile] Streaming del asistente en Android    | JuanchR4 | 8   | #72, #96   | Chat Android consume SSE con `Flow`, cancela al salir y sobrevive a la rotación.              |
| SF4-03 | [Web] Passkeys/WebAuthn                        | Umbrex47 | 8   | #45        | Registro y login con passkey funcionan en Chrome/Firefox y la credencial se puede revocar.    |
| SF4-06 | [Mobile] Glance widget y Quick Settings Tile   | JuanchR4 | 8   | #96        | Widget con saldo y flujo del día renderiza en menos de 1 s; el Tile abre el resumen correcto. |
| SF4-09 | [Agent] Historial de conversaciones y feedback | Umbrex47 | 5   | #72        | Historial paginado por tenant/usuario y feedback auditado y aislado por tenant.               |
| SF4-10 | [Web] Accesibilidad avanzada y modo denso      | Umbrex47 | 5   | RD-08      | Chat y tablas navegables por teclado, `aria-live` en streaming y modo denso persistido.       |

**Demo del Sprint 7:** preguntar en `/agente` y ver la respuesta aparecer token a token, cancelarla a mitad y reconectar sin mensajes duplicados; repetir desde Android rotando la pantalla durante la respuesta; entrar con passkey recién registrada y revocarla; mostrar el widget con el saldo del día actualizado por WorkManager y el Tile abriendo el resumen.

## 6. Sprint 8 — Administración, push, voz y SLOs (2027-01-11 → 2027-01-22)

**Objetivo:** dar al administrador del tenant control auditable sobre usuarios y consumo, entregar notificaciones fiables y deduplicadas, habilitar la consulta por voz sin persistir audio y medir el streaming con SLOs operables.

| ID     | Issue                                                          | Owner    | SP  | Depende de     | Entregable verificable                                                                      |
| ------ | -------------------------------------------------------------- | -------- | --- | -------------- | ------------------------------------------------------------------------------------------- |
| SF4-04 | [Web] Administración de tenant: usuarios, roles e invitaciones | Umbrex47 | 8   | #45            | Un admin invita, cambia roles con RBAC y no puede degradar al último admin; todo auditado.  |
| SF4-05 | [Web] Visor de auditoría y consumo por tenant                  | Umbrex47 | 5   | #73, #83       | Tabla filtrable de `audit_logs` y consumo por periodo, exportable a CSV sin PII.            |
| SF4-07 | [Mobile] Notificaciones push con FCM                           | JuanchR4 | 8   | #52, #79       | Push de cobro y conciliación con deep link, deduplicadas por `eventId` y con baja efectiva. |
| SF4-08 | [Mobile] `VoiceInteractionService`                             | JuanchR4 | 8   | #72            | Consulta por voz responde con TTS y confirmación visual, sin almacenar ni loguear audio.    |
| SF4-11 | [QA] E2E de streaming, passkeys, admin y push                  | JuanchR4 | 8   | SF4-01..SF4-07 | Suite cross-canal estable en 3 ejecuciones con p95 de primer token y 0 críticas de axe.     |
| SF4-12 | [Observability] SLOs y alertas de streaming/chat               | Umbrex47 | 5   | #77, #83       | Panel p50/p95 por canal y alertas de p95 > 2 s y errores > 2 %, disparadas en staging.      |

**Demo del Sprint 8:** invitar a un usuario nuevo desde el panel, aceptar la invitación y cambiarle el rol comprobando la salvaguarda del último admin; revisar el consumo del tenant y exportarlo; recibir una push de cobro capturado que abre la factura correcta y comprobar que un reenvío no vuelve a notificar; preguntar por voz «¿cuál es mi saldo?» y ver la alerta de SLO en staging al forzar latencia.

## 7. Criterios de salida de Fase 4

- [ ] El streaming del asistente funciona en web y Android con cancelación efectiva y reconexión sin duplicados.
- [ ] Una passkey registrada sirve como login y como segundo factor, y el usuario puede revocarla.
- [ ] El panel de administración aplica RBAC auditado y nunca deja al tenant sin administrador.
- [ ] El widget y el Tile muestran datos reales, respetan el intervalo de actualización y no drenan batería.
- [ ] Las notificaciones push se entregan con deep link correcto y se deduplican por `eventId`.
- [ ] La consulta por voz responde sin persistir ni loguear audio en ningún punto.
- [ ] Web y Android cumplen WCAG 2.1 AA+ (axe sin críticas, teclado completo y TalkBack verificado).
- [ ] El SLO p95 de primer token < 2 s está medido, panelado y alertado.

## 8. Riesgos específicos

| Riesgo                                      | Efecto                                       | Mitigación                                                                          |
| ------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------- |
| Streaming inestable en redes móviles        | Respuestas cortadas o mensajes duplicados    | `Last-Event-ID`, reconexión idempotente y fallback a respuesta no streaming.        |
| Phishing y credential stuffing con passkeys | Suplantación de identidad                    | Origen y `RP ID` validados, challenge de un solo uso y passkey como segundo factor. |
| Permisos Android denegados                  | Push y voz inservibles para parte de la base | Solicitud en contexto, estados explicativos y degradación sin bloquear el chat.     |
| Notificaciones push duplicadas              | Ruido y pérdida de confianza                 | Deduplicación por `eventId` en servidor y cliente, con tests de reenvío.            |
| Privacidad del audio de voz                 | Exposición de conversaciones sensibles       | Reconocimiento local, sin almacenamiento ni logging, y confirmación visual.         |
| Coste de tokens descontrolado con streaming | Gasto imprevisto por tenant                  | Presupuesto de Fase 3 respetado, métricas de consumo y alertas de presupuesto.      |

## 9. Gobernanza

- **ADRs esperados:** 010 streaming del asistente (SSE, reconexión y cancelación), 011 passkeys/WebAuthn (RP ID, políticas y recuperación), 012 notificaciones push (FCM, topics y deduplicación). Los ADRs son inmutables; una reversión crea uno nuevo.
- Toda pantalla nueva pasa revisión de diseño contra [`DESIGN-RULES.md`](../../design/DESIGN-RULES.md): jerarquía, feedback < 100 ms, foco visible, `prefers-reduced-motion` y axe sin críticas.
- Los cambios de contrato (`agent.chat.stream`, eventos de push, DTOs de administración) se declaran primero en `packages/contracts` y se verifican por drift en CI.
- El transporte MCP sigue la decisión de [ADR-008](../../adr/008-mcp-internal-transport.md): JSON-RPC sobre Redis, sin nuevas superficies de red.
- Toda mutación administrativa o de credenciales exige auditoría con tenant, actor, acción y resultado, sin PII.
- Ramas `feat/SF4-XX-descripcion`; PRs a `develop`; labels `phase-4`, `sprint-7`/`sprint-8` y los de área.

## 10. Dependencias con otras fases

- **Fase 3:** el contrato `agent.chat`, el servidor MCP interno y la gobernanza de tokens (#72, #73, #77, #83) son la base del streaming, del historial y de los SLOs.
- **Fase 2:** #45 (auth y RBAC), #52 (`SensitiveAction` y biometría), #96 (shell Android) y RD-08 (sistema de diseño) se reutilizan en passkeys, push, widget y accesibilidad.
- **Fase 5:** la suite E2E y los SLOs de esta fase alimentan las pruebas integrales y de cumplimiento.
- **Fase 6:** los paneles y alertas de streaming se reutilizan en el despliegue de producción.
