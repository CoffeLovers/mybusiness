// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DelayedSkeleton } from '../../components/ui/delayed-skeleton';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('DelayedSkeleton', () => {
  it('no muestra el skeleton al inicio ni a los 299 ms', () => {
    render(<DelayedSkeleton />);

    expect(screen.queryByTestId('delayed-skeleton')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(299);
    });

    expect(screen.queryByTestId('delayed-skeleton')).toBeNull();
  });

  it('muestra el skeleton a los 300 ms', () => {
    render(<DelayedSkeleton />);

    act(() => {
      vi.advanceTimersByTime(300);
    });

    const skeleton = screen.queryByTestId('delayed-skeleton');

    expect(skeleton).not.toBeNull();
    expect(skeleton?.getAttribute('aria-hidden')).toBe('true');
  });

  it('con delayMs=0 aparece inmediatamente tras el efecto', () => {
    render(<DelayedSkeleton delayMs={0} />);

    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(screen.queryByTestId('delayed-skeleton')).not.toBeNull();
  });

  it('cancela el timer al desmontar antes del retardo', () => {
    const { unmount } = render(<DelayedSkeleton />);

    act(() => {
      vi.advanceTimersByTime(150);
    });

    unmount();

    expect(vi.getTimerCount()).toBe(0);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByTestId('delayed-skeleton')).toBeNull();
  });
});
