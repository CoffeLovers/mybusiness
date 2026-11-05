// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  Button,
  Card,
  Chip,
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
  TableHead,
  TableHeaderCell,
  TableRow,
  fieldControlClasses,
} from '../../components/ui';

afterEach(cleanup);

describe('Button', () => {
  it('renders its label and defaults to type="button"', () => {
    render(<Button>Guardar</Button>);
    const button = screen.getByRole('button', { name: 'Guardar' });

    expect(button.textContent).toBe('Guardar');
    expect(button.getAttribute('type')).toBe('button');
  });

  it('applies the primary variant classes by default', () => {
    render(<Button>Guardar</Button>);
    const button = screen.getByRole('button', { name: 'Guardar' });

    expect(button.className).toContain('bg-primary');
    expect(button.className).toContain('text-on-primary');
  });

  it('applies the large size classes', () => {
    render(<Button size="lg">Guardar</Button>);
    const className = screen.getByRole('button', { name: 'Guardar' }).className;

    expect(className).toContain('min-h-12');
    expect(className).toContain('px-6');
    expect(className).not.toContain('px-5');
  });

  it('exposes a busy state and a spinner while loading', () => {
    render(<Button loading>Guardar</Button>);
    const button = screen.getByRole('button', { name: 'Guardar' });

    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.querySelector('svg.animate-spin')).not.toBeNull();
  });

  it('forwards the disabled attribute', () => {
    render(<Button disabled>Guardar</Button>);

    expect(screen.getByRole('button', { name: 'Guardar' }).hasAttribute('disabled')).toBe(true);
  });

  it('applies focus-visible ring on base button', () => {
    render(<Button>Guardar</Button>);
    expect(screen.getByRole('button', { name: 'Guardar' }).className).toContain(
      'focus-visible:outline-focus-ring',
    );
  });

  it('invokes the click handler when pressed', () => {
    let clicks = 0;
    render(
      <Button
        onClick={() => {
          clicks += 1;
        }}
      >
        Guardar
      </Button>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(clicks).toBe(1);
  });
});

describe('IconButton', () => {
  it('derives its accessible name from label and keeps the touch target', () => {
    render(<IconButton label="Añadir">+</IconButton>);
    const button = screen.getByRole('button', { name: 'Añadir' });

    expect(button.getAttribute('aria-label')).toBe('Añadir');
    expect(button.className).toContain('min-h-11');
    expect(button.className).toContain('min-w-11');
  });
});

