# Fase 3 — Agentes, MCP y cobros (Sprints 5 y 6)

> **Ventana:** 2026-11-30 → 2026-12-25 · **Equipo:** 4 roles · **Capacidad:** 88 SP planificados sobre 88 disponibles (22 SP por rol en la fase)
> **Issues:** [`ISSUES.md`](ISSUES.md) · **Plan marco:** [`../../PLAN-INTEGRAL-DESARROLLO.md`](../../PLAN-INTEGRAL-DESARROLLO.md)

## 1. Objetivo de la fase

Que un usuario pueda conversar con el asistente sobre sus finanzas con cifras 100 % deterministas producidas por el backend, que el agente invoque herramientas a través de un servidor MCP interno auditado, que el gasto de tokens esté acotado por tenant, y que se puedan crear y cobrar enlaces PayPal con aprobación humana, todo con trazas OpenTelemetry de extremo a extremo.

## 2. Alcance

**Dentro**

- Chat determinista sobre `agent-service`, sin streaming (el streaming SSE se pospone a Fase 4).
- Servidor MCP interno con tres herramientas auditadas: `get_cashflow_summary`, `list_unreconciled_transactions` y `create_payment_link`.
- Gobernanza de tokens: presupuesto por tenant, caché semántica, límite duro de gasto y degradación a respuesta sin LLM.
- Panel web `/agente` con historial, citas a herramientas, estado de presupuesto y estados de error.
- PayPal en `finance-service`: órdenes, enlaces de cobro, capturas, reembolsos y webhooks firmados.
- Aprobación biométrica en Android para captura y reembolso, reutilizando `SensitiveAction`.
- OpenTelemetry en los cuatro servicios y el gateway, con collector propio y dashboards de coste y latencia.
- Evaluación con conjunto de preguntas doradas y verificación de cifras contra SQL.

**Fuera**

- Streaming de tokens y respuestas incrementales (Fase 4).
- WebAuthn/passkeys en web (Fase 4).
- iOS y Flutter (fuera de alcance, ver ADR-006).
- Despliegue en Kubernetes (Fase 6).
- Pasarelas distintas de PayPal (Stripe, Mercado Pago).
- Voz y `VoiceInteractionService` (Fase 4).
- Multi-región y lectura geográfica de datos.

## 3. Prerrequisitos

| Requisito                                                    | Motivo de bloqueo                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------- |
| #54 cerrada (QA, contratos y E2E de Fase 2)                  | Sin OpenAPI estable y E2E en verde no hay base para MCP ni PayPal.  |
| Sandbox de PayPal con webhooks y firma configurada           | Sin firma verificable no se acepta ningún webhook de cobro.         |
| Claves de OpenAI con límite de gasto y modelo elegido        | Sin límite de gasto no se activa el asistente fuera de desarrollo.  |
| Decisión de Astropods (SF3-01) antes de implementar SF3-02   | La orquestación condiciona la interfaz de herramientas.             |
| Colector OTel disponible en local (`docker compose`) y en CI | Sin collector no hay trazas verificables ni demo de observabilidad. |
| Migración de `agent_db` para presupuestos y caché semántica  | El contador atómico y el caché viven en `agent_db`.                 |

## 4. Calendario y capacidad

| Sprint | Fechas                  | Foco                                                           | SP  |
| ------ | ----------------------- | -------------------------------------------------------------- | --- |
| 5      | 2026-11-30 → 2026-12-11 | Agentes, MCP interno, gobernanza de tokens y OpenTelemetry     | 44  |
| 6      | 2026-12-14 → 2026-12-25 | PayPal, aprobación humana, E2E, dashboards de coste y latencia | 44  |

Supuestos de capacidad: 4 roles, 10 días hábiles por sprint, 11 SP por rol y sprint en promedio (22 SP en la fase) y 15 % de buffer para ceremonias, revisión y soporte. La fase planifica 88 SP sobre 88 disponibles, sin colchón entre sprints: cualquier desvío se absorbe recortando SF3-13 (dashboards) y SF3-06 (ampliación del set dorado), nunca relajando controles de dinero o auditoría. El pico individual es de 21 SP en un sprint (Backend 1 en el Sprint 5) y se compensa con un Sprint 6 más ligero para ese rol.

