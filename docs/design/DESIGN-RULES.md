# Reglas de diseño — MyBusiness

> Documento vinculante. Todo PR que modifique UI en `apps/web` o `apps/mobile-android` debe cumplirlo.

## 1. Propósito y alcance

Estas reglas aplican a **cualquier cambio visible de interfaz** en:

- `apps/web` (App Router, Tailwind v4, tokens en `apps/web/app/globals.css`).
- `apps/mobile-android` (Jetpack Compose, Material 3, `core/designsystem`).

Alcance excluye lógica de negocio, contratos de API y contenido de correos.

### Fuente de verdad

La doctrina vive en el LLM Wiki; este documento es su **adaptación operativa** al producto financiero. Ante conflicto, gana el wiki y se actualiza este archivo.

| Nota del wiki                                     | Ruta                                              |
| ------------------------------------------------- | ------------------------------------------------- |
| Principios base y DoD web                         | `~/wiki/patterns/web-design-core-principles.md`   |
| Jerarquía de tokens                               | `~/wiki/concepts/design-tokens-and-systems.md`    |
| Norman: significantes, feedback, errores          | `~/wiki/concepts/human-centered-design-norman.md` |
| Leyes de UX (Fitts, Hick, Jakob, Miller, Doherty) | `~/wiki/concepts/laws-of-ux.md`                   |
| Heurísticas de Nielsen                            | `~/wiki/concepts/ten-usability-heuristics.md`     |
| Krug: escaneo, trunk test, billboard design       | `~/wiki/concepts/web-usability-krug.md`           |
| Anti-slop (texto de relleno, ruido visual)        | `~/wiki/patterns/anti-slop-guidelines.md`         |
| WCAG (referencia de contraste y foco)             | `~/wiki/concepts/wcag-accessibility.md`           |

---

## 2. Principios rectores

Cada principio declara una **regla** y su **verificación**. Si no se puede verificar, no es una regla: es una opinión.

### P1 — Cero fricción cognitiva (Krug)

**Regla:** toda pantalla es autoevidente. Los usuarios escanean, no leen: títulos explícitos, agrupación visual y una acción razonable disponible de inmediato. Prohibido el texto de bienvenida y cualquier párrafo explicativo que no responda a una tarea.

**Verificación:** test de 5 segundos con 3 personas sobre la pantalla real; si alguna no puede decir qué hace la página y cuál es la acción principal, se rediseña.

### P2 — Significantes y feedback inmediato (Norman)

**Regla:** lo clicable parece clicable (borde, fondo, relieve o subrayado). Toda interacción acusa recibo visual en menos de 100 ms (`:active`, `aria-busy`, state hoisting). Ninguna acción queda sin respuesta perceptible.

**Verificación:** inspección de estados `hover`/`focus`/`active`/`disabled`/`loading` en el componente; el botón cambia de estado antes de que la promesa se resuelva.

### P3 — Jerarquía señal/ruido

**Regla:** máximo 3 niveles de jerarquía por vista (primario, secundario, terciario). Un único CTA primario. Se elimina cualquier divisor, borde o badge que no transporte información.

**Verificación:** captura en escala de grises: debe seguir siendo legible qué es lo principal.

### P4 — Trunk test (Krug)

**Regla:** desde cualquier subpágina el usuario identifica en 5 segundos: qué sitio es, en qué página está, qué secciones existen, dónde está en la jerarquía y cómo buscar.

**Verificación:** checklist de la sección 5, firmado en el PR.

### P5 — Fitts + Hick + revelación progresiva

**Regla:** los objetivos frecuentes son grandes y cercanos; las opciones poco frecuentes se esconden tras "Opciones avanzadas" o pestañas. Formularios largos se parten en pasos con progreso visible.

**Verificación:** medición de targets (sección 4) y conteo de acciones visibles por vista (≤ 7 decisiones simultáneas).

### P6 — Tolerancia a errores y undo

