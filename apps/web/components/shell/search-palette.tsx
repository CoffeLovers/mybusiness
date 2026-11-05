'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { Dialog, fieldControlClasses } from '@/components/ui';

import { LINKED_NAV_ITEMS, type LinkedNavItem } from './nav-config';

/** Campos donde `/` debe escribir en lugar de abrir la paleta. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable || target.closest('[contenteditable]') !== null) {
    return true;
  }

  const tag = target.tagName;

  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function matchesQuery(item: LinkedNavItem, query: string): boolean {
  if (query === '') {
    return true;
  }

  return item.label.toLocaleLowerCase('es').includes(query);
}

function SearchIcon() {
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
      <circle cx="9" cy="9" r="6" />
      <path d="M13.5 13.5L17 17" />
    </svg>
  );
}

/**
 * Paleta de búsqueda de navegación sin backend (RD-03, #92).
 *
 * Abre con `/` o `Ctrl+K`/`⌘K`, filtra los ítems con ruta y navega con
 * `useRouter().push`. `Dialog` reutilizado aporta el foco atrapado y `Escape`.
 */
export function SearchPalette() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const normalizedQuery = query.trim().toLocaleLowerCase('es');
  const results = LINKED_NAV_ITEMS.filter((item) => matchesQuery(item, normalizedQuery));
  const selectedIndex = results.length === 0 ? -1 : Math.min(activeIndex, results.length - 1);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      const isCommandKey = event.ctrlKey || event.metaKey;

      if (isCommandKey && event.key.toLocaleLowerCase('es') === 'k') {
        event.preventDefault();
        setQuery('');
        setActiveIndex(0);
        setOpen(true);
        return;
      }

      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
        return;
      }

      if (event.key !== '/' || isEditableTarget(event.target)) {
        return;
      }

      event.preventDefault();
      setQuery('');
      setActiveIndex(0);
      setOpen(true);
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    // `Dialog` enfoca su primer control (cerrar); el input debe recibir el foco.
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
  };

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      <button
        type="button"
        aria-label="Buscar"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Buscar (atajo: / o Ctrl+K)"
        onClick={() => {
          setQuery('');
          setActiveIndex(0);
          setOpen(true);
        }}
        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md border border-border-strong bg-surface px-3 text-sm font-medium text-text transition-colors hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        <SearchIcon />
        <span className="hidden sm:inline">Buscar</span>
        <kbd className="hidden rounded border border-border px-1 font-mono text-xs text-text-muted md:inline">
          /
        </kbd>
      </button>

      <Dialog open={open} onClose={close} title="Buscar">
        <div className="flex flex-col gap-3">
          <input
            ref={inputRef}
            type="search"
            value={query}
            aria-label="Buscar en la navegación"
            placeholder="Buscar sección"
            autoComplete="off"
            className={fieldControlClasses}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                close();
                return;
              }

              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((index) => Math.min(index + 1, results.length - 1));
                return;
              }

              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((index) => Math.max(index - 1, 0));
                return;
              }

              if (event.key === 'Enter') {
                event.preventDefault();
                const target = results[selectedIndex] ?? results[0];

                if (target !== undefined) {
                  go(target.href);
                }
              }
            }}
          />

          <p role="status" className="sr-only">
            {results.length === 0
              ? 'Sin resultados'
              : `${results.length} ${results.length === 1 ? 'resultado' : 'resultados'}`}
          </p>

          {results.length === 0 ? (
            <p className="py-2 text-sm text-text-muted">Sin resultados</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {results.map((item, index) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      go(item.href);
                    }}
                    onMouseEnter={() => {
                      setActiveIndex(index);
                    }}
                    className={`flex min-h-11 w-full items-center rounded-md px-3 text-left text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
                      index === selectedIndex
                        ? 'bg-surface-raised text-text'
                        : 'text-text-muted hover:bg-surface-raised hover:text-text'
                    }`}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Dialog>
    </>
  );
}