| Rol        | Sprint 5 | Sprint 6 | Total  |
| ---------- | -------- | -------- | ------ |
| Backend 1  | 20       | 16       | 36     |
| Backend 2  | 11       | 8        | 19     |
| Frontend 1 | 5        | 8        | 13     |
| Frontend 2 | 8        | 12       | 20     |
| **Total**  | **44**   | **44**   | **88** |

## 5. Sprint 5 — Agentes y gobernanza

**Objetivo:** que el asistente responda con cifras del backend a través de herramientas MCP auditadas, con el gasto de tokens acotado por tenant y trazas visibles de extremo a extremo.

| ID     | Issue                                                  | Owner      | SP  | Depende de     | Entregable verificable                                                            |
| ------ | ------------------------------------------------------ | ---------- | --- | -------------- | --------------------------------------------------------------------------------- |
| SF3-01 | Evaluación de Astropods y ADR de orquestación          | Backend 2  | 3   | —              | ADR-007 con decisión, escenarios comparados y criterio de reversibilidad.         |
| SF3-02 | Asistente conversacional determinista sin streaming    | Backend 2  | 8   | SF3-04         | `agent.chat` responde citando herramientas y sin aritmética en el LLM.            |
| SF3-03 | Gobernanza de tokens: presupuesto, caché y degradación | Backend 1  | 8   | —              | Un tenant que agota presupuesto recibe respuesta degradada y evento de auditoría. |
| SF3-04 | Servidor MCP interno con herramientas auditadas        | Backend 1  | 8   | #51            | Tres herramientas invocables con esquema validado y auditoría por invocación.     |
| SF3-05 | Panel de agente con chat, citas y presupuesto          | Frontend 2 | 8   | SF3-02         | `/agente` conversa con citas, muestra presupuesto y estados de error.             |
| SF3-06 | Set dorado de cifras y contract tests MCP              | Backend 1  | 4   | SF3-02, SF3-04 | 30 preguntas con cifras esperadas al 100 % en CI y contratos MCP verificados.     |
| SF3-07 | OpenTelemetry de extremo a extremo                     | Frontend 1 | 5   | —              | Una petición web aparece como traza única con `tenantId` y canal en Jaeger/Tempo. |

**Demo del Sprint 5:** preguntar «¿cuál es mi flujo de caja de octubre?» en `/agente`, comprobar que la cifra coincide con `get_cashflow_summary` y con el SQL del set dorado, forzar el agotamiento del presupuesto de un tenant de prueba y ver la traza completa en Jaeger/Tempo con `tenantId`, `traceId` y canal.

## 6. Sprint 6 — Cobros y observabilidad

**Objetivo:** cobrar por PayPal en sandbox con aprobación humana explícita y medir coste y latencia del asistente con dashboards operables.

| ID     | Issue                                               | Owner      | SP  | Depende de     | Entregable verificable                                                           |
| ------ | --------------------------------------------------- | ---------- | --- | -------------- | -------------------------------------------------------------------------------- |
| SF3-08 | Órdenes y enlaces de cobro PayPal                   | Backend 1  | 8   | #51            | `POST /payments/paypal/orders` devuelve link de checkout idempotente.            |
| SF3-09 | Capturas, reembolsos y webhooks firmados            | Backend 1  | 8   | SF3-08         | Captura y reembolso concilian con la factura; webhook duplicado no reprocesa.    |
| SF3-10 | Cobros PayPal en el portal con aprobación humana    | Frontend 1 | 8   | SF3-09         | Link creado desde factura, captura y reembolso con reautenticación explícita.    |
| SF3-11 | Cobros y aprobación biométrica en Android           | Frontend 2 | 8   | SF3-08, #52    | Captura y reembolso exigen `BiometricPrompt` y el deep link de retorno funciona. |
| SF3-12 | E2E de agentes, MCP y PayPal + carga conversacional | Backend 2  | 8   | SF3-02, SF3-09 | E2E multi-canal en verde y 50 conversaciones concurrentes dentro de umbral.      |
| SF3-13 | Dashboards de coste de tokens y latencia            | Frontend 2 | 4   | SF3-03, SF3-07 | Paneles de tokens, coste, caché y p95 de chat con alerta al 80 % de presupuesto. |

