import type { Metadata } from 'next';

import { LandingPage } from '@/components/marketing/landing-page';

export const metadata: Metadata = {
  title: 'MyBusiness · Finanzas claras para tu negocio',
  description:
    'MyBusiness reúne caja, conciliación y auditoría en un solo panel: controla tus cuentas en COP, USD y EUR desde un único lugar.',
};

export default function MarketingPage() {
  return <LandingPage />;
}
