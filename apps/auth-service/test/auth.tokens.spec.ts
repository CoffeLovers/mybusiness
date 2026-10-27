import { describe, expect, it } from 'vitest';
import { generateRefreshToken, hashRefreshToken } from '../src/auth.tokens';

describe('auth tokens', () => {
  it('genera un token opaco y guarda solo su hash SHA-256', () => {
    const before = Date.now();
    const generated = generateRefreshToken(60_000);

    expect(generated.token).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(generated.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(generated.tokenHash).toBe(hashRefreshToken(generated.token));
    expect(generated.tokenHash).not.toBe(generated.token);
    expect(generated.familyId).toMatch(/^[0-9a-f-]{36}$/);
    expect(generated.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 60_000);
  });

  it('preserva la familia al rotar y calcula el vencimiento desde now', () => {
    const now = new Date('2030-01-01T00:00:00.000Z');
    const first = generateRefreshToken(1_000, undefined, now);
    const second = generateRefreshToken(1_000, first.familyId, now);

    expect(second.familyId).toBe(first.familyId);
    expect(second.token).not.toBe(first.token);
    expect(second.expiresAt.toISOString()).toBe('2030-01-01T00:00:01.000Z');
  });

  it('rechaza TTL inválidos', () => {
    expect(() => generateRefreshToken(0)).toThrow('TTL');
    expect(() => generateRefreshToken(-1)).toThrow('TTL');
    expect(() => generateRefreshToken(1.5)).toThrow('TTL');
  });
});