describe('Field', () => {
  it('associates the label with the control', () => {
    render(<Field label="Correo">{(control) => <input {...control} type="email" />}</Field>);

    const input = screen.getByLabelText('Correo');

    expect(input.getAttribute('type')).toBe('email');
  });

  it('applies disabled styles and attribute to input', () => {
    render(
      <Field label="Correo">
        {(control) => <input {...control} type="email" disabled className={fieldControlClasses} />}
      </Field>,
    );

    const input = screen.getByLabelText('Correo') as HTMLInputElement;

    expect(input.disabled).toBe(true);
    expect(input.className).toContain('disabled:opacity-60');
  });

  it('describes the control with the hint id', () => {
    render(
      <Field label="Correo" hint="Solo para avisos">
        {(control) => <input {...control} type="email" />}
      </Field>,
    );

    const input = screen.getByLabelText('Correo');
    const hint = screen.getByText('Solo para avisos');

    expect(input.getAttribute('aria-describedby')).toBe(hint.id);
  });

  it('marks the control as invalid and announces the error', () => {
    render(
      <Field label="Correo" hint="Solo para avisos" error="Correo inválido">
        {(control) => <input {...control} type="email" />}
      </Field>,
    );

    const input = screen.getByLabelText('Correo');
    const error = screen.getByRole('alert');
    const hint = screen.getByText('Solo para avisos');
    const describedBy = input.getAttribute('aria-describedby') ?? '';

    expect(error.textContent).toBe('Correo inválido');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(describedBy.split(' ')).toContain(error.id);
    expect(describedBy.split(' ')).toContain(hint.id);
  });

  it('marks the control as required', () => {
    render(
      <Field label="Correo" required>
        {(control) => <input {...control} type="email" />}
      </Field>,
    );

    const input = screen.getByLabelText(/Correo/);

    expect(input.hasAttribute('required')).toBe(true);
  });

  it('genera ids únicos para hint y error en varios Field', () => {
    render(
      <>
        <Field label="Campo uno" hint="Hint uno">
          {(control) => <input {...control} type="text" />}
        </Field>
        <Field label="Campo dos" hint="Hint dos">
          {(control) => <input {...control} type="text" />}
        </Field>
      </>,
    );

    const firstInput = screen.getByLabelText('Campo uno');
    const secondInput = screen.getByLabelText('Campo dos');
    const firstHintId = firstInput.getAttribute('aria-describedby') ?? '';
    const secondHintId = secondInput.getAttribute('aria-describedby') ?? '';

    expect(document.getElementById(firstHintId)?.textContent).toBe('Hint uno');
    expect(document.getElementById(secondHintId)?.textContent).toBe('Hint dos');
    expect(new Set([firstHintId, secondHintId]).size).toBe(2);
  });

  it('genera ids únicos para el error en varios Field', () => {
    render(
      <>
        <Field label="Campo uno" error="Error uno">
          {(control) => <input {...control} type="text" />}
        </Field>
        <Field label="Campo dos" error="Error dos">
          {(control) => <input {...control} type="text" />}
        </Field>
      </>,
    );

    const firstInput = screen.getByLabelText('Campo uno');
    const secondInput = screen.getByLabelText('Campo dos');
    const firstErrorId = firstInput.getAttribute('aria-describedby') ?? '';
    const secondErrorId = secondInput.getAttribute('aria-describedby') ?? '';
    const alerts = screen.getAllByRole('alert');

    expect(firstInput.getAttribute('aria-invalid')).toBe('true');
    expect(secondInput.getAttribute('aria-invalid')).toBe('true');
    expect(alerts).toHaveLength(2);
    expect(document.getElementById(firstErrorId)?.textContent).toBe('Error uno');
    expect(document.getElementById(secondErrorId)?.textContent).toBe('Error dos');
    expect(alerts.map((alert) => alert.id)).toEqual(
      expect.arrayContaining([firstErrorId, secondErrorId]),
    );
    expect(new Set([firstErrorId, secondErrorId]).size).toBe(2);
  });
});

describe('Select', () => {
  it('renders the options and keeps the shared control classes', () => {
    render(
      <Select defaultValue="a" aria-label="Cuenta">
        <option value="a">Ahorros</option>
        <option value="b">Corriente</option>
      </Select>,
    );

    const select = screen.getByRole('combobox', { name: 'Cuenta' });

    expect(select.querySelectorAll('option')).toHaveLength(2);
    expect(select.textContent).toContain('Ahorros');
    expect(select.textContent).toContain('Corriente');
    expect(select.className.split(' ')).toEqual(
      expect.arrayContaining(fieldControlClasses.split(' ')),
    );
    expect(select.className).toContain('min-h-11');
  });

  it('applies disabled attribute and option', () => {
    render(
      <Select disabled aria-label="Cuenta" defaultValue="a">
        <option value="a">Ahorros</option>
      </Select>,
    );

    const select = screen.getByRole('combobox', { name: 'Cuenta' }) as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(select.querySelector('option')?.getAttribute('value')).toBe('a');
  });
});

describe('Card', () => {
  it('renders its children', () => {
    render(
      <Card>
        <p>Contenido de la tarjeta</p>
      </Card>,
    );

    expect(screen.getByText('Contenido de la tarjeta').tagName).toBe('P');
  });
});

describe('Chip', () => {
  it('applies the income tone classes', () => {
    render(<Chip tone="income">Ingreso</Chip>);

    const chip = screen.getByText('Ingreso');

    expect(chip.tagName).toBe('SPAN');
    expect(chip.className).toContain('text-income');
  });
});

