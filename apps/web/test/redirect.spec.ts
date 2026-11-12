import { describe, expect, it } from 'vitest';

import { DEFAULT_REDIRECT, DEEP_LINK_REDIRECT, resolveReturnTo } from '../lib/banking/redirect';

describe('resolveReturnTo', () => {
  it('conserva el deep link nativo literalmente', () => {
    expect(resolveReturnTo(DEEP_LINK_REDIRECT)).toBe('mybusiness://banking/return');
  });

  it('conserva rutas internas de bancos con query', () => {
    expect(resolveReturnTo('/bancos?x=1')).toBe('/bancos?x=1');
    expect(resolveReturnTo('/bancos')).toBe('/bancos');
  });

  it('rechaza rutas protocol-relative', () => {
    expect(resolveReturnTo('//evil.com')).toBe(DEFAULT_REDIRECT);
    expect(resolveReturnTo('//evil.com/bancos')).toBe(DEFAULT_REDIRECT);
  });

  it('rechaza URLs absolutas', () => {
    expect(resolveReturnTo('https://evil.com')).toBe(DEFAULT_REDIRECT);
    expect(resolveReturnTo('https://evil.com/bancos')).toBe(DEFAULT_REDIRECT);
  });

  it('usa el destino por defecto cuando falta o es desconocido', () => {
    expect(resolveReturnTo(undefined)).toBe(DEFAULT_REDIRECT);
    expect(resolveReturnTo('')).toBe(DEFAULT_REDIRECT);
    expect(resolveReturnTo('/dashboard')).toBe(DEFAULT_REDIRECT);
    expect(resolveReturnTo('mybusiness://banking/other')).toBe(DEFAULT_REDIRECT);
  });
});
