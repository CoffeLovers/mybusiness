'use client';

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

import { IconButton } from './button';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
}

const focusableSelector =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({ open, onClose, title, description, children, footer }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    const supportsShowModal = typeof dialog.showModal === 'function';
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (open) {
      if (supportsShowModal) {
        if (!dialog.open) {
          dialog.showModal();
        }
      } else {
        dialog.setAttribute('open', '');
      }

      const focusTarget = dialog.querySelector<HTMLElement>(focusableSelector) ?? dialog;
      focusTarget.focus();

      return () => {
        if (supportsShowModal) {
          if (dialog.open) {
            dialog.close();
          }
        } else {
          dialog.removeAttribute('open');
        }

        if (previouslyFocused?.isConnected) {
          previouslyFocused.focus();
        }
      };
    }

    if (supportsShowModal) {
      if (dialog.open) {
        dialog.close();
      }
    } else {
      dialog.removeAttribute('open');
    }
  }, [open]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === 'Escape' && typeof dialogRef.current?.showModal !== 'function') {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    const focusableElements = Array.from(
      dialog.querySelectorAll<HTMLElement>(focusableSelector),
    ).filter((element) => !element.hasAttribute('disabled') && element.tabIndex !== -1);

    if (focusableElements.length === 0) {
      event.preventDefault();
      return;
    }

    const firstElement = focusableElements[0]!;
    const lastElement = focusableElements[focusableElements.length - 1]!;
    const activeElement = document.activeElement;

    if (event.shiftKey) {
      if (activeElement === firstElement || !dialog.contains(activeElement)) {
        event.preventDefault();
        lastElement.focus();
      }
      return;
    }

    if (activeElement === lastElement || !dialog.contains(activeElement)) {
      event.preventDefault();
      firstElement.focus();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-modal={open ? true : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={handleKeyDown}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      className="m-auto w-full max-w-md rounded-lg border border-border bg-surface p-0 text-text shadow-xl backdrop:bg-text/40"
    >
      <div className="flex items-start justify-between gap-4 border-b border-border p-4">
        <div>
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="mt-1 text-sm text-text-muted">
              {description}
            </p>
          ) : null}
        </div>
        <IconButton label="Cerrar" variant="ghost" onClick={onClose}>
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </IconButton>
      </div>
      {children ? <div className="p-4">{children}</div> : null}
      {footer ? (
        <div className="flex justify-end gap-2 border-t border-border p-4">{footer}</div>
      ) : null}
    </dialog>
  );
}
