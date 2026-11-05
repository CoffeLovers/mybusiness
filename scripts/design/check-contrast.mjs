#!/usr/bin/env node
/**
 * Valida el contrato de tokens de diseño (issue #90).
 *
 * Comprueba, para los temas light y dark:
 *   - Contraste WCAG 2.1 de los pares de texto (>= textMin) y de UI (>= uiMin).
 *   - Escala de spacing: enteros >= 0 multiplos de allowedMultiplesOf.
 *   - Radios: numeros >= 0.
 *   - Duraciones de motion: formato "<n>ms".
 *
 * Uso: node scripts/design/check-contrast.mjs
 * Exit code 0 si todo pasa; 1 si hay cualquier fallo.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR_SCRIPT = dirname(fileURLToPath(import.meta.url));
const RUTA_TOKENS = resolve(DIR_SCRIPT, '..', '..', 'docs', 'design', 'tokens.json');

const PATRON_HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const PATRON_DURACION = /^\d+ms$/;

/** Convierte `#rgb` o `#rrggbb` en canales [r, g, b] (0-255). */
function parseHex(hex) {
  if (typeof hex !== 'string' || !PATRON_HEX.test(hex)) {
    throw new Error(`Color hexadecimal invalido: "${hex}" (se esperaba #rgb o #rrggbb)`);
  }

  const digitos = hex.slice(1);
  const expandido =
    digitos.length === 3
      ? digitos
          .split('')
          .map((digito) => digito + digito)
          .join('')
      : digitos;

  const valor = Number.parseInt(expandido, 16);

  return [(valor >> 16) & 0xff, (valor >> 8) & 0xff, valor & 0xff];
}

