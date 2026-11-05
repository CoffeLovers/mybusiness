'use client';

import Link from 'next/link';
import { type KeyboardEvent, useRef, useState } from 'react';

import { cn } from '@/components/ui/cn';

/* ---------------------------------------------------------------------------
 * Iconos inline (decorativos): siempre aria-hidden y heredan currentColor.
 * ------------------------------------------------------------------------- */

function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m3 8.5 3.5 3.5L13 4.5" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

function CoinsIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <ellipse cx="8" cy="5.5" rx="5" ry="2.5" />
      <path d="M3 5.5v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4" />
      <path d="M3 9.5v4C3 14.9 5.2 16 8 16c1 0 2-.1 2.8-.4" />
      <circle cx="14.5" cy="13.5" r="3" />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 8a6 6 0 0 0-10.4-3L3 7.5" />
      <path d="M3 3.5v4h4" />
      <path d="M4 12a6 6 0 0 0 10.4 3l2.6-2.5" />
      <path d="M17 16.5v-4h-4" />
    </svg>
  );
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 2.5 3.5 5v5c0 4 2.8 6.5 6.5 7.5 3.7-1 6.5-3.5 6.5-7.5V5L10 2.5Z" />
      <path d="m7.5 9.5 1.8 1.8L13 7.5" />
    </svg>
  );
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="7.5" cy="6.5" r="2.75" />
      <path d="M2.5 16c0-2.6 2.2-4.5 5-4.5s5 1.9 5 4.5" />
      <path d="M13 4.2a2.75 2.75 0 0 1 0 4.6M14.5 11.8c1.8.6 3 2.1 3 4.2" />
    </svg>
  );
}

/* ---------------------------------------------------------------------------
 * Landing pública (iteración 2). Sin imágenes ni dependencias: los mockups se
 * construyen con CSS y SVG inline sobre tokens semánticos.
 * ------------------------------------------------------------------------- */

export function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:border focus:border-border-strong focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-text"
      >
        Saltar al contenido
      </a>

      <SiteHeader />

      <main id="contenido" tabIndex={-1} className="flex-1">
        <HeroSection />
        <MissionSection />
        <StepsSection />
        <BenefitsSection />
        <TestimonialsSection />
        <FinalCtaSection />
      </main>

      <SiteFooter />
    </div>
  );
}

/* --------------------------------- Header -------------------------------- */

const NAV_LINKS = [
  { label: 'Producto', href: '#producto' },
  { label: 'Beneficios', href: '#beneficios' },
  { label: 'Seguridad', href: '#seguridad' },
] as const;

function BrandMark() {
  return (
    <span className="flex items-center gap-2">
      <span className="text-lg font-semibold tracking-tight text-text">mybusiness</span>
      <span aria-hidden="true" className="flex items-center gap-1">
        <span className="size-1.5 rounded-full bg-primary" />
        <span className="size-1.5 rounded-full bg-primary/70" />
        <span className="size-1.5 rounded-full bg-primary/40" />
      </span>
    </span>
  );
}

const navLinkClasses =
  'inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring';

const loginLinkClasses =
  'inline-flex min-h-11 items-center gap-2 rounded-md border border-border-strong bg-surface px-4 text-sm font-medium text-text transition-colors hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring';

function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4">
        <Link
          href="/"
          aria-label="MyBusiness, inicio"
          className="flex min-h-11 items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          <BrandMark />
        </Link>

        <nav aria-label="Secciones de la página" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a href={link.href} className={navLinkClasses}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          <Link href="/login" className={cn(loginLinkClasses, 'hidden sm:inline-flex')}>
            Iniciar sesión
            <ArrowRightIcon />
          </Link>

          <details className="group relative md:hidden">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md border border-border-strong px-4 text-sm font-medium text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring [&::-webkit-details-marker]:hidden">
              Menú
              <ChevronDownIcon className="transition-transform group-open:rotate-180" />
            </summary>
            <div className="absolute right-0 mt-2 flex w-56 flex-col gap-1 rounded-lg border border-border bg-surface p-2 shadow-lg">
              {NAV_LINKS.map((link) => (
                <a key={link.href} href={link.href} className={navLinkClasses}>
                  {link.label}
                </a>
              ))}
              <Link href="/login" className={navLinkClasses}>
                Iniciar sesión
              </Link>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}