**Regla:** `Undo` en lugar de modales de confirmación para acciones reversibles; confirmación explícita solo para irreversibles. Nunca se borran datos ya ingresados al fallar una validación. Los errores explican **qué pasó** y **qué hacer**, en lenguaje humano.

**Verificación:** prueba manual de fallo forzado (red caída, 422 del gateway): los campos conservan su valor y el mensaje no expone códigos internos.

### P7 — Accesibilidad AA como mínimo

**Regla:** WCAG 2.1 AA obligatorio: contraste, foco visible, navegación completa por teclado, nombres accesibles en iconos, `aria-live` para cambios asíncronos.

**Verificación:** `axe` sin violaciones críticas/serias + recorrido completo con teclado + TalkBack en Android.

### P8 — Anti-slop

**Regla:** cero texto de relleno, cero gradientes decorativos, cero iconos sin etiqueta cuando la acción es destructiva o ambigua, cero emojis en superficies financieras, cero microcopy motivacional.

**Verificación:** revisión cruzada en el PR contra `~/wiki/patterns/anti-slop-guidelines.md`; cualquier texto que no aporte información se elimina.

---

## 3. Tokens

### Jerarquía obligatoria

1. **Global / referencia** — valores brutos: `--color-blue-600`, `--space-4`, `--radius-md`. Sin contexto de uso.
2. **Semántico / sistema** — decisiones con significado: `--color-surface`, `--color-text-muted`, `--color-expense`.
3. **Componente** — asignación local: `--button-primary-background: var(--color-primary)`.

Los componentes **solo** consumen nivel 2 o 3. Nunca nivel 1, nunca literales.

### Roles obligatorios

| Rol              | Uso                                                  |
| ---------------- | ---------------------------------------------------- |
| `surface`        | fondo base de la vista                               |
| `surface-raised` | tarjetas, tablas, paneles                            |
| `border`         | separadores y contornos (decorativo, no informativo) |
| `text`           | texto primario                                       |
| `text-muted`     | metadatos, ayudas, placeholders                      |
| `primary`        | acción primaria, enlaces, foco                       |
| `on-primary`     | texto/icono sobre `primary`                          |
| `income`         | entradas de dinero                                   |
| `expense`        | salidas de dinero                                    |
| `neutral`        | importes sin signo, estados neutros                  |
| `alert`          | advertencia y error de estado                        |
| `focus-ring`     | anillo de foco (≥ 3:1 contra superficies adyacentes) |

