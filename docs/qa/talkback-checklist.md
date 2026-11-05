# Checklist TalkBack — Android

Verificación manual de accesibilidad con **TalkBack** sobre la app Android de `mybusiness`.
Complementa las comprobaciones automatizadas descritas en
[`accessibility-visual-regression.md`](./accessibility-visual-regression.md).

> **Estado inicial: Pendiente de ejecución manual en emulador/dispositivo. No firmar sin evidencia.**

## Datos de la ejecución

| Campo                  | Valor |
| :--------------------- | :---- |
| Fecha                  |       |
| Persona                |       |
| Dispositivo / emulador |       |
| Versión Android        |       |
| Versión TalkBack       |       |
| Build / commit         |       |

## Cómo ejecutar

1. Activar TalkBack: **Ajustes → Accesibilidad → TalkBack → Usar TalkBack**.
2. Recorrer cada pantalla con swipe derecha (siguiente) e izquierda (anterior).
3. Registrar hallazgos por pantalla en la tabla de firma final.
4. Adjuntar evidencia (captura de vídeo o logs de TalkBack) al ticket antes de firmar.

## Criterios evaluados (aplican a cada pantalla)

- **Foco inicial**: al abrir la pantalla, el foco cae en un elemento relevante (título o primer
  control), nunca en un contenedor vacío.
- **Orden de lectura**: sigue el orden visual y lógico (cabecera → contenido → acciones).
- **Nombre accesible**: todo control (botón, campo, icono, imagen) anuncia un nombre comprensible;
  nada se anuncia como "sin etiqueta" o "botón" a secas.
- **Roles y anuncios**: los roles (`botón`, `campo de edición`, `pestaña`) y estados
  (seleccionado, deshabilitado, expandido) se anuncian correctamente.
- **Acciones disponibles**: TalkBack anuncia las acciones posibles y los gestos de deslizamiento
  funcionan (p. ej. activar, desplazar, ajustar).
- **Mensajes de error**: los errores de formulario y validación se anuncian automáticamente
  (live region / `announceForAccessibility`), no solo cambian de color.
- **Targets táctiles ≥ 48dp**: todos los controles tocables cumplen el mínimo de 48x48dp.
- **Contraste**: texto y elementos de interfaz cumplen contraste AA (4.5:1 texto normal,
  3:1 texto grande y componentes).
- **Rotación**: la pantalla mantiene foco, orden de lectura y contenido al rotar (vertical/horizontal).
- **Escala de fuente**: con fuente del sistema al 200 %, no hay texto truncado ni controles
  inalcanzables.

## Pantallas

### 1. Login

- [ ] Foco inicial en el título o primer campo.
- [ ] Orden de lectura: título → email → contraseña → botón de acceso.
- [ ] Campos anuncian nombre, tipo y estado (vacío/relleno).
- [ ] Botón de acceso anuncia nombre y rol.
- [ ] Errores de credenciales inválidas o campos vacíos se anuncian.
- [ ] Targets ≥ 48dp (campos, botón, enlaces auxiliares).
- [ ] Contraste AA en textos, placeholders y borde de campos.
- [ ] Rotación sin pérdida de foco ni contenido.
- [ ] Fuente al 200 % sin truncamientos.

### 2. Resumen

- [ ] Foco inicial en el título del resumen.
- [ ] Orden de lectura: título → filtros → tarjetas de métricas.
- [ ] Cada tarjeta de métrica anuncia etiqueta y valor de forma conjunta.
- [ ] Selectores de rango y moneda anuncian nombre, valor actual y rol.
- [ ] Estado de carga y de "sin datos" se anuncian.
- [ ] Errores de carga se anuncian.
- [ ] Targets ≥ 48dp en filtros y acciones.
- [ ] Contraste AA en valores, etiquetas y estados.
- [ ] Rotación conserva orden y foco.
- [ ] Fuente al 200 % sin solapamientos.

### 3. Libro mayor

- [ ] Foco inicial en el título del libro mayor.
- [ ] Orden de lectura: título → filtros → listado de movimientos.
- [ ] Cada fila anuncia fecha, descripción e importe en un único foco coherente.
- [ ] Cabeceras de columna anuncian su rol.
- [ ] Acciones por fila (si existen) anuncian nombre y acción.
- [ ] Estado vacío y errores se anuncian.
- [ ] Targets ≥ 48dp en filas accionables y botones.
- [ ] Contraste AA en importes (positivo/negativo) y textos secundarios.
- [ ] Rotación sin pérdida de contexto.
- [ ] Fuente al 200 % sin truncar importes.

### 4. Navegación / drawer

- [ ] Al abrir el drawer, el foco se mueve a su interior y se anuncia como menú/diálogo.
- [ ] Orden de lectura de los ítems coincide con el orden visible.
- [ ] El ítem activo se anuncia como seleccionado.
- [ ] Botón de apertura/cierre anuncia nombre, rol y estado expandido/contraído.
- [ ] Gestos de TalkBack para cerrar el drawer funcionan (acción de descartar).
- [ ] Al cerrar, el foco vuelve al control que abrió el drawer.
- [ ] Targets ≥ 48dp en cada ítem del menú.
- [ ] Contraste AA en ítems, iconos y separadores.
- [ ] Rotación mantiene el drawer usable o cerrado de forma consistente.
- [ ] Fuente al 200 % sin cortar etiquetas de los ítems.

## Firma

| Fecha | Persona | Build | Resultado | Notas |
| :---- | :------ | :---- | :-------- | :---- |
|       |         |       |           |       |
|       |         |       |           |       |
|       |         |       |           |       |

**Resultado**: `OK` · `OK con observaciones` · `Bloqueado`.

> **Nota:** este checklist **no puede marcarse como completado desde la web**. Requiere ejecución en
> un dispositivo o emulador Android real con TalkBack activo y evidencia adjunta al ticket.