/* ---------------------------------- Hero --------------------------------- */

function HeroCards() {
  return (
    <div aria-hidden="true" className="relative mx-auto flex w-full max-w-[16rem] flex-col">
      <div className="relative z-10 -rotate-2 rounded-xl border border-border bg-accent p-4 text-on-accent shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <span className="text-xs font-semibold tracking-wide uppercase">MyBusiness</span>
          <span className="flex gap-1">
            <span className="size-1.5 rounded-full bg-on-accent/70" />
            <span className="size-1.5 rounded-full bg-on-accent/50" />
            <span className="size-1.5 rounded-full bg-on-accent/30" />
          </span>
        </div>
        <div className="mt-6 h-7 w-10 rounded-sm bg-on-accent/20" />
        <p className="mt-5 font-mono text-sm tracking-widest tabular-nums">•••• •••• •••• 4021</p>
        <div className="mt-3 flex items-center justify-between text-xs">
          <span>12/29</span>
          <span className="font-semibold">COP</span>
        </div>
      </div>

      <div className="relative z-20 -mt-6 rotate-1 self-end rounded-xl border border-border bg-surface-raised p-4 text-text shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <span className="text-xs font-semibold tracking-wide text-text-muted uppercase">
            Corporativa
          </span>
          <span className="flex gap-1">
            <span className="size-1.5 rounded-full bg-border-strong" />
            <span className="size-1.5 rounded-full bg-border-strong/70" />
            <span className="size-1.5 rounded-full bg-border-strong/40" />
          </span>
        </div>
        <div className="mt-6 h-7 w-10 rounded-sm bg-border" />
        <p className="mt-5 font-mono text-sm tracking-widest text-text tabular-nums">
          •••• •••• •••• 7788
        </p>
        <div className="mt-3 flex items-center justify-between text-xs text-text-muted">
          <span>08/28</span>
          <span className="font-semibold text-text">USD</span>
        </div>
      </div>

      <div className="relative z-10 -mt-6 -rotate-1 rounded-xl border border-inverse-raised bg-inverse p-4 text-on-inverse shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <span className="text-xs font-semibold tracking-wide uppercase">Internacional</span>
          <span className="flex gap-1">
            <span className="size-1.5 rounded-full bg-on-inverse/70" />
            <span className="size-1.5 rounded-full bg-on-inverse/50" />
            <span className="size-1.5 rounded-full bg-on-inverse/30" />
          </span>
        </div>
        <div className="mt-6 h-7 w-10 rounded-sm bg-on-inverse/20" />
        <p className="mt-5 font-mono text-sm tracking-widest tabular-nums">•••• •••• •••• 1934</p>
        <div className="mt-3 flex items-center justify-between text-xs text-inverse-muted">
          <span>04/30</span>
          <span className="font-semibold text-on-inverse">EUR</span>
        </div>
      </div>
    </div>
  );
}

