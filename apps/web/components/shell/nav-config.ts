/**
 * Configuración compartida de la navegación del shell (RD-03, #92).
 *
 * Los ítems sin ruta (`href: null`) representan secciones aún no disponibles:
 * se renderizan deshabilitados y nunca reciben `aria-current` ni entran en la
 * paleta de búsqueda.
 */

export type NavItem = {
  id: string;
  label: string;
  href: string | null;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'resumen', label: 'Resumen', href: '/' },
  { id: 'libro-mayor', label: 'Libro mayor', href: '/libro-mayor' },
  { id: 'facturas', label: 'Facturas', href: null },
  { id: 'bancos', label: 'Bancos', href: null },
  { id: 'agente', label: 'Agente', href: null },
];

export type LinkedNavItem = NavItem & { href: string };

/** Ítems navegables, la única fuente para la paleta de búsqueda. */
export const LINKED_NAV_ITEMS: readonly LinkedNavItem[] = NAV_ITEMS.filter(
  (item): item is LinkedNavItem => item.href !== null,
);

const SEGMENT_LABELS: Record<string, string> = {
  'libro-mayor': 'Libro mayor',
  movimientos: 'Movimientos',
  facturas: 'Facturas',
  bancos: 'Bancos',
  agente: 'Agente',
};

export type Crumb = {
  label: string;
  href: string;
};

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Etiqueta legible: mapa conocido o slug con guiones convertidos en espacios. */
export function readableSegment(segment: string): string {
  const decoded = decodeSegment(segment);
  const known = SEGMENT_LABELS[decoded];

  if (known !== undefined) {
    return known;
  }

  const spaced = decoded.replace(/-/g, ' ');

  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Migas derivadas de la ruta; la raíz siempre es "Resumen". */
export function buildCrumbs(pathname: string): readonly Crumb[] {
  const segments = pathname.split('/').filter((segment) => segment !== '');
  const crumbs: Crumb[] = [{ label: 'Resumen', href: '/' }];

  let accumulated = '';
  for (const segment of segments) {
    accumulated += `/${segment}`;
    crumbs.push({ label: readableSegment(segment), href: accumulated });
  }

  return crumbs;
}

/**
 * Mejor coincidencia por sección: `"/"` solo exacta y el resto por prefijo,
 * quedándose con el `href` más largo para no marcar dos ítems a la vez.
 */
export function getActiveHref(pathname: string): string | undefined {
  let best: string | undefined;

  for (const item of LINKED_NAV_ITEMS) {
    const { href } = item;
    const matches =
      href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

    if (matches && (best === undefined || href.length > best.length)) {
      best = href;
    }
  }

  return best;
}

/** Clases compartidas por los enlaces de navegación (sidebar y drawer). */
export function navLinkClasses(isCurrent: boolean): string {
  const base =
    'flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring';

  return isCurrent
    ? `${base} bg-surface text-text`
    : `${base} text-text-muted hover:bg-surface hover:text-text`;
}

/** Clases de los ítems sin ruta: visibles pero no interactivos. */
export function navDisabledItemClasses(): string {
  return 'flex min-h-11 cursor-not-allowed items-center rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap text-text-muted';
}