/** Luminancia relativa segun WCAG 2.1. */
function luminanciaRelativa(hex) {
  const canales = parseHex(hex).map((canal) => {
    const normalizado = canal / 255;
    return normalizado <= 0.03928 ? normalizado / 12.92 : ((normalizado + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * canales[0] + 0.7152 * canales[1] + 0.0722 * canales[2];
}

/** Relacion de contraste WCAG 2.1 sin redondear: el redondeo se aplica solo al imprimir. */
function ratioContraste(a, b) {
  const lumA = luminanciaRelativa(a);
  const lumB = luminanciaRelativa(b);
  const claro = Math.max(lumA, lumB);
  const oscuro = Math.min(lumA, lumB);

  return (claro + 0.05) / (oscuro + 0.05);
}

function leerTokens() {
  let crudo;

  try {
    crudo = readFileSync(RUTA_TOKENS, 'utf8');
  } catch (error) {
    throw new Error(`No se pudo leer ${RUTA_TOKENS}: ${error.message}`);
  }

  // Tolerar BOM de editores en Windows.
  crudo = crudo.replace(/^\uFEFF/, '');

  try {
    return JSON.parse(crudo);
  } catch (error) {
    throw new Error(`tokens.json no es JSON valido: ${error.message}`);
  }
}

const fallos = [];

function registrarFallo(mensaje) {
  fallos.push(mensaje);
}

function rellenar(texto, ancho, alineacion = 'izquierda') {
  const cadena = String(texto);
  return alineacion === 'derecha' ? cadena.padStart(ancho) : cadena.padEnd(ancho);
}

function validarParidad(tokens) {
  const nombres = Object.keys(tokens.palettes ?? {});

  if (nombres.length === 0) {
    registrarFallo('palettes: no hay paletas definidas en tokens.json');
    return;
  }

  const referencia = Object.keys(tokens.palettes[nombres[0]]).sort();

  for (const nombre of nombres.slice(1)) {
    const actuales = Object.keys(tokens.palettes[nombre]).sort();
    const faltantes = referencia.filter((token) => !actuales.includes(token));
    const sobrantes = actuales.filter((token) => !referencia.includes(token));

    for (const token of faltantes) {
      registrarFallo(`${nombre}: falta el token "${token}" presente en ${nombres[0]}`);
    }
    for (const token of sobrantes) {
      registrarFallo(`${nombre}: token "${token}" ausente en ${nombres[0]}`);
    }
  }
}

function resolverColor(paleta, tema, nombre) {
  const valor = paleta[nombre];

  if (valor === undefined) {
    registrarFallo(`${tema}: el rol "${nombre}" no existe en la paleta`);
    return null;
  }

  try {
    parseHex(valor);
  } catch (error) {
    registrarFallo(`${tema}: rol "${nombre}" invalido (${error.message})`);
    return null;
  }

  return valor;
}

function validarContraste(tokens) {
  const configuracion = tokens.contrast ?? {};
  const minTexto = configuracion.textMin;
  const minUi = configuracion.uiMin;
  const paresTexto = Array.isArray(configuracion.text) ? configuracion.text : [];
  const paresUi = Array.isArray(configuracion.ui) ? configuracion.ui : [];

  if (typeof minTexto !== 'number' || typeof minUi !== 'number') {
    registrarFallo('contrast: textMin y uiMin deben ser numeros');
    return 0;
  }

  if (minTexto < 4.5) {
    registrarFallo('contrast.textMin no puede ser inferior a 4.5');
  }

  if (minUi < 3) {
    registrarFallo('contrast.uiMin no puede ser inferior a 3');
  }

  if (paresTexto.length === 0 || paresUi.length === 0) {
    registrarFallo('contrast: faltan pares en contrast.text o contrast.ui');
    return 0;
  }

  const resumen = [];
  let total = 0;

  for (const [tema, paleta] of Object.entries(tokens.palettes ?? {})) {
    console.log('');
    console.log(`Tema: ${tema} (texto >= ${minTexto}, UI >= ${minUi})`);
    console.log(
      `${rellenar('FG', 14)}${rellenar('BG', 18)}${rellenar('RATIO', 8, 'derecha')}${rellenar(
        'MINIMO',
        9,
        'derecha',
      )}  RESULTADO`,
    );
    console.log('-'.repeat(62));

    const grupos = [
      { tipo: 'texto', pares: paresTexto, minimo: minTexto },
      { tipo: 'UI', pares: paresUi, minimo: minUi },
    ];

    for (const grupo of grupos) {
      for (const par of grupo.pares) {
        const fg = par?.fg;
        const bg = par?.bg;

        if (typeof fg !== 'string' || typeof bg !== 'string') {
          registrarFallo(`${tema}: par ${grupo.tipo} sin fg/bg validos (${JSON.stringify(par)})`);
          continue;
        }

        const colorFg = resolverColor(paleta, tema, fg);
        const colorBg = resolverColor(paleta, tema, bg);

        if (colorFg === null || colorBg === null) {
          continue;
        }

        const ratio = ratioContraste(colorFg, colorBg);
        const cumple = ratio >= grupo.minimo;
        total += 1;

        console.log(
          `${rellenar(fg, 14)}${rellenar(bg, 18)}${rellenar(ratio.toFixed(2), 8, 'derecha')}${rellenar(
            grupo.minimo.toFixed(2),
            9,
            'derecha',
          )}  ${cumple ? 'PASS' : 'FAIL'}`,
        );

        if (!cumple) {
          registrarFallo(
            `${tema}: ${fg} sobre ${bg} (${grupo.tipo}) = ${ratio.toFixed(2)}:1, minimo ${grupo.minimo.toFixed(2)}:1`,
          );
        }
      }
    }

    resumen.push({ tema, pares: paresTexto.length + paresUi.length });
  }

  console.log('');
  for (const { tema, pares } of resumen) {
    console.log(`  ${tema}: ${pares} pares evaluados`);
  }

  return total;
}

function validarSpacing(tokens) {
  const spacing = tokens.spacing ?? {};
  const multiplo = spacing.allowedMultiplesOf;
  const base = spacing.base;
  const entradas = Object.entries(spacing.tokens ?? {});

  if (!Number.isInteger(multiplo) || multiplo <= 0) {
    registrarFallo('spacing: allowedMultiplesOf debe ser un entero positivo');
    return 0;
  }

  if (!Number.isInteger(base) || base <= 0) {
    registrarFallo('spacing: base debe ser un entero positivo');
  }

  const escala = spacing.escala;

  if (!Array.isArray(escala) || escala.length === 0) {
    registrarFallo('spacing.escala: debe ser un array no vacio de enteros positivos');
    return 0;
  }

  const escalaInvalida = escala.filter((valor) => !Number.isInteger(valor) || valor <= 0);

  if (escalaInvalida.length > 0) {
    registrarFallo(
      `spacing.escala: valores invalidos [${escalaInvalida.join(', ')}] (se esperaban enteros positivos)`,
    );
    return 0;
  }

  if (entradas.length === 0) {
    registrarFallo('spacing: no hay tokens definidos');
    return 0;
  }

  for (const [nombre, valor] of entradas) {
    if (!Number.isInteger(valor) || valor < 0) {
      registrarFallo(`spacing: ${nombre} debe ser un entero >= 0 (recibido ${valor})`);
      continue;
    }

    if (valor % multiplo !== 0) {
      registrarFallo(`spacing: ${nombre} = ${valor} no es multiplo de ${multiplo}`);
    }

    if (!escala.includes(valor)) {
      registrarFallo(
        `spacing: ${nombre} = ${valor} no pertenece a la escala permitida [${escala.join(', ')}]`,
      );
    }
  }

  return entradas.length;
}

function validarRadios(tokens) {
  const radios = Object.entries(tokens.radii ?? {});

  if (radios.length === 0) {
    registrarFallo('radii: no hay radios definidos');
    return 0;
  }

  for (const [nombre, valor] of radios) {
    if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0) {
      registrarFallo(`radii: ${nombre} debe ser un numero >= 0 (recibido ${valor})`);
    }
  }

  return radios.length;
}

function validarMotion(tokens) {
  const duraciones = Object.entries(tokens.motion?.duration ?? {});

  if (duraciones.length === 0) {
    registrarFallo('motion.duration: no hay duraciones definidas');
    return 0;
  }

  for (const [nombre, valor] of duraciones) {
    if (typeof valor !== 'string' || !PATRON_DURACION.test(valor)) {
      registrarFallo(`motion.duration: ${nombre} debe tener formato "<n>ms" (recibido ${valor})`);
    }
  }

  return duraciones.length;
}

function main() {
  const tokens = leerTokens();

  console.log(
    `Contrato de tokens — version ${tokens.version ?? '?'} (issue ${tokens.issue ?? '?'})`,
  );
  console.log(`Fuente: ${RUTA_TOKENS}`);

  validarParidad(tokens);
  const pares = validarContraste(tokens);
  const spacing = validarSpacing(tokens);
  const radios = validarRadios(tokens);
  const duraciones = validarMotion(tokens);

  console.log('');

  if (fallos.length > 0) {
    console.log(`FALLOS (${fallos.length}):`);
    for (const fallo of fallos) {
      console.log(`  - ${fallo}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `OK: ${pares} pares de contraste cumplen los umbrales; ${spacing} tokens de spacing, ${radios} radios y ${duraciones} duraciones de motion son coherentes.`,
  );
  process.exitCode = 0;
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
