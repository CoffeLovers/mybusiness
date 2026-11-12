/**
 * Página del agente conversacional (SF3-05, #75).
 *
 * El servidor resuelve la sesión y el presupuesto actual. Un fallo del
 * presupuesto no bloquea el chat: se entrega `budgetError` y el panel muestra
 * sólo el restante que llegue con cada respuesta.
 */

import type { AgentBudgetSnapshot } from '@mybusiness/contracts';

import { AgentChat } from '@/components/agent/agent-chat';
import { gatewayFetch } from '@/lib/server/gateway-client';
import { readSession } from '@/lib/session/server';

export const metadata = {
  title: 'Agente · MyBusiness',
};

export default async function AgentePage() {
  const session = await readSession();

  let initialBudget: AgentBudgetSnapshot | null = null;
  let budgetError = false;

  if (session !== null) {
    try {
      initialBudget = await gatewayFetch<AgentBudgetSnapshot>('/api/v1/agent/budget', {
        accessToken: session.accessToken,
      });
    } catch {
      budgetError = true;
    }
  } else {
    budgetError = true;
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-4xl font-semibold tracking-tight text-text">Agente</h1>
        <p className="max-w-prose text-base text-text-muted">
          Consulta tus finanzas con cifras verificadas del backend.
        </p>
      </header>

      <AgentChat initialBudget={initialBudget} budgetError={budgetError} />
    </section>
  );
}
