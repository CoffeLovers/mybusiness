import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Iniciar sesión · Asistente Financiero',
};

const INPUT_CLASSES =
  'mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export default function LoginPage() {
  return (
    <section className="mt-6 flex flex-col gap-4">
      <h2 className="text-xl font-semibold text-text">Iniciar sesión</h2>
      <p className="text-sm text-text-muted">
        Ingresa con tu cuenta para ver el resumen de tu negocio.
      </p>

      <form action="#" method="post" className="flex flex-col gap-4">
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
            className={INPUT_CLASSES}
          />
        </div>

        <button
          type="submit"
          className="mt-2 w-full rounded-md bg-primary px-4 py-2 text-base font-medium text-primary-contrast"
        >
          Entrar
        </button>
      </form>

      <p role="note" className="text-sm text-text-muted">
        La autenticación real llegará con SF2-03. Por ahora este formulario no procesa credenciales.
      </p>
    </section>
  );
}
