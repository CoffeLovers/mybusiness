// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PREFERS_REDUCED_MOTION_QUERY,
  usePrefersReducedMotion,
} from '../../lib/use-prefers-reduced-motion';

type ChangeListener = (event: MediaQueryListEvent) => void;

interface MatchMediaHarness {
  /** Cambia `matches` y notifica a los listeners suscritos a `change`. */
  setMatches(next: boolean): void;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  addListener: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
}

let restoreMatchMedia: (() => void) | null = null;

/**
 * Instala un `window.matchMedia` falso que permite fijar `matches` y emitir
 * eventos `change`, además de exponer los espías de suscripción.
 */
function installMatchMedia(initialMatches: boolean): MatchMediaHarness {
  let matches = initialMatches;
  const listeners = new Set<ChangeListener>();

  const addEventListener = vi.fn((type: string, listener: ChangeListener) => {
    if (type === 'change') listeners.add(listener);
  });

  const removeEventListener = vi.fn((type: string, listener: ChangeListener) => {
    if (type === 'change') listeners.delete(listener);
  });

  const addListener = vi.fn();
  const removeListener = vi.fn();

  const mediaQueryList = {
    media: PREFERS_REDUCED_MOTION_QUERY,
    onchange: null,
    addEventListener,
    removeEventListener,
    addListener,
    removeListener,
    dispatchEvent: vi.fn(),
    get matches() {
      return matches;
    },
  };

  const original = window.matchMedia;

  window.matchMedia = vi.fn(
    () => mediaQueryList as unknown as MediaQueryList,
  ) as unknown as typeof window.matchMedia;

  restoreMatchMedia = () => {
    window.matchMedia = original;
  };

  return {
    addEventListener,
    removeEventListener,
    addListener,
    removeListener,
    setMatches(next: boolean) {
      matches = next;
      const event = {
        matches: next,
        media: PREFERS_REDUCED_MOTION_QUERY,
      } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
  };
}

beforeEach(() => {
  restoreMatchMedia = null;
});

afterEach(() => {
  cleanup();
  restoreMatchMedia?.();
  restoreMatchMedia = null;
  vi.restoreAllMocks();
});

describe('usePrefersReducedMotion', () => {
  it('devuelve true de inmediato cuando matches ya es true en el primer render', () => {
    installMatchMedia(true);

    const { result } = renderHook(() => usePrefersReducedMotion());

    // Regresión: con el anterior `useState(false)` este valor era `false` en el
    // primer render y ECharts alcanzaba a animar el gráfico.
    expect(result.current).toBe(true);
  });

  it('devuelve false cuando el sistema no pide movimiento reducido', () => {
    installMatchMedia(false);

    const { result } = renderHook(() => usePrefersReducedMotion());

    expect(result.current).toBe(false);
  });

  it('sigue el evento change y revierte al volver el valor original', () => {
    const harness = installMatchMedia(false);

    const { result } = renderHook(() => usePrefersReducedMotion());

    expect(result.current).toBe(false);

    act(() => {
      harness.setMatches(true);
    });

    expect(result.current).toBe(true);

    act(() => {
      harness.setMatches(false);
    });

    expect(result.current).toBe(false);
  });

  it('usa addEventListener con el tipo change en lugar del obsoleto addListener', () => {
    const harness = installMatchMedia(false);

    renderHook(() => usePrefersReducedMotion());

    expect(harness.addEventListener).toHaveBeenCalledTimes(1);
    expect(harness.addEventListener.mock.calls[0]?.[0]).toBe('change');
    expect(harness.addListener).not.toHaveBeenCalled();
  });

  it('elimina el listener al desmontar', () => {
    const harness = installMatchMedia(false);

    const { unmount } = renderHook(() => usePrefersReducedMotion());

    const listener = harness.addEventListener.mock.calls[0]?.[1];

    unmount();

    expect(harness.removeEventListener).toHaveBeenCalledTimes(1);
    expect(harness.removeEventListener).toHaveBeenCalledWith('change', listener);
    expect(harness.removeListener).not.toHaveBeenCalled();
  });
});
