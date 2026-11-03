/**
 * Contrato de `parseLedgerQuery` y `ledgerQueryToSearchParams`.
 *
 * El parseo nunca lanza: todo valor inválido cae a un default o se descarta.
 * Esta suite fija esa promesa (whitelists, rangos y fechas) y la estabilidad de
 * la serialización, que es la base de las URLs cacheables del libro mayor.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LEDGER_QUERY,
  ledgerQueryToSearchParams,
  parseLedgerQuery,
} from '../lib/ledger/query';

const VALID_UUID = '3f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b';

/** Construye `URLSearchParams` desde un objeto, como llegaría de la URL. */
function params(entries: Record<string, string>): URLSearchParams {
  return new URLSearchParams(entries);
}

describe('parseLedgerQuery – defaults y rangos', () => {
  it('sin parámetros devuelve exactamente los defaults declarados', () => {
    expect(parseLedgerQuery(params({}))).toEqual(DEFAULT_LEDGER_QUERY);
    expect(DEFAULT_LEDGER_QUERY).toEqual({
      page: 1,
      pageSize: 50,
      sortBy: 'date',
      sortDir: 'desc',
    });
  });

  it('acepta page y pageSize dentro de rango', () => {
    expect(parseLedgerQuery(params({ page: '3', pageSize: '200' }))).toMatchObject({
      page: 3,
      pageSize: 200,
    });
    expect(parseLedgerQuery(params({ page: '1', pageSize: '10' })).pageSize).toBe(10);
  });

  it('rechaza page < 1 y pageSize fuera de 10..200', () => {
    for (const page of ['0', '-5', 'abc']) {
      expect(parseLedgerQuery(params({ page })).page).toBe(1);
    }

    for (const pageSize of ['9', '201', '0', '-10', 'muchas']) {
      expect(parseLedgerQuery(params({ pageSize })).pageSize).toBe(50);
    }
  });

  it('cae al default cuando sortBy o sortDir no pertenecen a la whitelist', () => {
    expect(parseLedgerQuery(params({ sortBy: 'merchantName' }))).toMatchObject({
      sortBy: 'date',
      sortDir: 'desc',
    });
    expect(parseLedgerQuery(params({ sortDir: 'sideways' }))).toMatchObject({
      sortBy: 'date',
      sortDir: 'desc',
    });
    expect(parseLedgerQuery(params({ sortBy: 'amount', sortDir: 'asc' }))).toMatchObject({
      sortBy: 'amount',
      sortDir: 'asc',
    });
  });
});

describe('parseLedgerQuery – fechas, texto y filtros', () => {
  it('descarta fechas con formato o día imposibles', () => {
    const query = parseLedgerQuery(
      params({ from: '2026-13-01', to: '2026-02-30', sortBy: 'date' }),
    );

    expect(query.from).toBeUndefined();
    expect(query.to).toBeUndefined();
    expect(parseLedgerQuery(params({ from: '2026-01-15', to: '2026-01-31' }))).toMatchObject({
      from: '2026-01-15',
      to: '2026-01-31',
    });
  });

  it('si from > to descarta ambas fechas para no enviar un rango imposible', () => {
    const query = parseLedgerQuery(params({ from: '2026-05-01', to: '2026-04-01' }));

    expect(query.from).toBeUndefined();
    expect(query.to).toBeUndefined();
  });

  it('conserva from == to (un único día es un rango válido)', () => {
    expect(parseLedgerQuery(params({ from: '2026-05-01', to: '2026-05-01' }))).toMatchObject({
      from: '2026-05-01',
      to: '2026-05-01',
    });
  });

  it('recorta q y descarta el texto que supera 200 caracteres', () => {
    expect(parseLedgerQuery(params({ q: '  nómina  ' })).q).toBe('nómina');
    expect(parseLedgerQuery(params({ q: '   ' })).q).toBeUndefined();
    expect(parseLedgerQuery(params({ q: 'a'.repeat(200) })).q).toHaveLength(200);
    // Documentado: por encima del máximo se descarta (no se trunca) para no
    // alterar silenciosamente el significado de la búsqueda.
    expect(parseLedgerQuery(params({ q: 'a'.repeat(201) })).q).toBeUndefined();
  });

  it('acepta sólo estados de conciliación conocidos', () => {
    expect(
      parseLedgerQuery(params({ reconciliationStatus: 'NEEDS_REVIEW' })).reconciliationStatus,
    ).toBe('NEEDS_REVIEW');
    expect(
      parseLedgerQuery(params({ reconciliationStatus: 'PENDING' })).reconciliationStatus,
    ).toBeUndefined();
  });

  it('conserva accountId UUID y descarta cualquier otra forma', () => {
    expect(parseLedgerQuery(params({ accountId: VALID_UUID })).accountId).toBe(VALID_UUID);
    expect(parseLedgerQuery(params({ accountId: 'not-a-uuid' })).accountId).toBeUndefined();
    expect(
      parseLedgerQuery(params({ accountId: `${VALID_UUID}-extra` })).accountId,
    ).toBeUndefined();
  });

  it('lee el primer valor cuando el parámetro llega como array', () => {
    expect(
      parseLedgerQuery({ page: ['4'], sortBy: ['name'], accountId: [VALID_UUID] }),
    ).toMatchObject({ page: 4, sortBy: 'name', accountId: VALID_UUID });
  });
});

describe('ledgerQueryToSearchParams', () => {
  it('omite los campos opcionales vacíos', () => {
    const serialized = ledgerQueryToSearchParams(DEFAULT_LEDGER_QUERY);

    expect(serialized.toString()).toBe('page=1&pageSize=50&sortBy=date&sortDir=desc');
    expect(serialized.has('q')).toBe(false);
    expect(serialized.has('accountId')).toBe(false);
  });

  it('serializa en orden estable e incluye sólo valores con contenido', () => {
    const serialized = ledgerQueryToSearchParams({
      page: 2,
      pageSize: 100,
      sortBy: 'amount',
      sortDir: 'asc',
      from: '2026-01-01',
      to: '2026-01-31',
      q: 'nómina',
      category: 'Oficina',
      reconciliationStatus: 'AUTO_MATCHED',
      accountId: VALID_UUID,
    });

    expect(serialized.toString()).toBe(
      'page=2&pageSize=100&sortBy=amount&sortDir=asc&from=2026-01-01&to=2026-01-31' +
        '&q=n%C3%B3mina&category=Oficina&reconciliationStatus=AUTO_MATCHED' +
        `&accountId=${VALID_UUID}`,
    );
  });

  it('es idempotente: parse -> serialize -> parse devuelve la misma consulta', () => {
    const original = parseLedgerQuery(
      params({
        page: '7',
        pageSize: '25',
        sortBy: 'category',
        sortDir: 'asc',
        from: '2026-01-01',
        to: '2026-12-31',
        q: 'oficina',
        category: 'Oficina',
        reconciliationStatus: 'MANUAL_MATCHED',
        accountId: VALID_UUID,
      }),
    );

    const roundTripped = parseLedgerQuery(ledgerQueryToSearchParams(original));
    const serializedAgain = ledgerQueryToSearchParams(roundTripped);

    expect(roundTripped).toEqual(original);
    expect(serializedAgain.toString()).toBe(ledgerQueryToSearchParams(original).toString());
  });

  it('una consulta con defaults también es estable al ida y vuelta', () => {
    const original = parseLedgerQuery(params({ sortBy: 'invalid', pageSize: '5' }));
    const roundTripped = parseLedgerQuery(ledgerQueryToSearchParams(original));

    expect(roundTripped).toEqual(original);
  });
});
