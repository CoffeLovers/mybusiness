// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  Table,
  TableBody,
  TableCell,
  TableDensityToggle,
  TableHead,
  TableHeaderCell,
  TableRow,
  useTableDensity,
} from '../../components/ui/table';

describe('useTableDensity', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('devuelve "comfortable" por defecto si no hay nada guardado', () => {
    const { result } = renderHook(() => useTableDensity('test.table.density'));

    expect(result.current.density).toBe('comfortable');
  });

  it('carga la densidad persistida en localStorage', () => {
    localStorage.setItem('test.table.density', 'compact');

    const { result } = renderHook(() => useTableDensity('test.table.density'));

    expect(result.current.density).toBe('compact');
  });

  it('actualiza la densidad y la persiste en localStorage', () => {
    const { result } = renderHook(() => useTableDensity('test.table.density'));

    act(() => {
      result.current.setDensity('compact');
    });

    expect(result.current.density).toBe('compact');
    expect(localStorage.getItem('test.table.density')).toBe('compact');

    act(() => {
      result.current.setDensity('comfortable');
    });

    expect(result.current.density).toBe('comfortable');
    expect(localStorage.getItem('test.table.density')).toBe('comfortable');
  });
});

describe('TableDensityToggle', () => {
  afterEach(cleanup);

  it('renderiza con role="group" y botones accesibles con aria-pressed', () => {
    const onChange = vi.fn();
    render(<TableDensityToggle density="comfortable" onChange={onChange} />);

    const group = screen.getByRole('group', { name: 'Densidad de la tabla' });
    expect(group).not.toBeNull();

    const comfortableBtn = screen.getByRole('button', { name: 'Cómoda' });
    const compactBtn = screen.getByRole('button', { name: 'Compacta' });

    expect(comfortableBtn.getAttribute('aria-pressed')).toBe('true');
    expect(compactBtn.getAttribute('aria-pressed')).toBe('false');
  });

  it('invoca onChange al pulsar los botones', () => {
    const onChange = vi.fn();
    render(<TableDensityToggle density="comfortable" onChange={onChange} />);

    const compactBtn = screen.getByRole('button', { name: 'Compacta' });
    fireEvent.click(compactBtn);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('compact');
  });
});

describe('Table con densidad', () => {
  afterEach(cleanup);

  it('aplica clases compactas a encabezados y celdas cuando density="compact"', () => {
    render(
      <Table density="compact" label="Tabla de prueba">
        <TableHead>
          <TableRow>
            <TableHeaderCell>Columna 1</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow>
            <TableCell>Dato 1</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    const th = screen.getByRole('columnheader', { name: 'Columna 1' });
    const td = screen.getByRole('cell', { name: 'Dato 1' });

    expect(th.className).toContain('px-2');
    expect(th.className).toContain('py-1');
    expect(th.className).toContain('text-xs');

    expect(td.className).toContain('px-2');
    expect(td.className).toContain('py-1');
    expect(td.className).toContain('text-xs');
  });

  it('aplica clases cómodas cuando density="comfortable"', () => {
    render(
      <Table density="comfortable" label="Tabla de prueba">
        <TableHead>
          <TableRow>
            <TableHeaderCell>Columna 1</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow>
            <TableCell>Dato 1</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    const th = screen.getByRole('columnheader', { name: 'Columna 1' });
    const td = screen.getByRole('cell', { name: 'Dato 1' });

    expect(th.className).toContain('px-3');
    expect(th.className).toContain('py-2');
    expect(th.className).toContain('text-sm');

    expect(td.className).toContain('px-3');
    expect(td.className).toContain('py-2');
    expect(td.className).toContain('text-sm');
  });
});
