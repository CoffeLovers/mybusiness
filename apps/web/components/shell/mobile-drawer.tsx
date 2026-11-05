'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Button, Dialog, IconButton } from '@/components/ui';

import { getActiveHref, NAV_ITEMS, navDisabledItemClasses, navLinkClasses } from './nav-config';

function MenuIcon() {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M3 5h14M3 10h14M3 15h14" />
    </svg>
  );
}

/**
 * Drawer de navegación para `<md`.
 *
 * `Dialog` aporta el foco atrapado, el cierre con `Escape` y el retorno del
 * foco al botón hamburguesa; aquí solo se gestiona el estado y la navegación.
 */
export function MobileDrawer({ pathname, onLogout }: { pathname: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const activeHref = getActiveHref(pathname);

  return (
    <>
      <IconButton
        label="Abrir navegación"
        variant="ghost"
        aria-expanded={open}
        aria-controls="mobile-nav-drawer"
        onClick={() => {
          setOpen(true);
        }}
      >
        <MenuIcon />
      </IconButton>

      <div id="mobile-nav-drawer">
        <Dialog
          open={open}
          onClose={() => {
            setOpen(false);
          }}
          title="Navegación"
        >
          <nav aria-label="Navegación principal">
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
                      onClick={() => {
                        setOpen(false);
                      }}
                      className={navLinkClasses(isCurrent)}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="mt-4 border-t border-border pt-4">
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
            >
              Cerrar sesión
            </Button>
          </div>
        </Dialog>
      </div>
    </>
  );
}