> En web el token de texto sobre primary es on-primary (clase text-on-primary); el alias primary-contrast se eliminó en RD-02 (#91). En Android ya existe onPrimary.

### Reglas duras

- **Prohibido hex en componentes.** Solo `var(--token)` en web y `MaterialTheme.colorScheme.*` en Compose.
- **Paridad claro/oscuro.** Todo token nuevo se define en ambos temas en el mismo PR. Sin excepciones.
- **Estados no son marca.** `error`, `success`, `warning` no se reutilizan como color de marca ni como decoración.
- **Importes**: siempre `*Minor` (enteros en unidades mínimas) formateados con el formateador existente (`formatMinorUnitsString` en web, equivalente en Android). Prohibido `parseFloat`/`Double` para dinero.
- **Tipografía y espaciado**: escala única y compartida. Web ya define ratio 1.25 y `--spacing: 0.25rem`; Android debe derivar de la misma escala (RD-06), no de valores ad hoc.

---

## 4. Reglas medibles

| Regla                                                                                                      | Web                                                                | Android                                      | Verificación                                                           |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------- | ---------------------------------------------------------------------- |
| Contraste texto normal ≥ 4.5:1                                                                             | obligatorio en ambos temas                                         | obligatorio en ambos temas                   | `axe` + script de contraste en CI; tabla de ratios en el PR            |
| Contraste texto grande y componentes UI ≥ 3:1                                                              | obligatorio                                                        | obligatorio                                  | mismo script; cubre iconos y bordes informativos                       |
| Anillo de foco ≥ 3:1 contra el fondo adyacente                                                             | obligatorio, `:focus-visible`, nunca `outline: none` sin reemplazo | obligatorio (indicator Compose)              | inspección + captura con foco                                          |
| Target táctil ≥ 44×44 px                                                                                   | botones, enlaces de icono, celdas de acción                        | ≥ 48×48 dp                                   | medición en DevTools / Layout Inspector; test de tamaño en componentes |
| Separación entre targets ≥ 8 px                                                                            | obligatorio                                                        | ≥ 8 dp                                       | inspección                                                             |
| Feedback visual < 100 ms                                                                                   | obligatorio                                                        | obligatorio                                  | revisión de estados; sin esperas bloqueantes al click                  |
| Skeleton si la operación supera 300 ms                                                                     | obligatorio                                                        | obligatorio                                  | prueba con red lenta (throttling 3G)                                   |
| Sin pantallas estáticas durante carga                                                                      | obligatorio                                                        | obligatorio                                  | idem                                                                   |
| Animaciones 150–300 ms, `ease-out` al entrar, `ease-in` al salir                                           | obligatorio                                                        | obligatorio (`tween` con easing equivalente) | revisión de duraciones en tokens de motion                             |
| `prefers-reduced-motion: reduce` desactiva transformaciones y parallax                                     | obligatorio                                                        | respetar escala de animación del sistema     | emulación del media query / ajustes de accesibilidad                   |
| Un solo CTA primario por vista                                                                             | obligatorio                                                        | obligatorio                                  | revisión visual                                                        |
| Máximo 3 niveles de jerarquía                                                                              | obligatorio                                                        | obligatorio                                  | captura en grises                                                      |
| Sin saltos de encabezado (`h1` → `h2`)                                                                     | obligatorio                                                        | n/a                                          | `axe` regla `heading-order`                                            |
| Ancho de línea 60–75 caracteres                                                                            | obligatorio en texto corrido                                       | equivalente en párrafos                      | medición aproximada (`max-w-prose`)                                    |
| Texto de ayuda ≤ 2 líneas                                                                                  | obligatorio                                                        | obligatorio                                  | revisión de copy                                                       |
| Cero párrafos de relleno                                                                                   | obligatorio                                                        | obligatorio                                  | revisión cruzada                                                       |
| Validación inline junto al campo                                                                           | obligatorio                                                        | obligatorio                                  | prueba de envío inválido                                               |
| Conservar datos del formulario al fallar                                                                   | obligatorio                                                        | obligatorio                                  | prueba de fallo de red/422                                             |
| Errores en lenguaje humano con acción concreta                                                             | obligatorio                                                        | obligatorio                                  | revisión de copy                                                       |
| 5 estados por pantalla: `loading`, `empty`, `error`, `unauthorized`/sesión expirada, `success` transitorio | obligatorio                                                        | obligatorio                                  | checklist del PR con captura o test por estado                         |

### Notas de aplicación

- **Contraste**: `border` es decorativo y no cuenta como información; si un borde delimita un control, debe cumplir 3:1.
- **Foco**: el anillo se dibuja con `focus-ring`, no con `primary` genérico, para poder ajustarlo por superficie.
- **Movimiento**: las duraciones viven en tokens (`--duration-fast: 150ms`, `--duration-base: 200ms`, `--duration-slow: 300ms`), no en clases sueltas.

---

## 5. Navegación y estructura (trunk test)

Checklist obligatorio de toda vista:

- [ ] Logo en la esquina superior izquierda enlazando a `/`.
- [ ] Un único `h1` por página, descriptivo de la tarea (no del módulo interno).
- [ ] Migas de pan cuando la profundidad sea ≥ 2 (`Inicio > Libro mayor > Movimiento`).
- [ ] Ítem activo visible en la navegación global (`aria-current="page"` en web).
- [ ] Búsqueda visible o atajo de teclado documentado.
- [ ] Skip link ("Saltar al contenido") como primer elemento enfocable.
- [ ] Foco visible y orden de tabulación que sigue el orden visual.
- [ ] Navegación operable a 320 px de ancho (drawer colapsable, sin scroll horizontal).

---

## 6. Tablas densas y datos

Aplicable al libro mayor y a cualquier listado financiero.

- **Densidad** conmutable: `cómoda` (por defecto, 48 px de alto de fila en web / 56 dp en Android) y `compacta` (36 px / 48 dp), persistida por usuario.
- **Cabecera sticky** con `scope="col"`; la primera columna (fecha o nombre) también puede ser sticky en scroll horizontal.
- **Columnas prioritarias**: fecha, descripción, importe, estado. El resto se oculta en viewport estrecho antes de provocar scroll horizontal.
- **Alineación numérica a la derecha** con `font-variant-numeric: tabular-nums` (web) y `FontFeatureSetting("tnum")` (Compose). Los importes nunca se centran.
- **Selección múltiple** con barra de acciones persistente que indica el número de filas seleccionadas y ofrece la acción masiva; la barra no tapa la última fila.
- **Edición inline** con confirmación visual inmediata (check + cambio de color), `Esc` cancela, `Enter` confirma, y `rollback` explícito con anuncio `aria-live` si la mutación falla.
- **Orden y paginación** anunciados (`aria-sort`, texto "Página 3 de 12"); nunca solo iconos sin nombre accesible.

---

## 7. Definición de Terminado (DoD de diseño)

Adaptado de `~/wiki/patterns/web-design-core-principles.md` §7. Los 12 puntos son obligatorios:

- [ ] **1. Trunk test aprobado**: logo, `h1`, ubicación y navegación evidentes.
- [ ] **2. Un único CTA primario** visualmente dominante por vista.
- [ ] **3. Targets ≥ 44×44 px (web) / ≥ 48×48 dp (Android)** con separación ≥ 8 px.
- [ ] **4. Feedback inmediato**: `hover`, `focus-visible`, `active`, `disabled` y `loading` consistentes.
- [ ] **5. Los 5 estados presentes**: `loading`, `empty`, `error`, `unauthorized`/sesión expirada, `success` transitorio.
- [ ] **6. Empty state accionable**: explica por qué no hay datos y ofrece el siguiente paso.
- [ ] **7. Validación inline y persistencia de datos** al fallar.
- [ ] **8. Cero texto superfluo**: sin introducciones vacías ni párrafos de relleno.
- [ ] **9. Contraste verificado**: ≥ 4.5:1 texto normal, ≥ 3:1 grande/UI/foco, en claro y oscuro.
- [ ] **10. Teclado completo**: recorrido sin ratón, foco visible, sin trampas de foco; `axe` sin violaciones críticas.
- [ ] **11. TalkBack (Android)**: cada control tiene nombre accesible y orden de lectura coherente.
- [ ] **12. Captura antes/después** en claro y oscuro, y en móvil cuando aplique.

---

## 8. Proceso de revisión

Un PR de UI **no se mergea** sin:

1. Capturas **antes/después** en tema claro y oscuro.
2. Captura en viewport móvil (375 px) y, en Android, captura de la pantalla afectada.
3. Resultado de `axe` (o del job de CI equivalente) sin violaciones críticas ni serias.
4. Resultado del script de contraste para los pares nuevos o modificados.
5. Checklist de la sección 7 **firmado en la descripción del PR**, punto por punto.

Sin checklist firmado, el revisor solicita cambios aunque el código sea correcto. La revisión cruzada de UI la realiza una persona distinta del autor (ver gobernanza en `REDESIGN-PLAN.md`).

Cualquier regla nueva se propone primero en el LLM Wiki; una vez aceptada, se incorpora aquí en el mismo sprint.
