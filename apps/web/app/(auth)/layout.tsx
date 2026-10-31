import type { ReactNode } from 'react';

export default function AuthLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface px-4 py-12">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface-raised p-8">
        <h1 className="text-2xl font-semibold text-text">Asistente Financiero</h1>
        {children}
      </div>
    </main>
  );
}
