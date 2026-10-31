import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { LoginForm } from '@/components/login-form';
import { readSession } from '@/lib/session/server';

export const metadata: Metadata = {
  title: 'Iniciar sesión · Asistente Financiero',
};

export default async function LoginPage() {
  const session = await readSession();

  if (session !== null) {
    redirect('/');
  }

  return (
    <section className="mt-6 flex flex-col gap-4">
      <h2 className="text-xl font-semibold text-text">Iniciar sesión</h2>
      <p className="text-sm text-text-muted">
        Ingresa con tu cuenta para ver el resumen de tu negocio.
      </p>

      <LoginForm />
    </section>
  );
}
