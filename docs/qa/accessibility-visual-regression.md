# Accesibilidad y Regresión Visual (RD-08)

Documento de referencia para las verificaciones de accesibilidad y de regresión visual de la
aplicación web (`@mybusiness/web`). Forma parte del trabajo de la issue **RD-08**.

---

## 1. Alcance

La estrategia cubre cuatro frentes complementarios:

| Frente              | Herramienta                            | Automatizado | Dónde se ejecuta                     |
| :------------------ | :------------------------------------- | :----------- | :----------------------------------- |
| Accesibilidad (axe) | `@axe-core/playwright` (WCAG 2.1 A/AA) | Sí           | `apps/web/e2e/accessibility.spec.ts` |
| Contraste de color  | `scripts/design/check-contrast.mjs`    | Sí           | Raíz del monorepo                    |
| Regresión visual    | Playwright `toHaveScreenshot()`        | Sí           | `apps/web/e2e/visual.spec.ts`        |
| Lector de pantalla  | TalkBack (Android)                     | No (manual)  | `docs/qa/talkback-checklist.md`      |

> El análisis de axe se limita a violaciones de impacto `critical` y `serious` para no bloquear la
> entrega por hallazgos de severidad menor, que se revisan en el checklist manual.

---

## 2. Rutas cubiertas por axe

El spec `apps/web/e2e/accessibility.spec.ts` analiza las siguientes rutas con las etiquetas
`wcag2a`, `wcag2aa`, `wcag21a` y `wcag21aa`:

**Rutas públicas (sin sesión):**

- `/` — landing pública.
- `/login` — inicio de sesión.
- `/design-system` — catálogo del sistema de diseño.
- `/ruta-inexistente` — página 404 (`not-found`).

**Rutas autenticadas (tras login con el mock gateway):**

- `/resumen?from=2026-10-01&to=2026-10-31&currency=EUR` — dashboard con rango y moneda explícitos.
- `/libro-mayor` — libro mayor.

**Tema oscuro:**

- `/` y `/resumen` se analizan de nuevo con `localStorage.theme = 'dark'`, verificando que
  `<html>` lleve la clase `dark` y que no aparezcan violaciones bloqueantes.

Cada test verifica primero que exista un `h1` visible, lo que garantiza que la página terminó de
cargar antes de ejecutar el análisis.

---

## 3. Comandos locales

```bash
# Solo accesibilidad (axe)
pnpm --filter @mybusiness/web test:a11y

# Regresión visual: comparación contra los baselines
pnpm --filter @mybusiness/web test:visual

# Regresión visual: regenerar los baselines
pnpm --filter @mybusiness/web test:visual:update

# Contraste de color de los tokens del sistema de diseño
pnpm test:contrast

# Suite E2E completa de la web (incluye a11y y visual)
pnpm --filter @mybusiness/web test
```

---

## 4. Política de baselines visuales

- Los baselines se generan **en Linux** con el **Chromium de Playwright** (`playwright install
--with-deps chromium`). Diferencias de sistema operativo, motor de fuentes o versión de Chromium
  producen falsos positivos, por lo que **no** deben generarse en macOS ni Windows.
- Se actualizan **solo** con `test:visual:update`, y siempre revisando el diff antes de commitear.
- El umbral previsto de tolerancia es **1 %** (`maxDiffPixelRatio: 0.01`), suficiente para absorber
  ruido de antialiasing sin ocultar cambios reales de layout.
- En CI, los diffs (imágenes esperada / actual / diff) se publican como **artefacto** del job para
  facilitar la revisión.

---

## 5. CI

El workflow `.github/workflows/web-ci.yml` ejecuta las siguientes piezas:

- Job **`Accessibility (axe)`** (`a11y`): corre `e2e/accessibility.spec.ts` contra el Chromium de
  Playwright y publica `web-a11y-report` (informe HTML) y `web-a11y-results` (resultados de test).
- Paso **`Design token contrast`** dentro del job `quality`: ejecuta `pnpm test:contrast`, de modo
  que un token con contraste insuficiente rompe la build antes de los tests de tipo y unidad.
- Artefacto **`web-visual-diffs`** en el job `e2e`: cuando falla la comparación visual se suben
  `*-diff.png`, `*-actual.png` y `*-expected.png` para revisar la diferencia sin reejecutar en local.

Los cambios en `docs/design/**`, `scripts/**` y `.github/workflows/web-ci.yml` disparan el workflow
para que las verificaciones de tokens y contraste no queden sin ejecutar.

---

## 6. Firma TalkBack (manual)

La verificación con TalkBack es manual y se registra en
[`docs/qa/talkback-checklist.md`](./talkback-checklist.md). Ese checklist cubre Login, Resumen,
Libro mayor y la navegación/drawer (foco, orden de lectura, nombres accesibles, roles, errores
anunciados, targets ≥ 48dp, contraste, rotación y escala de fuente) y requiere firma con evidencia
en dispositivo o emulador Android real; no puede completarse desde la web. Hasta que se firme, axe
y los tests de contraste son la única cobertura automatizada de accesibilidad.
