import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { AppShell } from '@/components/app-shell';
import { readSession } from '@/lib/session/server';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await readSession();

  if (session === null) {
    redirect('/login');
  }

  return <AppShell user={session.user}>{children}</AppShell>;
}
