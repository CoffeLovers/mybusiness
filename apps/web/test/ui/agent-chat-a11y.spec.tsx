// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AgentChat } from '../../components/agent/agent-chat';

describe('AgentChat Accesibilidad (WCAG 2.1 AA)', () => {
  afterEach(cleanup);

  it('no expone aria-live ni aria-busy en el contenedor de mensajes para evitar spam de tokens', () => {
    render(<AgentChat initialBudget={null} budgetError={false} />);

    const log = screen.getByRole('log');
    expect(log).not.toBeNull();
    expect(log.hasAttribute('aria-live')).toBe(false);
    expect(log.hasAttribute('aria-busy')).toBe(false);
  });

  it('cuenta con una región viva dedicada sr-only con aria-live="polite" y aria-atomic="true"', () => {
    const { container } = render(<AgentChat initialBudget={null} budgetError={false} />);

    const liveRegion = container.querySelector('[aria-live="polite"][aria-atomic="true"]');
    expect(liveRegion).not.toBeNull();
    expect(liveRegion?.className).toContain('sr-only');
  });

  it('los controles de formulario tienen foco visible definido', () => {
    render(<AgentChat initialBudget={null} budgetError={false} />);

    const textarea = screen.getByLabelText(/mensaje para el agente/i);
    expect(textarea.className).toContain('focus-visible:outline-focus-ring');

    const submitBtn = screen.getByRole('button', { name: /enviar/i });
    expect(submitBtn.className).toContain('focus-visible:outline-focus-ring');
  });
});