describe('StatusBadge', () => {
  it('renders a decorative dot alongside the label', () => {
    render(<StatusBadge tone="income">Activo</StatusBadge>);

    const badge = screen.getByText('Activo');
    const dot = badge.querySelector('span[aria-hidden="true"]');

    expect(dot).not.toBeNull();
    expect(dot?.className).toContain('bg-current');
  });
});

describe('InlineBanner', () => {
  it('uses the note role for info banners', () => {
    render(
      <InlineBanner tone="info" title="Aviso">
        Todo en orden
      </InlineBanner>,
    );

    expect(screen.getByRole('note')).not.toBeNull();
    expect(screen.getByText('Aviso').textContent).toBe('Aviso');
    expect(screen.getByText('Todo en orden').textContent).toBe('Todo en orden');
  });

  it('uses the alert role for danger banners', () => {
    render(
      <InlineBanner tone="danger" title="Error">
        Algo falló
      </InlineBanner>,
    );

    expect(screen.getByRole('alert')).not.toBeNull();
    expect(screen.getByText('Error').textContent).toBe('Error');
  });

  it('renders without title and applies className', () => {
    const { container } = render(
      <InlineBanner tone="warning" className="extra">
        Cuidado
      </InlineBanner>,
    );
    expect(container.firstElementChild?.className).toContain('extra');
    expect(screen.getByRole('alert')).not.toBeNull();
  });
});

describe('Skeleton', () => {
  it('renders the requested number of lines inside a decorative wrapper', () => {
    const { container } = render(<Skeleton lines={3} />);
    const wrapper = container.firstElementChild;

    expect(wrapper).not.toBeNull();
    expect(wrapper?.getAttribute('aria-hidden')).toBe('true');
    expect(wrapper?.children).toHaveLength(3);
  });
});

describe('EmptyState', () => {
  it('renders the title, the description and the action', () => {
    render(
      <EmptyState
        title="Sin movimientos"
        description="Aún no registras operaciones"
        action={<Button>Crear movimiento</Button>}
      />,
    );

    expect(screen.getByText('Sin movimientos').textContent).toBe('Sin movimientos');
    expect(screen.getByText('Aún no registras operaciones').textContent).toBe(
      'Aún no registras operaciones',
    );
    expect(screen.getByRole('button', { name: 'Crear movimiento' })).not.toBeNull();
  });

  it('renders without action/description when omitted', () => {
    render(<EmptyState title="Vacío" />);
    expect(screen.getByText('Vacío')).not.toBeNull();
  });
});

describe('Table', () => {
  it('renders scoped headers, cell text and a horizontal scroll wrapper', () => {
    const { container } = render(
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Cuenta</TableHeaderCell>
            <TableHeaderCell>Saldo</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow>
            <TableCell>Ahorros</TableCell>
            <TableCell>1.000</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    const headerCells = container.querySelectorAll('th');
    expect(headerCells).toHaveLength(2);
    headerCells.forEach((cell) => {
      expect(cell.getAttribute('scope')).toBe('col');
    });

    expect(screen.getByText('Ahorros').tagName).toBe('TD');
    expect(screen.getByText('Ahorros').textContent).toBe('Ahorros');
    expect(screen.getByText('1.000').textContent).toBe('1.000');
    expect(container.firstElementChild?.className).toContain('overflow-x-auto');
  });

  it('supports scope="row" on header cell and exposes region wrapper', () => {
    const { container } = render(
      <Table>
        <TableBody>
          <TableRow>
            <TableHeaderCell scope="row">Concepto</TableHeaderCell>
            <TableCell>Valor</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    const rowHeader = container.querySelector('th[scope="row"]');
    expect(rowHeader?.getAttribute('scope')).toBe('row');

    const wrapper = container.firstElementChild;
    expect(wrapper?.getAttribute('role')).toBe('region');
    expect(wrapper?.getAttribute('tabindex')).toBe('0');
  });
});
