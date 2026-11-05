'use client';

/**
 * Celda editable en línea (categoría o notas).
 *
 * Sólo gestiona el estado de edición: la persistencia vive en `onSave`. Si
 * `onSave` rechaza, la celda conserva el borrador, marca el control como
 * inválido y expone el mensaje; es el contenedor quien decide restaurar el
 * valor anterior (rollback optimista).
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

export interface InlineEditCellProps {
  value: string;
  label: string;
  maxLength: number;
  multiline?: boolean;
  /** Identifica el campo para poder activarlo con `Enter` desde la fila. */
  field?: 'category' | 'notes';
  onSave: (next: string) => Promise<void>;
}

const SAVED_FEEDBACK_MS = 1500;

export function InlineEditCell({
  value,
  label,
  maxLength,
  multiline = false,
  field,
  onSave,
}: InlineEditCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const cancelRef = useRef(false);
  const controlRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const savedTimerRef = useRef<number | null>(null);
  const errorId = useId();

  const clearSavedTimer = useCallback(() => {
    if (savedTimerRef.current !== null) {
      window.clearTimeout(savedTimerRef.current);
      savedTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearSavedTimer, [clearSavedTimer]);

  // El valor puede cambiar por un rollback del contenedor: se refleja al salir.
  useEffect(() => {
    if (!isEditing) {
      setDraft(value);
    }
  }, [value, isEditing]);

  // `autoFocus` dispara avisos de accesibilidad; el foco se mueve aquí.
  useEffect(() => {
    if (!isEditing) {
      return;
    }

    const control = controlRef.current;

    control?.focus();
    control?.select();
  }, [isEditing]);

  function startEditing(): void {
    clearSavedTimer();
    setJustSaved(false);
    setDraft(value);
    setError(null);
    cancelRef.current = false;
    setIsEditing(true);
  }

  function cancelEditing(): void {
    cancelRef.current = true;
    setDraft(value);
    setError(null);
    setIsEditing(false);
  }

  async function commit(): Promise<void> {
    if (isSaving) {
      return;
    }

    const next = draft.trim();

    if (next === value) {
      setError(null);
      setIsEditing(false);

      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await onSave(next);
      setIsEditing(false);
      setJustSaved(true);
      clearSavedTimer();
      savedTimerRef.current = window.setTimeout(() => {
        setJustSaved(false);
        savedTimerRef.current = null;
      }, SAVED_FEEDBACK_MS);
    } catch (cause) {
      setError(cause instanceof Error && cause.message.length > 0 ? cause.message : 'Error');
    } finally {
      setIsSaving(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEditing();

      return;
    }

    if (event.key === 'Enter' && (!multiline || !event.shiftKey)) {
      event.preventDefault();
      void commit();
    }
  }

  if (!isEditing) {
    return (
      <button
        type="button"
        onClick={startEditing}
        data-editable={field}
        data-state={justSaved ? 'saved' : undefined}
        aria-label={`${label}: ${value.length > 0 ? value : 'vacío'}. Pulsa para editar`}
        className={`flex w-full items-center gap-1 rounded-sm px-1 py-1 text-left text-sm hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
          justSaved ? 'text-income' : value.length > 0 ? 'text-text' : 'text-text-muted'
        } ${multiline ? 'line-clamp-2' : 'truncate'}`}
      >
        {justSaved ? (
          <>
            <svg
              aria-hidden="true"
              className="size-3 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
            >
              <path d="m5 12 5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="sr-only">Guardado</span>
          </>
        ) : null}
        <span className={multiline ? 'line-clamp-2' : 'truncate'}>
          {value.length > 0 ? value : '—'}
        </span>
      </button>
    );
  }

  const controlClass = `w-full rounded-sm border bg-surface px-1 py-0.5 text-sm text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60 ${
    error === null ? 'border-border' : 'border-expense'
  }`;

  return (
    <div className="flex flex-col gap-1">
      {multiline ? (
        <textarea
          ref={(element) => {
            controlRef.current = element;
          }}
          value={draft}
          rows={2}
          maxLength={maxLength}
          aria-label={label}
          aria-invalid={error !== null}
          aria-describedby={error === null ? undefined : errorId}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (cancelRef.current) {
              cancelRef.current = false;

              return;
            }

            void commit();
          }}
          className={controlClass}
        />
      ) : (
        <input
          ref={(element) => {
            controlRef.current = element;
          }}
          type="text"
          value={draft}
          maxLength={maxLength}
          aria-label={label}
          aria-invalid={error !== null}
          aria-describedby={error === null ? undefined : errorId}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (cancelRef.current) {
              cancelRef.current = false;

              return;
            }

            void commit();
          }}
          className={controlClass}
        />
      )}

      {error === null ? null : (
        <p id={errorId} role="alert" className="text-xs text-expense">
          No se pudo guardar: {error}
        </p>
      )}
    </div>
  );
}
