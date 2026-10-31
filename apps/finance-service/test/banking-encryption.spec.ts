import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { BankingEncryptionService } from '../src/banking/banking-encryption.service';

describe('BankingEncryptionService (SEC-03)', () => {
  it('1. Sin clave y sin flag: el constructor lanza /BANK_ENCRYPTION_KEY/', () => {
    const config = new ConfigService({});
    expect(() => new BankingEncryptionService(config)).toThrow(/BANK_ENCRYPTION_KEY/);
  });

  it('2. NODE_ENV=development + flag true: construye y hace round-trip encrypt/decrypt', async () => {
    const config = new ConfigService({
      NODE_ENV: 'development',
      BANK_ENCRYPTION_ALLOW_INSECURE_DEV_KEY: 'true',
    });
    const service = new BankingEncryptionService(config);
    const plaintext = 'token-dev-secret-123';
    const enc = await service.encrypt(plaintext);
    expect(enc.ciphertext).toBeDefined();
    expect(enc.ciphertext).not.toContain(plaintext);
    const dec = await service.decrypt(enc.ciphertext, enc.keyVersion);
    expect(dec).toBe(plaintext);
  });

  it('3. NODE_ENV=development sin flag: lanza', () => {
    const config = new ConfigService({
      NODE_ENV: 'development',
    });
    expect(() => new BankingEncryptionService(config)).toThrow(/BANK_ENCRYPTION_KEY/);
  });

  it('4. NODE_ENV=test + flag true: construye y hace round-trip', async () => {
    const config = new ConfigService({
      NODE_ENV: 'test',
      BANK_ENCRYPTION_ALLOW_INSECURE_DEV_KEY: 'true',
    });
    const service = new BankingEncryptionService(config);
    const plaintext = 'token-test-secret-456';
    const enc = await service.encrypt(plaintext);
    const dec = await service.decrypt(enc.ciphertext, enc.keyVersion);
    expect(dec).toBe(plaintext);
  });

  it('5. NODE_ENV=production + flag true: lanza', () => {
    const config = new ConfigService({
      NODE_ENV: 'production',
      BANK_ENCRYPTION_ALLOW_INSECURE_DEV_KEY: 'true',
    });
    expect(() => new BankingEncryptionService(config)).toThrow(/BANK_ENCRYPTION_KEY/);
  });

  it('6. NODE_ENV=staging + flag true: lanza', () => {
    const config = new ConfigService({
      NODE_ENV: 'staging',
      BANK_ENCRYPTION_ALLOW_INSECURE_DEV_KEY: 'true',
    });
    expect(() => new BankingEncryptionService(config)).toThrow(/BANK_ENCRYPTION_KEY/);
  });

  it('7. NODE_ENV no definido + flag true: lanza (fail-safe)', () => {
    const originalEnv = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try {
      const config = new ConfigService({
        BANK_ENCRYPTION_ALLOW_INSECURE_DEV_KEY: 'true',
      });
      expect(() => new BankingEncryptionService(config)).toThrow(/BANK_ENCRYPTION_KEY/);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('8. Clave hex de 64 chars: round-trip correcto y keyVersion respeta BANK_ENCRYPTION_KEY_VERSION', async () => {
    const hexKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const config = new ConfigService({
      BANK_ENCRYPTION_KEY: hexKey,
      BANK_ENCRYPTION_KEY_VERSION: 'v2',
    });
    const service = new BankingEncryptionService(config);
    const plaintext = 'access-token-hex-test';
    const enc = await service.encrypt(plaintext);
    expect(enc.keyVersion).toBe('v2');
    const dec = await service.decrypt(enc.ciphertext, enc.keyVersion);
    expect(dec).toBe(plaintext);
  });

  it('9. Clave base64 de 32 bytes: round-trip correcto', async () => {
    const b64Key = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
    const config = new ConfigService({
      BANK_ENCRYPTION_KEY: b64Key,
      BANK_ENCRYPTION_KEY_VERSION: 'v3',
    });
    const service = new BankingEncryptionService(config);
    const plaintext = 'access-token-b64-test';
    const enc = await service.encrypt(plaintext);
    expect(enc.keyVersion).toBe('v3');
    const dec = await service.decrypt(enc.ciphertext, enc.keyVersion);
    expect(dec).toBe(plaintext);
  });

  it('10. Clave con longitud inválida (p. ej. "short-key"): lanza /inválida/', () => {
    const invalidKeys = [
      'short-key',
      '0123456789abcdef',
      'g'.repeat(64),
      '0'.repeat(63),
      'passphrase-no-hex-ni-base64-de-32-bytes',
    ];
    for (const key of invalidKeys) {
      const config = new ConfigService({
        BANK_ENCRYPTION_KEY: key,
      });
      expect(() => new BankingEncryptionService(config)).toThrow(/inválida/);
    }
  });

  it('11. Ciphertext manipulado: decrypt lanza (regresión)', async () => {
    const config = new ConfigService({
      BANK_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    });
    const service = new BankingEncryptionService(config);
    const plaintext = 'access-sandbox-original';
    const enc = await service.encrypt(plaintext);

    const parts = enc.ciphertext.split(':');
    parts[2] = (parts[2].startsWith('aa') ? 'bb' : 'aa') + parts[2].slice(2);
    const tampered = parts.join(':');

    await expect(service.decrypt(tampered, enc.keyVersion)).rejects.toThrow();
  });

  it('12. BANK_ENCRYPTION_KEY vacía ("" o espacios) se trata como ausente', () => {
    for (const emptyKey of ['', '   ', '\t\n']) {
      const config = new ConfigService({
        BANK_ENCRYPTION_KEY: emptyKey,
      });
      expect(() => new BankingEncryptionService(config)).toThrow(/BANK_ENCRYPTION_KEY/);
    }
  });

  it('debe permitir rotación con BANK_ENCRYPTION_KEY_RING y descifrar versiones anteriores', async () => {
    const keyV1 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const keyV2 = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

    const serviceV1 = new BankingEncryptionService(
      new ConfigService({
        BANK_ENCRYPTION_KEY: keyV1,
        BANK_ENCRYPTION_KEY_VERSION: 'v1',
      }),
    );
    const encV1 = await serviceV1.encrypt('secret-v1');

    const serviceV2 = new BankingEncryptionService(
      new ConfigService({
        BANK_ENCRYPTION_KEY: keyV2,
        BANK_ENCRYPTION_KEY_VERSION: 'v2',
        BANK_ENCRYPTION_KEY_RING: JSON.stringify({ v1: keyV1, v2: keyV2 }),
      }),
    );

    expect(await serviceV2.decrypt(encV1.ciphertext, 'v1')).toBe('secret-v1');
    const encV2 = await serviceV2.encrypt('secret-v2');
    expect(await serviceV2.decrypt(encV2.ciphertext, 'v2')).toBe('secret-v2');
  });
});
