'use client';

import { useEffect, useState } from 'react';

import { Skeleton } from './skeleton';

export interface DelayedSkeletonProps {
  /** Retardo en milisegundos antes de mostrar el bloque visual. */
  delayMs?: number;
  /** Texto accesible anunciado por lectores de pantalla. */
  label?: string;
}

/**
 * Skeleton con retardo para evitar parpadeos en cargas rápidas.
 *
 * El contenedor `role="status"` con el texto `sr-only` se renderiza desde el
 * primer instante (también en el servidor), de modo que no hay desajuste de
 * hidratación. El bloque decorativo solo aparece una vez transcurrido
 * `delayMs`; si la carga termina antes, el componente se desmonta sin brillo
 * fugaz.
 */
export function DelayedSkeleton({ delayMs = 300, label = 'Cargando…' }: DelayedSkeletonProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (delayMs <= 0) {
      setVisible(true);

      return;
    }

    const timer = window.setTimeout(() => {
      setVisible(true);
    }, delayMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [delayMs]);

  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">{label}</span>
      {visible ? (
        <Skeleton
          lines={3}
          data-testid="delayed-skeleton"
          // Alturas y separación del bloque decorativo, aplicadas sobre las
          // líneas que genera la primitiva Skeleton.
          className="gap-4 [&>div]:h-24 [&>div]:w-full [&>div:first-child]:h-8 [&>div:first-child]:w-48"
        />
      ) : null}
    </div>
  );
}