**Demo del Sprint 6:** crear un enlace de cobro desde una factura, pagar en el sandbox de PayPal, comprobar que el webhook firmado concilia la orden con la factura y que un reenvío del mismo evento no la duplica; emitir un reembolso parcial aprobado con biometría en Android y mostrar el dashboard de coste del tenant de demo.

## 7. Criterios de salida de Fase 3

- [ ] El 100 % de las cifras mostradas por el chat en el set dorado coincide con la consulta SQL de referencia.
- [ ] Ninguna invocación MCP se ejecuta sin registro de auditoría con tenant, usuario, herramienta y resultado.
- [ ] El presupuesto por tenant se aplica en el servidor: agotado el límite, la respuesta se degrada y no se llama al proveedor.
- [ ] PayPal funciona de extremo a extremo en sandbox: orden, captura, webhook idempotente y reembolso aprobado por una persona.
- [ ] Toda traza de los cuatro servicios y el gateway incluye `tenantId`, `traceId` y canal, sin PII.
- [ ] El panel `/agente` y las pantallas de cobro cumplen WCAG 2.1 AA (axe sin violaciones críticas).

## 8. Riesgos específicos

| Riesgo                             | Efecto                                        | Mitigación                                                                    |
| ---------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------- |
| Alucinación de cifras              | Decisiones financieras sobre datos falsos     | El LLM sólo recibe JSON determinista; set dorado bloqueante en CI (SF3-06).   |
| Fuga de datos al proveedor del LLM | Exposición de información financiera sensible | Minimización de contexto, sin PII y proveedor con retención cero documentada. |
| Coste descontrolado de tokens      | Gasto imprevisto por tenant                   | Presupuesto duro en servidor, caché semántica y degradación sin LLM (SF3-03). |
| Webhook PayPal falsificado         | Órdenes o capturas inventadas                 | Verificación de firma obligatoria, fail-closed y dedupe por `event_id`.       |
| Latencia alta del chat             | Abandono del asistente                        | Timeouts, caché, degradación sin LLM y umbral p95 medido en SF3-12.           |
| Deriva de contratos MCP            | Herramientas rotas entre agente y servidor    | Esquema versionado y contract tests en CI (SF3-04, SF3-06).                   |

## 9. Dependencias con otras fases

- **Fase 2:** #51 (libro mayor y conciliación) habilita las herramientas MCP y la referencia de factura en PayPal; #52 (`SensitiveAction` y biometría) se reutiliza en SF3-11; #54 cierra contratos y E2E previos.
- **Fase 4:** el streaming SSE, WebAuthn/passkeys y la voz consumen la interfaz de chat y herramientas definida aquí; el contrato `agent.chat` debe nacer versionado.
- **Fase 5:** los conjuntos dorados y los dashboards de coste son insumo de las pruebas integrales y del cumplimiento.
- **Fase 6:** el collector OTel de esta fase se reutiliza en el despliegue de producción.

## 10. Gobernanza

- **ADRs nuevos:** 007 orquestación y Astropods (SF3-01), 008 servidor MCP interno (SF3-04), 009 cobros con PayPal (SF3-08). Los ADRs son inmutables; una reversión crea uno nuevo.
- Los cambios de contrato en `packages/contracts` requieren aprobación del owner de contratos (Backend 1) y verificación de drift en CI.
- Los patrones nuevos (`agent.chat`, `mcp.tool.invoked`, `payments.paypal.*`) se declaran primero en `packages/contracts/src/patterns` y luego se implementan.
- Toda operación con dinero exige confirmación humana y auditoría; ningún canal puede eludir el presupuesto ni la verificación de firma.
- Ramas `feat/SF3-XX-descripcion`; PRs a `develop`; labels `phase-3`, `sprint-5`/`sprint-6` y los de área.
