'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';

const INPUT_CLASSES =
  'mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const ERROR_ID = 'login-error';

/** Traduce el estado HTTP del BFF a un mensaje estable para la persona usuaria. */
function messageForStatus(status: number): string {
  switch (status) {
    case 401:
      return 'Credenciales inválidas.';
    case 429:
      return 'Demasiados intentos. Espera un minuto.';
    case 403:
      return 'Origen no permitido.';
    default:
      return 'No se pudo iniciar sesión.';
  }
}

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const response = await fetch('/api/session/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email, password }),
      });

      if (response.ok) {
        // Navegación completa: el Server Component vuelve a leer la cookie httpOnly.
        window.location.assign('/');
        return;
      }

      setError(messageForStatus(response.status));
    } catch {
      setError('No se pudo iniciar sesión.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col">
        <label htmlFor="email" className="text-sm font-medium text-text">
          Correo electrónico
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-describedby={error === null ? undefined : ERROR_ID}
          className={INPUT_CLASSES}
        />
      </div>

      <div className="flex flex-col">
        <label htmlFor="password" className="text-sm font-medium text-text">
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-describedby={error === null ? undefined : ERROR_ID}
          className={INPUT_CLASSES}
        />
      </div>

      {error === null ? null : (
        <p id={ERROR_ID} role="alert" className="text-sm font-medium text-expense">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 w-full rounded-md bg-primary px-4 py-2 text-base font-medium text-primary-contrast transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}