function HeroWidgets() {
  return (
    <div className="mt-12">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium tracking-wide text-text-muted uppercase">
          Resumen del panel
        </p>
        <p className="rounded-full border border-border px-3 py-1 text-xs text-text-muted">
          Vista de demostración
        </p>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-surface p-5 sm:col-span-2">
          <p className="text-sm font-medium text-text-muted">Saldo consolidado</p>
          <p className="mt-1 text-3xl font-semibold text-text tabular-nums">$49.076,86</p>
          <p className="mt-1 text-xs text-text-muted">
            COP · Cifras ilustrativas, no representan una cuenta real.
          </p>
          <svg
            role="img"
            aria-labelledby="sparkline-saldo-title sparkline-saldo-desc"
            viewBox="0 0 160 48"
            fill="none"
            className="mt-4 h-14 w-full text-income"
          >
            <title id="sparkline-saldo-title">Tendencia del saldo consolidado</title>
            <desc id="sparkline-saldo-desc">
              Serie ascendente de siete puntos durante la última semana. Datos de demostración.
            </desc>
            <path
              d="M2 38 24 32 46 35 68 24 90 27 112 15 134 18 158 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <div className="rounded-xl bg-accent p-5 text-on-accent">
          <p className="text-sm font-medium">3 monedas</p>
          <p className="mt-2 text-lg font-semibold tabular-nums">COP · USD · EUR</p>
          <p className="mt-2 text-xs">Saldos separados y consolidados en un mismo panel.</p>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="text-sm font-medium text-text">Conciliación diaria</p>
            <p className="mt-1 text-xs text-text-muted">Cada 24 horas</p>
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="text-sm font-medium text-text">Auditoría inmutable</p>
            <p className="mt-1 text-xs text-text-muted">Sin ediciones posteriores</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function HeroSection() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 pt-12 pb-16 sm:pt-16">
      <div className="grid items-center gap-12 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <h1 className="text-5xl leading-[1.05] tracking-tight text-text sm:text-6xl">
            <span className="font-medium">La confianza se construye</span>{' '}
            <span className="font-semibold">con cada movimiento.</span>
          </h1>
          <p className="mt-6 max-w-prose text-lg text-text-muted">
            Controla tus cuentas, concilia cada movimiento y audita todo desde un solo panel. Sin
            hojas de cálculo ni cifras dispersas.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/login"
              className="inline-flex min-h-12 items-center gap-2 rounded-md bg-accent px-6 text-base font-semibold text-on-accent transition-colors hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              Empezar ahora
              <ArrowRightIcon />
            </Link>
            <a
              href="#producto"
              className="inline-flex min-h-12 items-center rounded-md px-3 text-base font-medium text-text underline decoration-border-strong underline-offset-4 transition-colors hover:decoration-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              Ver el producto
            </a>
          </div>
        </div>

        <div className="lg:col-span-4">
          <HeroCards />
        </div>

        <div className="flex gap-8 lg:col-span-2 lg:flex-col lg:gap-8 lg:border-border lg:pl-6 lg:border-l">
          <div>
            <p className="text-4xl font-semibold text-text tabular-nums">4</p>
            <p className="mt-1 text-sm text-text-muted">módulos conectados</p>
          </div>
          <div>
            <p className="text-4xl font-semibold text-text tabular-nums">1</p>
            <p className="mt-1 text-sm text-text-muted">panel para todo</p>
          </div>
        </div>
      </div>

      <HeroWidgets />
    </section>
  );
}

/* -------------------------------- Misión --------------------------------- */

