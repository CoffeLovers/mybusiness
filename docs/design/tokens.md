# Contrato de tokens de diseño — MyBusiness

| Campo            | Valor                                                    |
| ---------------- | -------------------------------------------------------- |
| Issue            | #90 — RD-01 `[Design]` Auditoría UI y contrato de tokens |
| Versión          | 1.0.0                                                    |
| Fecha            | 2026-11-04                                               |
| Estado           | Aprobado para RD-02/RD-06                                |
| Contrato JSON    | `docs/design/tokens.json`                                |
| Reglas de origen | `docs/design/DESIGN-RULES.md` §3 y §4                    |
| Plan             | `docs/design/REDESIGN-PLAN.md` (RD-01 y RD-06)           |

Este documento es vinculante para todo cambio de UI en `apps/web` y `apps/mobile-android`. `DESIGN-RULES.md` define la doctrina y los umbrales; este contrato fija los valores, los roles y la correspondencia entre plataformas. Ante conflicto, manda `DESIGN-RULES.md` §3 y §4, y el cambio se corrige aquí en el mismo PR.

## 1. Alcance y relación con DESIGN-RULES.md

- `DESIGN-RULES.md` §3 establece la jerarquía obligatoria de tres capas, los roles semánticos y las reglas duras (prohibido hex en componentes, paridad claro/oscuro, estados que no son marca).
- `DESIGN-RULES.md` §4 fija los umbrales medibles: 4.5:1 para texto normal, 3:1 para texto grande, componentes de UI, iconos y bordes informativos, y anillo de foco.
- Este documento convierte esas reglas en una lista cerrada de tokens, valores y usos, más un script que las verifica.
- Fuera de alcance de RD-01: implementar primitivas web (RD-02), modificar el tema Android (RD-06) y rediseñar pantallas. RD-01 no altera ningún valor en código.

## 2. Fuente canónica de la paleta

Se adopta como paleta semántica canónica la ya aprobada y verificada AA de `apps/web`:

- `apps/web/app/globals.css` — bloques `:root` (claro) y `:root.dark` (oscuro), y mapeo `@theme inline`.
- `apps/web/lib/tokens.ts` — espejo tipado de la paleta.
- `apps/web/test/contrast.spec.ts` — verificación de los pares de texto.

Decisiones:

1. **No se introducen colores de marca nuevos.** Los valores de `surface`, `surface-raised`, `text`, `text-muted`, `primary`, `on-primary`, `income`, `expense`, `neutral` y `alert` son exactamente los vigentes en web.
2. **`border` se conserva decorativo.** Su ratio actual es 1.62:1 en claro y 2.17:1 en oscuro; no transmite información por sí solo y está exento de WCAG 1.4.11.
3. **Se añade un único token no-marca: `border-strong`.** Es necesario porque los controles interactivos que se delimitan con borde exigen 3:1, y `border` no lo cumple. No es un color de marca: es un gris neutro derivado de la familia de `text-muted`.
   - Claro: `#6b7280` (4.83:1 sobre `surface`, 4.46:1 sobre `surface-raised`).
   - Oscuro: `#7c8ba1` (5.54:1 sobre `surface`, 5.00:1 sobre `surface-raised`).
4. **Las divergencias actuales de Android no se corrigen aquí.** `core/designsystem/theme/Color.kt` usa una paleta de marca distinta (azul marino, esmeralda) y colores semánticos fuera del `ColorScheme`. Se registran como deuda de RD-06 y no forman parte del contrato. RD-01 no modifica archivos de código.

## 3. Jerarquía en tres capas

| Capa                | Definición                             | Ejemplos reales en el repo                                                                                                                                                                    | Quién consume                     |
| ------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Global / referencia | Valor bruto sin contexto de uso        | `--spacing: 0.25rem`, `--radius-md: 0.5rem`, `--text-base: 1rem` (`globals.css`); `Color(0xFF1E3A8A)` (`Color.kt:6`)                                                                          | Solo capas 2 y 3                  |
| Semántica / sistema | Decisión con significado de uso        | `--color-surface`, `--color-income`, `--color-text-muted` (`globals.css:55-99`); `MaterialTheme.colorScheme.primary`                                                                          | Componentes y capa 3              |
| Componente          | Asignación local de un token semántico | `--button-primary-background: var(--color-primary)` (propuesto para RD-02); hoy `ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)` en `PrimaryButton.kt:30-33` | Solo el componente que la declara |

Notas de estado actual:

- Web no tiene una capa global de color: `:root` declara directamente los valores semánticos. La capa global existe para spacing, radios y tipografía. Introducir una capa de referencia de color es opcional en RD-02 y no puede cambiar ningún valor aprobado.
- Android ya separa referencia (`BrandPrimaryLight`, `SuccessGreen`, etc.) de semántica (`MaterialTheme.colorScheme.*`), pero los roles financieros viven fuera del `ColorScheme`, por lo que no llegan a la capa semántica.
- Los componentes **solo** consumen nivel 2 o 3. Nunca nivel 1, nunca literales.

## 4. Roles semánticos

| Rol              | Uso                                                     | Informativo | Claro     | Oscuro    | Capa      |
| ---------------- | ------------------------------------------------------- | ----------- | --------- | --------- | --------- |
| `surface`        | Fondo base de la vista                                  | Sí          | `#ffffff` | `#0b0f16` | semántica |
| `surface-raised` | Tarjetas, tablas y paneles                              | Sí          | `#f4f6f8` | `#151b24` | semántica |
| `border`         | Separadores y contornos decorativos                     | No          | `#c3ccd6` | `#3f4b5c` | semántica |
| `border-strong`  | Borde de controles y límites que transmiten información | Sí          | `#6b7280` | `#7c8ba1` | semántica |
| `text`           | Texto primario                                          | Sí          | `#101720` | `#f2f5f8` | semántica |
| `text-muted`     | Metadatos, ayudas, placeholders                         | Sí          | `#55606f` | `#a3aebd` | semántica |
| `primary`        | Acción primaria y enlaces                               | Sí          | `#1d4ed8` | `#7aa2ff` | semántica |
| `on-primary`     | Texto e iconos sobre `primary`                          | Sí          | `#ffffff` | `#0b0f16` | semántica |
| `income`         | Entradas de dinero e importes positivos                 | Sí          | `#047857` | `#34d399` | semántica |
| `expense`        | Salidas de dinero e importes negativos                  | Sí          | `#b91c1c` | `#f87171` | semántica |
| `neutral`        | Importes sin signo y estados neutros                    | Sí          | `#4b5563` | `#9aa5b4` | semántica |
| `alert`          | Advertencias y errores de estado de baja severidad      | Sí          | `#92400e` | `#fbbf24` | semántica |
| `focus-ring`     | Anillo de foco visible sobre superficies adyacentes     | Sí          | `#1d4ed8` | `#7aa2ff` | semántica |
| `accent`         | Acento de marca lima: realces y texto sobre `inverse`   | Sí          | `#ddf84b` | `#ddf84b` | semántica |
| `on-accent`      | Texto e iconos sobre `accent`                           | Sí          | `#000000` | `#000000` | semántica |
| `inverse`        | Superficie de sección invertida (no fondo global)       | Sí          | `#1a1a1a` | `#1a1a1a` | semántica |
| `inverse-raised` | Tarjetas y paneles dentro de una sección invertida      | Sí          | `#262626` | `#262626` | semántica |
| `on-inverse`     | Texto e iconos primarios sobre `inverse`                | Sí          | `#ffffff` | `#ffffff` | semántica |
| `inverse-muted`  | Metadatos y etiquetas secundarias sobre `inverse`       | Sí          | `#b3b3b3` | `#b3b3b3` | semántica |

Reglas asociadas:

- Convención de nombres: el contrato JSON usa `camelCase` (`surfaceRaised`, `borderStrong`, `focusRing`); CSS usa `kebab-case` (`--color-surface-raised`, `--color-border-strong`) y Compose usa el slot M3 correspondiente.
- `border` es decorativo: WCAG 1.4.11 no aplica. Si un borde delimita un control, se usa `border-strong`.
- `focus-ring` no reutiliza `primary` por conveniencia: se declara como rol propio para poder ajustarlo por superficie sin tocar la marca. En web hoy el anillo usa `--color-primary` (`globals.css:183`); RD-02 debe introducir `--color-focus-ring`.
- **`accent`, `on-accent`, `inverse`, `inverse-raised`, `on-inverse` e `inverse-muted` son idénticos en claro y oscuro.** La sección invertida siempre es oscura y el acento es de marca, por lo que no dependen del tema.
- **`inverse` no es un fondo global.** Delimita secciones invertidas concretas (héroe, CTA, cinta); el fondo base de la vista sigue siendo `surface`.
- **`accent` no se usa como texto sobre superficies claras** (`surface`/`surface-raised`): 1.19:1, no alcanza AA. Como texto solo se usa sobre `inverse` (14.59:1).
- **`on-primary` es el único nombre canónico.** `DESIGN-RULES` §3 fija la convergencia a `on-primary`; el renombrado se completó en RD-02 (#91): `primary-contrast`/`primaryContrast` ya no existen y el único nombre es `on-primary`/`onPrimary`. Android ya usa `onPrimary` y no requirió cambios.

## 5. Ratios de contraste verificados

Verificación WCAG 2.1 con luminancia relativa, redondeo a dos decimales. Generado por `scripts/design/check-contrast.mjs` a partir de `tokens.json`.

### Tema claro

| Par (fg / bg)                      | Ratio | Umbral | Resultado |
| ---------------------------------- | ----- | ------ | --------- |
| `text` / `surface`                 | 18.02 | 4.5    | PASS      |
| `text` / `surface-raised`          | 16.63 | 4.5    | PASS      |
| `text-muted` / `surface`           | 6.39  | 4.5    | PASS      |
| `text-muted` / `surface-raised`    | 5.89  | 4.5    | PASS      |
| `on-primary` / `primary`           | 6.70  | 4.5    | PASS      |
| `primary` / `surface`              | 6.70  | 4.5    | PASS      |
| `primary` / `surface-raised`       | 6.19  | 4.5    | PASS      |
| `income` / `surface`               | 5.48  | 4.5    | PASS      |
| `income` / `surface-raised`        | 5.06  | 4.5    | PASS      |
| `expense` / `surface`              | 6.47  | 4.5    | PASS      |
| `expense` / `surface-raised`       | 5.97  | 4.5    | PASS      |
| `neutral` / `surface`              | 7.56  | 4.5    | PASS      |
| `neutral` / `surface-raised`       | 6.98  | 4.5    | PASS      |
| `alert` / `surface`                | 7.09  | 4.5    | PASS      |
| `alert` / `surface-raised`         | 6.54  | 4.5    | PASS      |
| `focus-ring` / `surface`           | 6.70  | 3.0    | PASS      |
| `focus-ring` / `surface-raised`    | 6.19  | 3.0    | PASS      |
| `border-strong` / `surface`        | 4.83  | 3.0    | PASS      |
| `border-strong` / `surface-raised` | 4.46  | 3.0    | PASS      |
| `text` / `surface` (iconos)        | 18.02 | 3.0    | PASS      |
| `text-muted` / `surface` (iconos)  | 6.39  | 3.0    | PASS      |
| `on-primary` / `primary`           | 6.70  | 3.0    | PASS      |

### Tema oscuro

| Par (fg / bg)                      | Ratio | Umbral | Resultado |
| ---------------------------------- | ----- | ------ | --------- |
| `text` / `surface`                 | 17.54 | 4.5    | PASS      |
| `text` / `surface-raised`          | 15.81 | 4.5    | PASS      |
| `text-muted` / `surface`           | 8.54  | 4.5    | PASS      |
| `text-muted` / `surface-raised`    | 7.70  | 4.5    | PASS      |
| `on-primary` / `primary`           | 7.71  | 4.5    | PASS      |
| `primary` / `surface`              | 7.71  | 4.5    | PASS      |
| `primary` / `surface-raised`       | 6.95  | 4.5    | PASS      |
| `income` / `surface`               | 9.98  | 4.5    | PASS      |
| `income` / `surface-raised`        | 9.00  | 4.5    | PASS      |
| `expense` / `surface`              | 6.94  | 4.5    | PASS      |
| `expense` / `surface-raised`       | 6.25  | 4.5    | PASS      |
| `neutral` / `surface`              | 7.69  | 4.5    | PASS      |
| `neutral` / `surface-raised`       | 6.93  | 4.5    | PASS      |
| `alert` / `surface`                | 11.50 | 4.5    | PASS      |
| `alert` / `surface-raised`         | 10.36 | 4.5    | PASS      |
| `focus-ring` / `surface`           | 7.71  | 3.0    | PASS      |
| `focus-ring` / `surface-raised`    | 6.95  | 3.0    | PASS      |
| `border-strong` / `surface`        | 5.54  | 3.0    | PASS      |
| `border-strong` / `surface-raised` | 5.00  | 3.0    | PASS      |
| `text` / `surface` (iconos)        | 17.54 | 3.0    | PASS      |
| `text-muted` / `surface` (iconos)  | 8.54  | 3.0    | PASS      |
| `on-primary` / `primary`           | 7.71  | 3.0    | PASS      |

Aclaraciones:

- Total: 54 pares validados (27 por tema).
- `border` decorativo está exento: 1.62:1 en claro y 2.17:1 en oscuro. No se usa para delimitar controles ni para transmitir estado.
- `border-strong` cumple 3:1 en ambos temas y ambas superficies; es el borde permitido en inputs, botones secundarios y contenedores interactivos.
- El mínimo global del contrato es 4.46:1 (`border-strong` sobre `surface-raised` en claro), por encima del 3:1 exigido a componentes de UI.

### Acento y sección invertida

Estos seis pares usan los mismos valores en claro y oscuro. Aparecen duplicados en el script para ambos temas porque la paridad de roles es obligatoria.

| Par (fg / bg)               | Ratio | Umbral | Resultado |
| --------------------------- | ----- | ------ | --------- |
| `on-accent` / `accent`      | 17.60 | 4.5    | PASS      |
| `on-inverse` / `inverse`    | 17.40 | 4.5    | PASS      |
| `inverse-muted` / `inverse` | 8.30  | 4.5    | PASS      |
| `accent` / `inverse`        | 14.59 | 4.5    | PASS      |
| `accent` / `inverse` (UI)   | 14.59 | 3.0    | PASS      |

- `on-accent` (negro) sobre `accent` (lima) alcanza 17.60:1: apto para texto e iconos, incluido AAA.
- `on-inverse` y `inverse-muted` sobre `inverse` cumplen AA con holgura (17.40:1 y 8.30:1).
- `accent` sobre `inverse` sirve como texto de acento y como indicador de UI (14.59:1).
- **`accent` NO se usa como texto sobre `surface` claro**: 1.19:1, muy por debajo de 4.5:1. Sobre `surface` oscuro daría 16.09:1, pero se evita depender del tema y el acento se reserva para la sección invertida o como fondo con `on-accent`.

## 6. Escala de espaciado 4/8

- Base: 4 px (`--spacing: 0.25rem`).
- Valores permitidos: solo los de la lista cerrada `spacing.escala`; todo token debe ser además múltiplo de 4, con paso de 8 recomendado desde 16 px.
- Desde 16 px se recomienda paso de 8 para evitar ruido visual.
- Prohibidas las utilidades arbitrarias y los literales fuera de la escala (p. ej. `p-5` = 20 px, `mt-7` = 28 px, `Modifier.padding(14.dp)`); `gap-3` = 12 px sí pertenece a la escala.
- La lista cerrada `spacing.escala` de `tokens.json` es la fuente de verdad: el script valida la pertenencia a esa lista, no solo que el valor sea múltiplo de 4.
- No son tokens de spacing: dimensiones de componentes, tamaños de icono, anchos/altos fijos y grosores de trazo.

| Token      | px  | rem  | Uso típico                                   |
| ---------- | --- | ---- | -------------------------------------------- |
| `space-1`  | 4   | 0.25 | Separación mínima entre icono y texto        |
| `space-2`  | 8   | 0.5  | Gap interno de chips y separación de targets |
| `space-3`  | 12  | 0.75 | Padding compacto de controles                |
| `space-4`  | 16  | 1    | Padding base de tarjetas y contenedores      |
| `space-6`  | 24  | 1.5  | Separación entre bloques                     |
| `space-8`  | 32  | 2    | Separación entre secciones                   |
| `space-10` | 40  | 2.5  | Márgenes de página en desktop                |
| `space-12` | 48  | 3    | Separación de bloques mayores                |
| `space-16` | 64  | 4    | Aire vertical entre secciones principales    |
| `space-20` | 80  | 5    | Márgenes amplios de layout                   |
| `space-24` | 96  | 6    | Separaciones excepcionales de página         |

`space-5` (20 px), `space-7` (28 px) y los valores intermedios no forman parte de la escala. Si un diseño necesita 20 px, se elige 16 o 24.

## 7. Radios

| Token  | px   | Web hoy                                     | Android hoy (Shape.kt) | Deuda                                    |
| ------ | ---- | ------------------------------------------- | ---------------------- | ---------------------------------------- |
| `sm`   | 4    | `--radius-sm: 0.25rem`                      | No existe              | Android debe añadir 4 dp en RD-06        |
| `md`   | 8    | `--radius-md: 0.5rem`                       | `small = 8.dp`         | Equivalencia por nombre distinto         |
| `lg`   | 12   | `--radius-lg: 0.75rem`                      | `medium = 12.dp`       | Equivalencia por nombre distinto         |
| `xl`   | 16   | No existe                                   | `large = 16.dp`        | Web debe añadir `--radius-xl` en RD-02   |
| `full` | 9999 | `rounded-full` (utilidad, sin token propio) | No existe              | Web debe declarar token; Android, añadir |

Divergencias registradas: web solo declara 4/8/12; Android declara 8/12/16/24. El valor 24 dp de `extraLarge` no pertenece a la escala y se elimina o se remapea en RD-06. La escala objetivo es 4/8/12/16/9999.

## 8. Tipografía

Escala web: base 16 px. De `xl` a `4xl` se aplica el ratio 1.25; `lg`, `sm` y `xs` usan los pasos convencionales ya fijados en `globals.css:131-147`, que no siguen el ratio de forma estricta. La escala no se reescribe en RD-01.

| Token  | px    | rem       | Line-height | Line-height px | Uso                             |
| ------ | ----- | --------- | ----------- | -------------- | ------------------------------- |
| `xs`   | 12    | 0.75rem   | 1.5         | 18             | Metadatos y badges              |
| `sm`   | 14    | 0.875rem  | 1.5         | 21             | Texto secundario y etiquetas    |
| `base` | 16    | 1rem      | 1.5         | 24             | Texto de lectura                |
| `lg`   | 18    | 1.125rem  | 1.5         | 27             | Texto destacado                 |
| `xl`   | 20    | 1.25rem   | 1.4         | 28             | Título de tarjeta               |
| `2xl`  | 25    | 1.5625rem | 1.3         | 32.5           | KPI secundario                  |
| `3xl`  | 31.25 | 1.953rem  | 1.25        | 39.06          | Título de sección               |
| `4xl`  | 39.06 | 2.441rem  | 1.2         | 46.88          | KPI primario / título de página |

Mapeo objetivo a estilos Material 3 de Android (`Type.kt`):

| Web    | Android objetivo | Valor actual en `Type.kt` | Divergencia                                            |
| ------ | ---------------- | ------------------------- | ------------------------------------------------------ |
| `4xl`  | `displaySmall`   | No definido               | Falta; RD-06 decide si se añade `displaySmall` (36 sp) |
| `3xl`  | `headlineLarge`  | 32 sp / 40 sp, Bold       | 31.25 px frente a 32 sp: aceptable                     |
| `2xl`  | `headlineMedium` | 28 sp / 36 sp, SemiBold   | 25 px frente a 28 sp: difiere                          |
| `xl`   | `titleLarge`     | 20 sp / 28 sp, SemiBold   | Coincide en tamaño; difiere el peso si se usa para KPI |
| `lg`   | `titleLarge`     | 20 sp / 28 sp             | 18 px frente a 20 sp: difiere                          |
| `base` | `bodyLarge`      | 16 sp / 24 sp, Normal     | Coincide                                               |
| `sm`   | `bodyMedium`     | 14 sp / 20 sp, Normal     | Coincide                                               |
| `xs`   | `bodySmall`      | 12 sp / 16 sp, Normal     | Coincide en tamaño; line-height menor                  |

Deuda adicional: `Type.kt` define 10 estilos (de `headlineLarge` a `labelLarge`). Faltan `displayLarge`, `displayMedium`, `displaySmall`, `labelMedium` y `labelSmall` respecto a la escala M3 completa. RD-06 debe declararlos o justificar su ausencia.

## 9. Elevación

| Nivel | Unidades | Uso                                     |
| ----- | -------- | --------------------------------------- |
| 0     | 0        | Superficie plana; `surface`             |
| 1     | 1        | Tarjetas y contenedores sobre `surface` |
| 2     | 3        | Elementos flotantes: menús y popovers   |
| 3     | 6        | Diálogos y hojas modales                |

Reglas:

- La elevación no sustituye al contraste. Un contenedor elevado sigue necesitando una superficie diferenciada o un borde (`border-strong` si delimita un control).
- La elevación no es el único indicador de que algo es interactivo.
- Implementación pendiente: web debe declarar tokens de sombra en RD-02; Android debe mapear a `tonalElevation`/`shadowElevation` en RD-06.

## 10. Movimiento (motion)

| Token             | Valor                            | Uso                                     |
| ----------------- | -------------------------------- | --------------------------------------- |
| `duration-fast`   | 150 ms                           | Cambios de estado, hover, press         |
| `duration-base`   | 200 ms                           | Aparición de contenido y transiciones   |
| `duration-slow`   | 300 ms                           | Entradas y salidas de paneles o modales |
| `easing-enter`    | `cubic-bezier(0.0, 0.0, 0.2, 1)` | Elementos que entran                    |
| `easing-exit`     | `cubic-bezier(0.4, 0.0, 1, 1)`   | Elementos que salen                     |
| `easing-standard` | `cubic-bezier(0.4, 0.0, 0.2, 1)` | Movimiento sin dirección dominante      |

Reduced motion:

- Web: `@media (prefers-reduced-motion: reduce)` desactiva animaciones, transiciones no esenciales y parallax. Ya existe el bloque en `globals.css:195-206`; todo componente nuevo debe respetarlo.
- Compose: se respeta la escala de animación del sistema (`Settings.Global.ANIMATOR_DURATION_SCALE`); con animaciones desactivadas no se ejecutan transiciones no esenciales.
- Las duraciones viven en tokens, no en clases sueltas ni en `animate-*` arbitrarios.
- Excepción acotada: `globals.css` declara `@keyframes marquee` y la utilidad `.animate-marquee` (28 s lineal infinita) como animación reutilizable de cintas de logos/texto. No es un token de duración nuevo; el bloque global de `prefers-reduced-motion` la detiene.

## 11. Correspondencia web ↔ Android

Estado de cada rol frente a `core/designsystem`:

| Rol semántico    | Token CSS web                   | Slot Material 3 / equivalente Android                  | Estado                              |
| ---------------- | ------------------------------- | ------------------------------------------------------ | ----------------------------------- |
| `surface`        | `--color-surface`               | `colorScheme.surface` (`Theme.kt:23,40`)               | Difiere                             |
| `surface-raised` | `--color-surface-raised`        | `colorScheme.surfaceVariant` (`Theme.kt:25,42`)        | Difiere                             |
| `border`         | `--color-border`                | `colorScheme.outlineVariant` (no asignado)             | Falta                               |
| `border-strong`  | `--color-border-strong` (nuevo) | `colorScheme.outline` (no asignado)                    | Falta                               |
| `text`           | `--color-text`                  | `colorScheme.onSurface` (`Theme.kt:24,41`)             | Difiere                             |
| `text-muted`     | `--color-text-muted`            | `colorScheme.onSurfaceVariant` (`Theme.kt:26,43`)      | Difiere                             |
| `primary`        | `--color-primary`               | `colorScheme.primary` (`Theme.kt:14,31`)               | Difiere                             |
| `on-primary`     | `--color-on-primary`            | `colorScheme.onPrimary` (`Theme.kt:15,32`)             | Renombrado aplicado en RD-02        |
| `focus-ring`     | `--color-focus-ring` (nuevo)    | Indicador de foco sobre `colorScheme.primary`          | Falta                               |
| `income`         | `--color-income`                | `colorScheme.secondary` (hoy) / rol `income` propuesto | Difiere                             |
| `expense`        | `--color-expense`               | `colorScheme.error` (`Theme.kt:27,44`)                 | Parcial: sin par oscuro propio      |
| `neutral`        | `--color-neutral`               | Sin slot dedicado                                      | Falta                               |
| `alert`          | `--color-alert`                 | `WarningAmber` fuera del `ColorScheme`                 | Falta                               |
| `info`           | No existe                       | `InfoBlue` fuera del `ColorScheme`                     | Falta; rol nuevo a definir en RD-06 |

Notas:

- `info` no forma parte del contrato de color de RD-01 porque no existe en la paleta web aprobada. Se documenta como rol candidato: `Color.kt:44` (`InfoBlue #3B82F6`) se usa hoy como color de información. RD-06 debe decidir si lo incorpora al `ColorScheme` con un valor que cumpla AA, o si lo elimina en favor de `primary`/`neutral`.
- Los valores actuales de Android que no cumplen AA sobre blanco son deuda de RD-06, no parte de este contrato:
  - `SuccessGreen #10B981` = 2.54:1.
  - `WarningAmber #F59E0B` = 2.15:1.
  - `ErrorRed #EF4444` = 3.76:1.
  - `InfoBlue #3B82F6` = 3.68:1.
- RD-06 debe alinear los valores semánticos con la tabla de §4 y verificar contraste en tests unitarios.

## 12. Inventario de hardcodes detectados

Ruta completa desde la raíz del repo. La columna «Token destino» indica el rol que debe consumirse cuando se implemente RD-02 o RD-06.

| Archivo:línea                                                                                                    | Valor actual                       | Token destino                                        | Nota                                                                                      |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `apps/web/components/dashboard/cashflow-chart.tsx:54`                                                            | `#047857`                          | `--color-income`                                     | Punto de leyenda del tooltip                                                              |
| `apps/web/components/dashboard/cashflow-chart.tsx:55`                                                            | `#b91c1c`                          | `--color-expense`                                    | Punto de leyenda del tooltip                                                              |
| `apps/web/components/dashboard/cashflow-chart.tsx:71`                                                            | `var(--color-text, #101720)`       | `--color-text`                                       | Eliminar el fallback hexadecimal                                                          |
| `apps/web/components/dashboard/cashflow-chart.tsx:83`                                                            | `var(--color-border, #c3ccd6)`     | `--color-border`                                     | Eliminar el fallback hexadecimal                                                          |
| `apps/web/components/dashboard/cashflow-chart.tsx:85`                                                            | `var(--color-text-muted, #55606f)` | `--color-text-muted`                                 | Eliminar el fallback hexadecimal                                                          |
| `apps/web/components/dashboard/cashflow-chart.tsx:95`                                                            | `var(--color-border, #c3ccd6)`     | `--color-border`                                     | Eliminar el fallback hexadecimal                                                          |
| `apps/web/components/dashboard/cashflow-chart.tsx:97`                                                            | `var(--color-text-muted, #55606f)` | `--color-text-muted`                                 | Eliminar el fallback hexadecimal                                                          |
| `apps/web/components/dashboard/cashflow-chart.tsx:111`                                                           | `#047857`                          | `--color-income`                                     | Color de barra de ingresos                                                                |
| `apps/web/components/dashboard/cashflow-chart.tsx:118`                                                           | `#b91c1c`                          | `--color-expense`                                    | Color de barra de egresos                                                                 |
| `apps/web/components/dashboard/metrics-cards.tsx:83`                                                             | `text-[11px]`                      | `text-xs`                                            | Badge de tarjeta de métrica                                                               |
| `apps/web/app/globals.css`, `apps/web/lib/tokens.ts`                                                             | Renombrado aplicado                | `--color-on-primary` / `onPrimary`                   | Renombrado `primary-contrast` → `on-primary` aplicado en RD-02 (#91); sin alias restantes |
| `apps/mobile-android/feature/dashboard/src/main/java/com/mybusiness/feature/dashboard/ui/DashboardScreen.kt:250` | `Color(0xFF6EE7B7)`                | `MaterialTheme.colorScheme.secondary` / rol `income` | Hex literal en la pantalla                                                                |
| `apps/mobile-android/core/designsystem/src/main/java/com/mybusiness/core/designsystem/theme/Color.kt:41`         | `SuccessGreen = #10B981`           | Rol `income`                                         | Debe entrar al `ColorScheme` en RD-06                                                     |
| `apps/mobile-android/core/designsystem/src/main/java/com/mybusiness/core/designsystem/theme/Color.kt:42`         | `ErrorRed = #EF4444`               | Rol `expense`                                        | Usado como `error` en `Theme.kt:27` y `Theme.kt:44`; sin variante oscura                  |
| `apps/mobile-android/core/designsystem/src/main/java/com/mybusiness/core/designsystem/theme/Color.kt:43`         | `WarningAmber = #F59E0B`           | Rol `alert`                                          | Fuera del `ColorScheme`                                                                   |
| `apps/mobile-android/core/designsystem/src/main/java/com/mybusiness/core/designsystem/theme/Color.kt:44`         | `InfoBlue = #3B82F6`               | Rol `info` (nuevo, a definir)                        | Fuera del `ColorScheme`; no existe en web                                                 |

### Spacing fuera de escala (verificado en contexto)

| Archivo:línea                                                                                                    | Valor   | Token destino                     | Contexto                              |
| ---------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------- | ------------------------------------- |
| `apps/mobile-android/feature/dashboard/src/main/java/com/mybusiness/feature/dashboard/ui/DashboardScreen.kt:276` | `14.dp` | `space-3` o `space-4` (`12`/`16`) | `Modifier.padding` de tarjeta         |
| `apps/mobile-android/feature/dashboard/src/main/java/com/mybusiness/feature/dashboard/ui/DashboardScreen.kt:293` | `10.dp` | `space-2` (`8`)                   | `Spacer(width)` entre icono y columna |
| `apps/mobile-android/feature/dashboard/src/main/java/com/mybusiness/feature/dashboard/ui/DashboardScreen.kt:319` | `14.dp` | `space-3` o `space-4`             | `Modifier.padding` de tarjeta         |
| `apps/mobile-android/feature/dashboard/src/main/java/com/mybusiness/feature/dashboard/ui/DashboardScreen.kt:336` | `10.dp` | `space-2` (`8`)                   | `Spacer(width)` entre icono y columna |
| `apps/mobile-android/feature/dashboard/src/main/java/com/mybusiness/feature/dashboard/ui/DashboardScreen.kt:372` | `14.dp` | `space-3` o `space-4`             | `Modifier.padding` de tarjeta         |
| `apps/mobile-android/feature/dashboard/src/main/java/com/mybusiness/feature/dashboard/ui/DashboardScreen.kt:390` | `6.dp`  | `space-1` o `space-2` (`4`/`8`)   | `Spacer(height)` entre título y dato  |
| `apps/mobile-android/feature/auth/src/main/java/com/mybusiness/feature/auth/ui/LoginScreen.kt:200`               | `14.dp` | `space-3` o `space-4`             | `Modifier.padding` del bloque de demo |

### Dimensiones exentas (no son spacing)

| Archivo:línea                                                                                                        | Valor    | Motivo                                         |
| -------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------- |
| `apps/mobile-android/core/designsystem/src/main/java/com/mybusiness/core/designsystem/component/PrimaryButton.kt:27` | `52.dp`  | Altura de componente; cumple el target ≥ 48 dp |
| `apps/mobile-android/core/designsystem/src/main/java/com/mybusiness/core/designsystem/component/PrimaryButton.kt:39` | `2.5.dp` | Grosor de trazo del indicador de carga         |
| `apps/mobile-android/feature/dashboard/src/main/java/com/mybusiness/feature/dashboard/ui/DashboardScreen.kt:365`     | `220.dp` | Ancho de tarjeta en carrusel horizontal        |

### Otros literales tipográficos detectados

| Archivo:línea                                         | Valor          | Destino propuesto                                                         |
| ----------------------------------------------------- | -------------- | ------------------------------------------------------------------------- |
| `apps/web/components/dashboard/cashflow-chart.tsx:86` | `fontSize: 11` | `text-xs` (12 px) al migrar el gráfico a una primitiva con tokens (RD-04) |
| `apps/web/components/dashboard/cashflow-chart.tsx:98` | `fontSize: 11` | `text-xs` (12 px), misma migración                                        |

ECharts recibe números, no variables CSS, de modo que estos dos valores no pueden resolverse hoy con `var(--text-xs)`. Quedan registrados para RD-04.

## 13. Reglas de consumo

1. **Prohibido hex y literales de color en componentes.** Web usa `var(--token)`; Compose usa `MaterialTheme.colorScheme.*`. Los literales solo pueden existir en la capa global o en `Color.kt` como referencia.
2. **Solo se consumen tokens semánticos o de componente.** Un componente nunca referencia un valor de referencia ni un hexadecimal.
3. **Todo token nuevo se define en claro y oscuro en el mismo PR.** Sin excepciones. El script falla si una paleta no tiene los mismos roles que la otra.
4. **Estados no son marca.** `income`, `expense` y `alert` no se usan como decoración ni como color de marca. `primary` no sustituye a `income`.
5. **Un borde que delimita un control usa `border-strong`.** `border` queda para separadores decorativos.
6. **El foco usa `focus-ring`.** Nunca se elimina `outline` sin un sustituto visible.
7. **Spacing solo con la escala de §6.** Las dimensiones de componentes e iconos se documentan aparte y no se tokenizan como spacing.
8. **Movimiento solo con las duraciones y easings de §10**, respetando reduced motion.
9. **El alias del color de contraste de `primary` fue eliminado en RD-02 (#91).** Código nuevo y existente usa `--color-on-primary` (web) y `onPrimary` (Compose); `DESIGN-RULES` §3 fija `on-primary` como el único nombre canónico. No quedan alias ni nombres alternativos en el contrato.
10. **La elevación no sustituye al contraste.**
11. **`inverse` no es un fondo global.** Se usa solo en secciones invertidas; el fondo base siempre es `surface`. `accent` se reserva para realces y para texto sobre `inverse`, nunca como texto sobre `surface` claro.

## 14. Validación reproducible y criterios de aceptación

```bash
node scripts/design/check-contrast.mjs
pnpm lint
```

Resultado esperado del script: `OK: 54 pares de contraste cumplen los umbrales; 11 tokens de spacing, 5 radios y 3 duraciones de motion son coherentes.` con exit code `0`. Cualquier par por debajo del umbral, un spacing fuera de la escala, un radio inválido o una duración con formato incorrecto produce exit code `1` y un listado de fallos con tema, token, ratio y mínimo exigido.

El script:

- Lee `docs/design/tokens.json` con una ruta relativa al propio archivo, no a `process.cwd()`.
- Admite `#rgb` y `#rrggbb`; un color inválido produce error explícito.
- Calcula luminancia relativa y ratio según WCAG 2.1, redondeado a dos decimales.
- Valida los 27 pares por tema y exige paridad de roles entre `light` y `dark`.
- Valida la escala cerrada de spacing (`spacing.escala`): cada token debe pertenecer a la lista permitida, además de ser múltiplo de `allowedMultiplesOf`.
- No tiene dependencias externas.

### Criterios de aceptación del issue #90

- [x] `docs/design/tokens.md` documenta las tres capas con nombre, valor, rol y uso.
- [x] Todo par texto/fondo del contrato cumple 4.5:1 y todo borde/icono informativo 3:1 en claro y oscuro.
- [x] La escala de spacing es 4/8 y ningún token usa valores fuera de ella.
- [x] La tabla web ↔ Android mapea cada rol semántico a su equivalente en `core/designsystem`.
- [x] El inventario lista los hardcodes detectados con archivo y línea, y su token destino.
- [x] `check-contrast.mjs` falla con exit code distinto de 0 si un par incumple el umbral (verificado con una modificación temporal de `text` en claro).
- [x] `docs/design/tokens.json` es el contrato legible por máquina y el script lo consume sin transformaciones.
- [ ] `pnpm lint` en verde (lo ejecuta el orquestador antes del PR).
