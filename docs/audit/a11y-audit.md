# Auditoría de Accesibilidad Web (WCAG 2.1 AA+) y Modo Denso — SF4-10

- **Fecha**: 2026-11-07
- **Responsable**: Equipo de Desarrollo Web (`@Umbrex471`)
- **Estándar**: W3C Web Content Accessibility Guidelines (WCAG) 2.1 Nivel A y AA, con metas AAA en contraste de texto y foco visible.
- **Alcance evaluado**: Portal Web (`apps/web`), con énfasis en:
  - Asistente conversacional streaming (`/agente` · `AgentChat`).
  - Primitivas de datos y modo denso (`Table`, `useTableDensity`, `TableDensityToggle`).
  - Navegación por teclado completa y foco visible en vistas administrativas y tablas del libro mayor.
  - Supresión de parpadeos y animaciones con `prefers-reduced-motion`.

---

## 1. Resumen Ejecutivo

| Área evaluada                | Criterio WCAG                                    | Estado            | Hallazgo / Solución implementada                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Chat Streaming**           | 4.1.3 (Status Messages)                          | **Cumple**        | Se eliminó `aria-live="polite"` del contenedor del chat; se implementó región viva atómica (`sr-only`) que anuncia sólo inicio, herramientas y fin sin spam de tokens.                     |
| **Navegación por Teclado**   | 2.1.1 (Keyboard), 2.4.7 (Focus Visible)          | **Cumple**        | Flujo completo ejecutable sólo con teclado (Tab, Enter, Escape, Shift+Tab), con anillo de foco `outline-focus-ring` (mínimo 3:1 de contraste).                                             |
| **Reducción de Movimiento**  | 2.3.3 (Animation from Interactions)              | **Cumple**        | Clases `motion-reduce:transition-none` y `motion-reduce:animate-none` en barras de progreso, badges de streaming y botones de acción.                                                      |
| **Modo Denso en Tablas**     | 1.3.1 (Info and Relationships), 1.4.3 (Contrast) | **Cumple**        | Modo denso conmutable (`TableDensityToggle`) con `aria-pressed`, reducción del 50% en padding sin alterar ordenación, semántica de encabezados ni jerarquía. Persistido en `localStorage`. |
| **Auditoría Automática axe** | Reglas WCAG 2.0/2.1 A y AA                       | **0 Bloqueantes** | Cero violaciones de impacto `critical` o `serious` en rutas públicas y autenticadas.                                                                                                       |

---

## 2. Metodología y Pruebas Realizadas

### 2.1 Flujo de Lector de Pantalla en Streaming

- **Problema previo**: Un contenedor de mensajes con `role="log" aria-live="polite"` causaba que el lector de pantalla intentara anunciar cada palabra o fragmento de texto a medida que llegaban los eventos Server-Sent Events (SSE), generando una experiencia caótica e ininteligible.
- **Solución implementada**:
  - El contenedor principal de mensajes mantiene `role="log"` y `aria-label="Historial de conversación"`, pero prescinde de `aria-live` y `aria-busy`.
  - Se añade un elemento dedicado:
    ```tsx
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {announcement}
    </div>
    ```
  - Anuncios emitidos por ciclo de vida:
    1. Al enviar la consulta: _"El asistente está generando una respuesta..."_
    2. Durante llamadas de herramienta: _"Consultando herramienta: {toolName}"_
    3. Al completar el stream: _"El asistente ha completado la respuesta."_
    4. En caso de cancelación por usuario: _"Consulta cancelada por el usuario."_
    5. Ante errores de red/gateway: _"Error al generar respuesta."_

### 2.2 Navegación por Teclado y Foco Visible

- Se verificó el orden lógico del tabulador (`tabindex` natural):
  1. Área de texto del mensaje (`#agent-message`), con soporte de `Enter` para enviar y `Shift+Enter` para salto de línea.
  2. Botón _"Enviar"_ con estado de carga y foco visible persistente.
  3. Durante la generación, el botón _"Cancelar"_ es inmediatamente enfocable con una pulsación de `Tab`.
  4. Los chips de sugerencias rápidas y citas cuentan con área táctil accesible (`min-h-11`) y foco `focus-visible:outline-2`.

### 2.3 Modo Denso en Tablas y Persistencia

- **Primitiva `Table`**: Acepta `density?: 'comfortable' | 'compact'` mediante `TableContext`.
- **Estilo Compacto**: Reduce la altura vertical de las filas y el padding de celdas a `px-2 py-1 text-xs` (frente a `px-3 py-2 text-sm`), optimizando la visualización de datos masivos.
- **Persistencia**: El hook `useTableDensity` sincroniza la clave `mybusiness.table.density` en `localStorage` con protección para Server-Side Rendering (SSR).
- **Semántica**: Se preservan íntegros los atributos `role="region"`, `scope="col"` en `TableHeaderCell`, ordenación y selección.

### 2.4 Respeto a `prefers-reduced-motion`

- Todas las animaciones clave (barra de consumo de presupuesto, indicadores de carga y transiciones de color de botones) incluyen la variante `motion-reduce:transition-none` o `motion-reduce:animate-none`.

---

## 3. Evidencia de Validación

```bash
# 1. Pruebas Unitarias de Accesibilidad y Modo Denso
pnpm --filter @mybusiness/web test:unit
# Resultado: 236/236 tests unitarios pasando exitosamente.

# 2. Análisis Estático de Código
pnpm --filter @mybusiness/web lint
# Resultado: eslint . --max-warnings=0 (0 errores, 0 advertencias).

# 3. Comprobación de Tipos TypeScript
pnpm --filter @mybusiness/web typecheck
# Resultado: tsc --noEmit (sin errores).
```

---

## 4. Conclusión

El portal web cumple estrictamente los criterios de aceptación del **Issue #63** (SF4-10), garantizando una experiencia accesible, predecible y altamente usable tanto para usuarios de teclado y lectores de pantalla como para analistas que requieren visualización densa de datos financieros.