function MarqueeBand() {
  const items = Array.from({ length: 6 }, (_, index) => index);

  return (
    <div
      aria-hidden="true"
      className="overflow-hidden border-y border-inverse-raised bg-inverse py-4"
    >
      <div className="flex w-max animate-marquee motion-reduce:animate-none">
        {[0, 1].map((copy) => (
          <div
            key={copy}
            aria-hidden={copy === 1 ? true : undefined}
            className="flex shrink-0 items-center"
          >
            {items.map((item) => (
              <span
                key={`${copy}-${item}`}
                className="px-6 text-sm font-semibold tracking-[0.3em] whitespace-nowrap text-on-inverse uppercase"
              >
                * MYBUSINESS BANKING *
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const MISSION_METRICS = [
  { value: '4 pasos', detail: 'Registro guiado' },
  { value: '3 monedas', detail: 'COP, USD y EUR' },
  { value: 'AA 4.5:1', detail: 'Contraste de texto' },
  { value: '100% auditado', detail: 'Movimientos registrados' },
] as const;

function PhoneMockup() {
  return (
    <div className="relative mx-auto mt-14 flex w-full max-w-xl justify-center px-2">
      <p className="absolute top-6 left-0 z-10 rounded-full bg-accent px-3 py-2 text-xs font-semibold text-on-accent shadow-lg sm:left-6">
        Gestiona tu dinero
      </p>
      <p className="absolute right-0 bottom-10 z-10 rounded-full bg-inverse px-3 py-2 text-xs font-semibold text-on-inverse shadow-lg sm:right-6">
        Recibe notificaciones
      </p>

      <div
        aria-hidden="true"
        className="w-60 rounded-[2.25rem] border-4 border-inverse bg-surface p-2 shadow-xl"
      >
        <div className="flex h-4 items-center justify-center">
          <span className="h-1 w-16 rounded-full bg-border" />
        </div>
        <div className="mt-1 overflow-hidden rounded-[1.5rem] border border-border bg-surface-raised p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-muted">Saldo total</span>
            <span className="flex gap-1">
              <span className="size-1 rounded-full bg-border-strong" />
              <span className="size-1 rounded-full bg-border-strong" />
              <span className="size-1 rounded-full bg-border-strong" />
            </span>
          </div>
          <p className="mt-1 text-lg font-semibold text-text tabular-nums">$49.076,86</p>

          <div className="mt-4 flex h-16 items-end gap-1">
            <span className="h-6 flex-1 rounded-sm bg-primary/30" />
            <span className="h-10 flex-1 rounded-sm bg-primary/30" />
            <span className="h-8 flex-1 rounded-sm bg-primary/30" />
            <span className="h-14 flex-1 rounded-sm bg-primary/30" />
            <span className="h-9 flex-1 rounded-sm bg-primary/30" />
            <span className="h-16 flex-1 rounded-sm bg-primary" />
            <span className="h-12 flex-1 rounded-sm bg-primary/30" />
          </div>

          <div className="mt-4 flex flex-col gap-2">
            <div className="flex items-center gap-2 rounded-md bg-surface p-2">
              <span className="size-6 rounded-full border border-border" />
              <span className="flex flex-1 flex-col gap-1">
                <span className="h-1.5 w-20 rounded-full bg-border-strong" />
                <span className="h-1.5 w-12 rounded-full bg-border" />
              </span>
              <span className="h-1.5 w-8 rounded-full bg-income" />
            </div>
            <div className="flex items-center gap-2 rounded-md bg-surface p-2">
              <span className="size-6 rounded-full border border-border" />
              <span className="flex flex-1 flex-col gap-1">
                <span className="h-1.5 w-16 rounded-full bg-border-strong" />
                <span className="h-1.5 w-10 rounded-full bg-border" />
              </span>
              <span className="h-1.5 w-8 rounded-full bg-expense" />
            </div>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-center">
          <span className="h-1 w-16 rounded-full bg-border" />
        </div>
      </div>
    </div>
  );
}

function MissionSection() {
  return (
    <section aria-labelledby="mision-titulo">
      <MarqueeBand />

      <div className="mx-auto w-full max-w-6xl px-4 py-16">
        <div className="mx-auto max-w-2xl text-center">
          <h2
            id="mision-titulo"
            className="text-3xl font-semibold tracking-tight text-text sm:text-4xl"
          >
            Finanzas claras para negocios que crecen.
          </h2>
          <p className="mx-auto mt-4 max-w-prose text-base text-text-muted">
            MyBusiness reúne caja, conciliación y auditoría en un mismo lugar para que decidas con
            datos verificables, no con supuestos.
          </p>
        </div>

        <dl className="mt-12 grid grid-cols-2 gap-6 border-border border-y py-8 sm:grid-cols-4">
          {MISSION_METRICS.map((metric) => (
            <div key={metric.value} className="flex flex-col gap-1">
              <dt className="text-2xl font-semibold text-text tabular-nums sm:text-3xl">
                {metric.value}
              </dt>
              <dd className="text-xs text-text-muted sm:text-sm">{metric.detail}</dd>
            </div>
          ))}
        </dl>

        <PhoneMockup />
      </div>
    </section>
  );
}

/* -------------------------------- Pasos ---------------------------------- */

const STEPS = [
  {
    id: 'datos',
    title: 'Prepara tus datos',
    description: 'Identificación del representante y datos bancarios de la empresa.',
  },
  {
    id: 'cuenta',
    title: 'Crea tu cuenta',
    description: 'Correo corporativo y verificación en dos pasos.',
  },
  {
    id: 'conexion',
    title: 'Conecta tus cuentas',
    description: 'Bancos en COP, USD y EUR visibles en un mismo panel.',
  },
  {
    id: 'operacion',
    title: 'Empieza a operar',
    description: 'Conciliación y auditoría activas desde el primer movimiento.',
  },
] as const;

function MockField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <p className="text-xs text-text-muted">{label}</p>
      <p className="mt-0.5 text-sm text-text">{value}</p>
    </div>
  );
}

function BankRow({
  name,
  detail,
  connected,
}: {
  name: string;
  detail: string;
  connected: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-3">
      <span className="flex items-center gap-3">
        <span aria-hidden="true" className="size-2 rounded-full bg-income" />
        <span className="flex flex-col">
          <span className="text-sm font-medium text-text">{name}</span>
          <span className="text-xs text-text-muted">{detail}</span>
        </span>
      </span>
      <span
        className={cn(
          'rounded-full border px-2 py-1 text-xs font-medium whitespace-nowrap',
          connected ? 'border-income/40 text-income' : 'border-alert/40 text-alert',
        )}
      >
        {connected ? 'Conectada' : 'Pendiente'}
      </span>
    </li>
  );
}

function StepMock({ step }: { step: number }) {
  if (step === 0) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-sm font-semibold text-text">Documentos de la empresa</p>
          <ul className="mt-3 flex flex-col gap-2">
            {[
              'Identificación del representante legal',
              'Documento tributario vigente',
              'Certificación bancaria',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-text">
                <CheckIcon className="mt-0.5 shrink-0 text-income" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-text-muted">
          Todo se valida antes de crear la cuenta; no necesitas adjuntar nada dos veces.
        </p>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="flex flex-col gap-3">
        <MockField label="Correo corporativo" value="equipo@empresa.com" />
        <MockField label="Contraseña" value="••••••••••" />
        <div className="flex items-center justify-between gap-3 rounded-md border border-income/40 bg-surface px-3 py-2">
          <span className="text-sm font-medium text-text">Verificación en dos pasos</span>
          <span className="flex items-center gap-1 text-xs font-medium text-income">
            <CheckIcon className="size-3.5" />
            Activa
          </span>
        </div>
        <p className="text-sm text-text-muted">
          El acceso queda ligado a tu correo y a un segundo factor.
        </p>
      </div>
    );
  }

  if (step === 2) {
    return (
      <ul className="flex flex-col gap-2">
        <BankRow name="Cuenta operativa" detail="COP · Banco principal" connected />
        <BankRow name="Cuenta de reservas" detail="USD · Banco corresponsal" connected />
        <BankRow name="Cuenta de proveedores" detail="EUR · En verificación" connected={false} />
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="text-sm text-text-muted">Saldo consolidado</p>
        <p className="mt-1 text-2xl font-semibold text-text tabular-nums">$49.076,86</p>
        <div className="mt-4 flex h-16 items-end gap-1">
          <span className="h-8 flex-1 rounded-sm bg-primary/30" />
          <span className="h-12 flex-1 rounded-sm bg-primary/30" />
          <span className="h-10 flex-1 rounded-sm bg-primary/30" />
          <span className="h-16 flex-1 rounded-sm bg-primary" />
          <span className="h-9 flex-1 rounded-sm bg-primary/30" />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <span className="rounded-full border border-border px-3 py-1 text-xs text-text-muted">
          Conciliación diaria
        </span>
        <span className="rounded-full border border-border px-3 py-1 text-xs text-text-muted">
          Auditoría inmutable
        </span>
      </div>
    </div>
  );
}

function StepsSection() {
  const [activeStep, setActiveStep] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const lastIndex = STEPS.length - 1;
    let nextIndex = index;

    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        nextIndex = index === lastIndex ? 0 : index + 1;
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        nextIndex = index === 0 ? lastIndex : index - 1;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = lastIndex;
        break;
      default:
        return;
    }

    event.preventDefault();
    setActiveStep(nextIndex);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <section id="producto" className="scroll-mt-20 border-border border-t">
      <div className="mx-auto w-full max-w-6xl px-4 py-16">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight text-text sm:text-4xl">
            De cero a operar en cuatro pasos
          </h2>
          <p className="mt-4 max-w-prose text-base text-text-muted">
            Cada paso guarda tu avance. Puedes retomarlo cuando tengas los documentos a mano.
          </p>
        </div>

        <div className="mt-10 grid gap-8 lg:grid-cols-2">
          <div
            role="tablist"
            aria-label="Pasos de registro"
            aria-orientation="vertical"
            className="flex flex-col gap-2"
          >
            {STEPS.map((step, index) => {
              const selected = index === activeStep;

              return (
                <button
                  key={step.id}
                  ref={(node) => {
                    tabRefs.current[index] = node;
                  }}
                  type="button"
                  role="tab"
                  id={`paso-tab-${step.id}`}
                  aria-controls={`paso-panel-${step.id}`}
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setActiveStep(index)}
                  onKeyDown={(event) => handleKeyDown(event, index)}
                  className={cn(
                    'flex min-h-11 w-full items-start gap-4 rounded-lg border px-4 py-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
                    selected
                      ? 'border-border-strong bg-surface-raised'
                      : 'border-transparent hover:bg-surface-raised',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-0.5 h-10 w-0.5 shrink-0 rounded-full',
                      selected ? 'bg-accent' : 'bg-transparent',
                    )}
                  />
                  <span className="flex flex-col gap-1">
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          'font-mono text-sm tabular-nums',
                          selected ? 'text-text' : 'text-text-muted',
                        )}
                      >
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="text-base font-semibold text-text">{step.title}</span>
                    </span>
                    <span className="text-sm text-text-muted">{step.description}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="rounded-xl border border-border bg-surface-raised p-6">
            {STEPS.map((step, index) => (
              <div
                key={step.id}
                role="tabpanel"
                id={`paso-panel-${step.id}`}
                aria-labelledby={`paso-tab-${step.id}`}
                tabIndex={0}
                hidden={index !== activeStep}
                className="min-h-[20rem] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                <p className="text-xs font-medium tracking-wide text-text-muted uppercase">
                  Paso {index + 1} de {STEPS.length}
                </p>
                <h3 className="mt-1 mb-4 text-lg font-semibold text-text">{step.title}</h3>
                <StepMock step={index} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------ Beneficios -------------------------------- */

const BENEFITS = [
  {
    icon: <CoinsIcon />,
    title: 'Multi-moneda',
    description: 'Saldo en COP, USD y EUR con conversión trazable y tipo de cambio registrado.',
  },
  {
    icon: <RefreshIcon />,
    title: 'Conciliación automática',
    description: 'Los movimientos bancarios se cruzan con tu libro mayor cada día.',
  },
  {
    icon: <ShieldIcon />,
    title: 'Auditoría inmutable',
    description: 'Cada ajuste conserva autor, fecha y valor anterior; nada se sobrescribe.',
  },
  {
    icon: <UsersIcon />,
    title: 'Control por roles',
    description: 'Cada persona ve solo lo que necesita para su función.',
  },
] as const;

function ExchangeWidget() {
  return (
    <div className="relative">
      <div className="relative z-10 mx-4 rounded-lg border border-inverse-raised bg-inverse p-4 shadow-xl">
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs font-medium tracking-wide text-inverse-muted uppercase">
            Saldo multidivisa
          </span>
          <span className="rounded-full border border-inverse-raised px-2 py-0.5 text-xs text-inverse-muted">
            Vista de demostración
          </span>
        </div>
        <p className="mt-2 text-2xl font-semibold text-on-inverse tabular-nums">USD 1.240,00</p>
      </div>

      <div className="-mt-3 rounded-xl border border-inverse-raised bg-inverse-raised p-5 pt-7">
        <h3 className="text-sm font-medium text-inverse-muted">Intercambio</h3>

        <div className="mt-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4 rounded-md bg-inverse px-3 py-3">
            <span className="text-sm text-inverse-muted">Envías</span>
            <span className="text-sm font-semibold text-on-inverse tabular-nums">USD 100,00</span>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-md bg-inverse px-3 py-3">
            <span className="text-sm text-inverse-muted">Recibes</span>
            <span className="text-sm font-semibold text-on-inverse tabular-nums">EUR 92,34</span>
          </div>
        </div>

        <p className="mt-4 text-xs text-inverse-muted">
          Tasa 0,9234 · Cifras ilustrativas de la vista de demostración.
        </p>
      </div>
    </div>
  );
}

function BenefitsSection() {
  return (
    <section id="beneficios" className="scroll-mt-20 bg-inverse text-on-inverse">
      <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 py-16 lg:grid-cols-2 lg:items-start">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight text-on-inverse sm:text-4xl">
            Eleva tu experiencia financiera
          </h2>
          <p className="mt-4 max-w-prose text-base text-inverse-muted">
            Las mismas reglas para todos los movimientos: quién los registró, cuándo y con qué
            respaldo.
          </p>

          <ul id="seguridad" className="mt-10 flex scroll-mt-20 flex-col gap-6">
            {BENEFITS.map((benefit) => (
              <li key={benefit.title} className="flex gap-4">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-inverse-raised text-accent">
                  {benefit.icon}
                </span>
                <span className="flex flex-col gap-1">
                  <h3 className="text-base font-semibold text-on-inverse">{benefit.title}</h3>
                  <p className="max-w-prose text-sm text-inverse-muted">{benefit.description}</p>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <ExchangeWidget />
      </div>
    </section>
  );
}

/* ------------------------------ Testimonios ------------------------------ */

const TESTIMONIALS = [
  {
    quote:
      'Antes cerrábamos el mes con tres hojas de cálculo. Ahora la conciliación está lista el mismo día y todo el equipo mira el mismo número.',
    name: 'María P.',
    role: 'Gerente de operaciones',
    initials: 'MP',
  },
  {
    quote:
      'La auditoría inmutable nos ahorró discusiones internas: cada ajuste queda con su responsable y su fecha.',
    name: 'Carlos R.',
    role: 'Contador',
    initials: 'CR',
  },
  {
    quote:
      'Trabajamos en pesos y en dólares. Tener el saldo consolidado en un solo panel cambió la forma de decidir.',
    name: 'Ana L.',
    role: 'Fundadora',
    initials: 'AL',
  },
] as const;

function TestimonialsSection() {
  const [activeTestimonial, setActiveTestimonial] = useState(0);
  const testimonial = TESTIMONIALS[activeTestimonial] ?? TESTIMONIALS[0];
  const lastIndex = TESTIMONIALS.length - 1;

  function showPrevious() {
    setActiveTestimonial((current) => (current === 0 ? lastIndex : current - 1));
  }

  function showNext() {
    setActiveTestimonial((current) => (current === lastIndex ? 0 : current + 1));
  }

  return (
    <section aria-labelledby="testimonios-titulo" className="border-border border-t bg-surface">
      <div className="mx-auto w-full max-w-6xl px-4 py-16">
        <div className="flex flex-wrap items-center gap-3">
          <h2
            id="testimonios-titulo"
            className="text-3xl font-semibold tracking-tight text-text sm:text-4xl"
          >
            Lo que dicen los equipos
          </h2>
          <span className="rounded-full border border-border px-3 py-1 text-xs text-text-muted">
            Contenido de demostración
          </span>
        </div>

        <figure className="mt-8 max-w-3xl">
          <div aria-live="polite">
            <blockquote className="text-xl leading-relaxed text-text sm:text-2xl">
              “{testimonial.quote}”
            </blockquote>
            <div className="mt-6 flex items-center gap-3">
              <span
                aria-hidden="true"
                className="flex size-11 items-center justify-center rounded-full bg-surface-raised text-sm font-semibold text-text"
              >
                {testimonial.initials}
              </span>
              <span className="flex flex-col">
                <span className="text-sm font-semibold text-text">{testimonial.name}</span>
                <span className="text-xs text-text-muted">{testimonial.role}</span>
              </span>
            </div>
          </div>

          <div className="mt-8 flex items-center gap-3">
            <button
              type="button"
              onClick={showPrevious}
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border-strong bg-surface px-4 text-sm font-medium text-text transition-colors hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              Anterior
            </button>
            <button
              type="button"
              onClick={showNext}
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border-strong bg-surface px-4 text-sm font-medium text-text transition-colors hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              Siguiente
            </button>
            <span className="ml-1 font-mono text-xs text-text-muted tabular-nums">
              {activeTestimonial + 1} / {TESTIMONIALS.length}
            </span>
          </div>
        </figure>
      </div>
    </section>
  );
}

/* ------------------------------ CTA final -------------------------------- */

const FINAL_BULLETS = ['Acceso por roles', 'Datos auditados', 'Sesión segura'] as const;

function FinalCtaSection() {
  return (
    <section aria-labelledby="cta-titulo" className="border-border border-t bg-surface-raised">
      <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 py-16 lg:grid-cols-2 lg:items-center">
        <div>
          <h2
            id="cta-titulo"
            className="text-3xl font-semibold tracking-tight text-text sm:text-4xl"
          >
            ¿Empezar ahora?
          </h2>
          <ul className="mt-6 flex flex-col gap-3">
            {FINAL_BULLETS.map((item) => (
              <li key={item} className="flex items-center gap-2 text-sm text-text">
                <CheckIcon className="shrink-0 text-income" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-end">
          <div aria-hidden="true" className="w-full max-w-[14rem]">
            <div className="rounded-xl border border-border bg-surface p-4 shadow-lg">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold tracking-wide text-text-muted uppercase">
                  MyBusiness
                </span>
                <span className="flex gap-1">
                  <span className="size-1.5 rounded-full bg-primary" />
                  <span className="size-1.5 rounded-full bg-primary/70" />
                  <span className="size-1.5 rounded-full bg-primary/40" />
                </span>
              </div>
              <p className="mt-6 font-mono text-sm tracking-widest text-text tabular-nums">
                •••• •••• •••• 4021
              </p>
              <div className="mt-4 h-1.5 w-16 rounded-full bg-border" />
            </div>
          </div>

          <Link
            href="/login"
            className="inline-flex size-32 shrink-0 items-center justify-center gap-1 rounded-full bg-inverse text-center font-semibold text-on-inverse ring-2 ring-accent ring-offset-2 ring-offset-surface-raised transition-colors hover:bg-inverse-raised focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus-ring"
          >
            Empezar
            <ArrowRightIcon />
          </Link>
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="border-border border-t bg-surface-raised">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6 text-sm text-text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>© 2026 MyBusiness</p>
        <nav aria-label="Enlaces del pie">
          <ul className="flex flex-wrap items-center gap-1">
            <li>
              <Link
                href="/login"
                className="inline-flex min-h-11 items-center rounded-md px-3 text-sm text-text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                Iniciar sesión
              </Link>
            </li>
            <li>
              <a
                href="#"
                className="inline-flex min-h-11 items-center rounded-md px-3 text-sm text-text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                Privacidad
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
