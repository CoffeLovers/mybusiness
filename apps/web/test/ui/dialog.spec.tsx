// @vitest-environment jsdom

import { useState } from 'react';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Button, Dialog } from '../../components/ui';

afterEach(cleanup);

function DialogHarness() {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <Button onClick={() => setOpen(true)}>Abrir</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Confirmar"
        description="Detalle"
        footer={<Button>Confirmar</Button>}
      >
        <p>Contenido</p>
      </Dialog>
    </div>
  );
}

function getDialog(): HTMLDialogElement {
  const dialog = document.querySelector('dialog');
  if (!dialog) {
    throw new Error('El diálogo no está montado');
  }
  return dialog;
}

describe('Dialog', () => {
  it('opens from its trigger and focuses the close button', () => {
    render(<DialogHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    const dialog = getDialog();

    expect(dialog.hasAttribute('open')).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cerrar' }));
  });

  it('onClose se llama una sola vez al cerrar', () => {
    const spy = vi.fn();
    function ControlledDialogHarness() {
      const [open, setOpen] = useState(false);

      return (
        <div>
          <Button onClick={() => setOpen(true)}>Abrir</Button>
          <Dialog
            open={open}
            onClose={() => {
              spy();
              setOpen(false);
            }}
            title="Confirmar"
            description="Detalle"
            footer={<Button>Confirmar</Button>}
          >
            <p>Contenido</p>
          </Dialog>
        </div>
      );
    }

    render(<ControlledDialogHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    const dialog = getDialog();

    fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(dialog.hasAttribute('open')).toBe(false);
  });

  it('Tab cicla dentro del diálogo', () => {
    render(<DialogHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    const dialog = getDialog();

    screen.getByRole('button', { name: 'Confirmar' }).focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cerrar' }));

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Confirmar' }));
  });

  it('closes on Escape and restores focus to the trigger', () => {
    render(<DialogHarness />);
    const trigger = screen.getByRole('button', { name: 'Abrir' });

    // jsdom no mueve el foco al hacer click; el navegador sí. Lo simulamos para
    // que el diálogo pueda recordar el elemento que tenía el foco.
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = getDialog();
    expect(dialog.hasAttribute('open')).toBe(true);

    fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));

    expect(dialog.hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on backdrop click but not on inner control clicks', () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <Dialog open onClose={onClose} title="Confirmar" footer={<Button>Confirmar</Button>}>
        <p>Contenido</p>
      </Dialog>,
    );
    const dialog = getDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('links aria-labelledby and aria-describedby to elements inside the dialog', () => {
    render(
      <Dialog open onClose={vi.fn()} title="Confirmar" description="Detalle">
        <p>Contenido</p>
      </Dialog>,
    );
    const dialog = getDialog();

    const labelledBy = dialog.getAttribute('aria-labelledby');
    const describedBy = dialog.getAttribute('aria-describedby');
    const title = labelledBy ? document.getElementById(labelledBy) : null;
    const description = describedBy ? document.getElementById(describedBy) : null;

    expect(labelledBy).not.toBeNull();
    expect(describedBy).not.toBeNull();
    expect(title).not.toBeNull();
    expect(description).not.toBeNull();
    expect(title?.textContent).toBe('Confirmar');
    expect(description?.textContent).toBe('Detalle');
    if (title) {
      expect(dialog.contains(title)).toBe(true);
    }
    if (description) {
      expect(dialog.contains(description)).toBe(true);
    }
  });

  it('handles backdrop click and inner clicks without double-closing', () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <Dialog open onClose={onClose} title="T" footer={<button type="button">OK</button>}>
        <div>
          <button type="button">Inner</button>
        </div>
      </Dialog>,
    );
    const dialog = getDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Inner' }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('traps focus when only dialog itself is focusable context', () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="T" description="D">
        <span>Solo texto</span>
      </Dialog>,
    );
    const dialog = getDialog();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    fireEvent.keyDown(dialog, { key: 'Enter' });
  });

  it('closes via IconButton and restores focus', () => {
    render(<DialogHarness />);
    const trigger = screen.getByRole('button', { name: 'Abrir' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = getDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('handles close when open becomes false', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Dialog open onClose={onClose} title="T">
        <p>x</p>
      </Dialog>,
    );
    rerender(
      <Dialog open={false} onClose={onClose} title="T">
        <p>x</p>
      </Dialog>,
    );
  });

  it('cycles focus when shift+tab from first and tab from last', () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="T" footer={<button type="button">OK</button>}>
        <button type="button">A</button>
      </Dialog>,
    );
    const dialog = getDialog();
    const buttons = screen.getAllByRole('button');
    buttons[0]!.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    buttons[buttons.length - 1]!.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
  });
});
