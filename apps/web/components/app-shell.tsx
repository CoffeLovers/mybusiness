'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { MobileDrawer } from '@/components/shell/mobile-drawer';
import {
  buildCrumbs,
  getActiveHref,
  NAV_ITEMS,
  navDisabledItemClasses,
  navLinkClasses,
} from '@/components/shell/nav-config';
import { SearchPalette } from '@/components/shell/search-palette';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui';

export type ShellUser = {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
};

/** Cookie CSRF de doble envío (la única legible por el cliente). */
const CSRF_COOKIE = 'mb_csrf';

/** Lee una cookie no httpOnly; `undefined` si no existe o está vacía. */
function readCookie(name: string): string | undefined {
  const prefix = `${name}=`;
  const entry = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));

  if (entry === undefined) {
    return undefined;
  }

  const rawValue = entry.slice(prefix.length);

  if (rawValue.length === 0) {
    return undefined;
  }

  try {
    return decodeURIComponent(rawValue);
  } catch {
    return undefined;
  }
}

async function logout(): Promise<void> {
  try {
    const csrfToken = readCookie(CSRF_COOKIE);

    await fetch('/api/session/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: csrfToken === undefined ? {} : { 'x-csrf-token': csrfToken },
    });
  } catch {
    // La sesión local se limpia igualmente al navegar al login.
  }

  window.location.assign('/login');
}

/** Wordmark con nombre accesible explícito; siempre vuelve al resumen. */
function BrandLink() {
  return (
    <Link
      href="/"
      aria-label="MyBusiness, ir al resumen"
      className="inline-flex min-h-11 items-center rounded-md px-2 font-mono text-xs tracking-widest text-text-muted uppercase transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
    >
      mybusiness
    </Link>
  );
}

/** Navegación vertical del sidebar de escritorio. */
function NavLinks({ pathname }: { pathname: string }) {
  const activeHref = getActiveHref(pathname);

  return (
    <ul className="flex flex-col gap-2">
      {NAV_ITEMS.map((item) => {
        if (item.href === null) {
          return (
            <li key={item.id}>
              <span role="link" aria-disabled="true" className={navDisabledItemClasses()}>
                {item.label}
                <span className="sr-only"> (Próximamente)</span>
              </span>
            </li>
          );
        }

        const isCurrent = item.href === activeHref;

        return (
          <li key={item.id}>
            <Link
              href={item.href}
              aria-current={isCurrent ? 'page' : undefined}
              className={navLinkClasses(isCurrent)}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Migas derivadas de la ruta; la última es texto, las anteriores enlaces. */
function Breadcrumbs({ pathname }: { pathname: string }) {
  const crumbs = buildCrumbs(pathname);

  return (
    <nav
      aria-label="Ruta de navegación"
      className="order-last w-full min-w-0 md:order-none md:w-auto md:flex-1"
    >
      <ol className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;

          return (
            <li key={crumb.href} className="flex items-center gap-1">
              {isLast ? (
                <span aria-current="page" className="font-medium text-text">
                  {crumb.label}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className="inline-flex min-h-11 items-center rounded-sm px-1 underline underline-offset-4 transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                >
                  {crumb.label}
                </Link>
              )}
              {isLast ? null : (
                <span aria-hidden="true" className="px-1">
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function AppShell({ children, user }: { children: ReactNode; user?: ShellUser }) {
  const pathname = usePathname();

  const handleLogout = () => {
    void logout();
  };

  return (
    <div className="min-h-screen bg-surface">
      <a
        href="#contenido"
        onClick={() => {
          document.getElementById('contenido')?.focus();
        }}
        className="sr-only rounded-md border border-border-strong bg-surface-raised px-4 py-2 text-sm font-medium text-text focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:inline-flex focus:min-h-11 focus:items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        Saltar al contenido
      </a>

      <aside className="hidden border-r border-border bg-surface-raised md:fixed md:inset-y-0 md:left-0 md:flex md:w-60 md:flex-col md:gap-6 md:px-4 md:py-6">
        <BrandLink />
        <nav aria-label="Navegación principal" className="flex-1">
          <NavLinks pathname={pathname} />
        </nav>
        {user === undefined ? null : (
          <div className="border-t border-border pt-4">
            <p className="px-3 text-sm leading-tight">
              <span className="block font-medium text-text">
                {user.firstName} {user.lastName}
              </span>
              <span className="block text-xs text-text-muted">{user.role}</span>
            </p>
          </div>
        )}
      </aside>

      <div className="flex min-h-screen flex-col md:pl-60">
        <header className="sticky top-0 z-10 border-b border-border bg-surface">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 md:flex-nowrap md:px-6">
            <div className="flex items-center gap-2 md:hidden">
              <BrandLink />
              <MobileDrawer pathname={pathname} onLogout={handleLogout} />
            </div>

            <Breadcrumbs pathname={pathname} />

            <div className="ml-auto flex shrink-0 items-center gap-2">
              <SearchPalette />
              <ThemeToggle />
              {user === undefined ? null : (
                <p className="hidden text-right text-sm leading-tight md:block">
                  <span className="block font-medium text-text">{user.firstName}</span>
                  <span className="block text-xs text-text-muted">{user.role}</span>
                </p>
              )}
              <Button variant="secondary" onClick={handleLogout} className="hidden md:inline-flex">
                Cerrar sesión
              </Button>
            </div>
          </div>
        </header>

        <main id="contenido" tabIndex={-1} className="flex-1 px-4 py-6 md:px-6 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
