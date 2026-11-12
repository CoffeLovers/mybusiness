'use client';

import { useState } from 'react';

import {
  Button,
  Card,
  Chip,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  InlineBanner,
  Select,
  Skeleton,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableDensityToggle,
  TableHead,
  TableHeaderCell,
  TableRow,
  fieldControlClasses,
  useTableDensity,
} from '@/components/ui';

export default function DesignSystemPage() {
  const [open, setOpen] = useState(false);
  const { density: tableDensity, setDensity: setTableDensity } = useTableDensity();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-text">Sistema de diseño</h1>
        <p className="text-text-muted">
          Catálogo vivo de los componentes base del portal. Cada primitiva usa tokens semánticos y
          cumple los requisitos de accesibilidad del proyecto.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-text">Botones</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button>Principal</Button>
          <Button variant="secondary">Secundaria</Button>
          <Button variant="ghost">Fantasma</Button>
          <Button variant="danger">Peligro</Button>
          <Button loading>Guardando</Button>
          <Button disabled>Deshabilitado</Button>
          <Button size="lg">Grande</Button>
          <IconButton label="Añadir" variant="secondary">
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
              <path d="M8 3v10M3 8h10" />
            </svg>
          </IconButton>
          <IconButton label="Editar" variant="ghost">
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M11 2l3 3-8 8H3v-3z" />
            </svg>
          </IconButton>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-text">Campos</h2>
        <div className="flex flex-col gap-4">
          <Field label="Correo electrónico" hint="Nunca compartimos tu correo">
            {(control) => <input {...control} type="email" className={fieldControlClasses} />}
          </Field>
          <Field label="Contraseña" error="Mínimo 8 caracteres">
            {(control) => <input {...control} type="password" className={fieldControlClasses} />}
          </Field>
          <Field label="Moneda">
            {(control) => (
              <Select {...control}>
                <option value="mxn">Peso mexicano (MXN)</option>
                <option value="usd">Dólar estadounidense (USD)</option>
              </Select>
            )}
          </Field>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-text">Etiquetas</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Chip tone="neutral">Neutral</Chip>
          <Chip tone="income">Ingreso</Chip>
          <Chip tone="expense">Gasto</Chip>
          <Chip tone="alert">Alerta</Chip>
          <StatusBadge tone="income">Activo</StatusBadge>
          <StatusBadge tone="alert">Pendiente</StatusBadge>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-text">Tarjetas y avisos</h2>
        <Card>
          <p className="text-base font-semibold text-text">Balance del mes</p>
          <p className="mt-1 text-sm text-text-muted">
            Tus ingresos superan a tus gastos en 4.320 unidades durante el periodo actual.
          </p>
        </Card>
        <div className="flex flex-col gap-3">
          <InlineBanner tone="info" title="Información">
            Los datos se actualizan cada hora.
          </InlineBanner>
          <InlineBanner tone="success" title="Éxito">
            El movimiento se registró correctamente.
          </InlineBanner>
          <InlineBanner tone="warning" title="Advertencia">
            Quedan pocos movimientos sin conciliar.
          </InlineBanner>
          <InlineBanner tone="danger" title="Error">
            No pudimos conectar con el servicio de pagos.
          </InlineBanner>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-text">Carga y vacío</h2>
        <Skeleton lines={3} />
        <EmptyState
          title="Sin movimientos"
          description="Aún no registras gastos."
          action={<Button variant="secondary">Registrar gasto</Button>}
        />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-text">Tabla</h2>
          <TableDensityToggle density={tableDensity} onChange={setTableDensity} />
        </div>
        <Table density={tableDensity}>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Fecha</TableHeaderCell>
              <TableHeaderCell>Descripción</TableHeaderCell>
              <TableHeaderCell>Monto</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell>01/02/2025</TableCell>
              <TableCell>Venta de mostrador</TableCell>
              <TableCell>$1.250</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>03/02/2025</TableCell>
              <TableCell>Compra de insumos</TableCell>
              <TableCell>$480</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>05/02/2025</TableCell>
              <TableCell>Servicios del local</TableCell>
              <TableCell>
                <StatusBadge tone="alert">Pendiente</StatusBadge>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-text">Diálogo</h2>
        <div>
          <Button onClick={() => setOpen(true)}>Abrir diálogo</Button>
        </div>
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          title="Confirmar acción"
          description="Esta acción no se puede deshacer."
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={() => setOpen(false)}>Confirmar</Button>
            </>
          }
        />
      </section>
    </main>
  );
}
