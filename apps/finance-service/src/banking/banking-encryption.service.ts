import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

@Injectable()
export class BankingEncryptionService {
  private readonly logger = new Logger(BankingEncryptionService.name);
  private readonly algorithm = 'aes-256-gcm';
  private readonly defaultKeyVersion = 'v1';
  private readonly key: Buffer;
  private readonly keyVersion: string;
  private readonly keyRing = new Map<string, Buffer>();

  constructor(private readonly configService: ConfigService) {
    this.key = this.resolveAndValidateKey();
    this.keyVersion = this.configService.get<string>(
      'BANK_ENCRYPTION_KEY_VERSION',
      this.defaultKeyVersion,
    );
    this.keyRing.set(this.keyVersion, this.key);
    this.loadKeyRing();
  }

  private loadKeyRing(): void {
    const rawRing = this.configService.get<string>('BANK_ENCRYPTION_KEY_RING');
    if (rawRing) {
      try {
        const parsed = JSON.parse(rawRing) as Record<string, string>;
        for (const [version, keyStr] of Object.entries(parsed)) {
          this.keyRing.set(version, this.parseKeyBuffer(keyStr));
        }
      } catch (err) {
        this.logger.warn(`No se pudo cargar BANK_ENCRYPTION_KEY_RING: ${(err as Error).message}`);
      }
    }
  }

  private parseKeyBuffer(rawKey: string): Buffer {
    const trimmed = rawKey?.trim();
    if (!trimmed) {
      throw new Error(
        'BANK_ENCRYPTION_KEY inválida: debe ser de 32 bytes (64 hex o base64 de 32 bytes).',
      );
    }
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      return Buffer.from(trimmed, 'hex');
    }
    if (/^[A-Za-z0-9+/]{43}=?$/.test(trimmed)) {
      const decoded = Buffer.from(trimmed, 'base64');
      if (decoded.length === 32) return decoded;
    }
    throw new Error(
      'BANK_ENCRYPTION_KEY inválida: debe ser de 32 bytes (64 hex o base64 de 32 bytes).',
    );
  }

  private resolveAndValidateKey(): Buffer {
    const rawKey = this.configService.get<string>('BANK_ENCRYPTION_KEY')?.trim();
    const nodeEnv = (this.configService.get<string>('NODE_ENV') ?? '').toLowerCase();
    const allowInsecure =
      this.configService.get<string>('BANK_ENCRYPTION_ALLOW_INSECURE_DEV_KEY') === 'true';

    if (!rawKey) {
      const fallbackAllowed = allowInsecure && (nodeEnv === 'development' || nodeEnv === 'test');

      if (fallbackAllowed) {
        this.logger.warn(
          '⚠️ Clave de cifrado insegura de DEVELOPMENT/TEST habilitada por BANK_ENCRYPTION_ALLOW_INSECURE_DEV_KEY=true. No usar en staging ni producción.',
        );
        return Buffer.from(
          '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          'hex',
        );
      }

      throw new Error(
        'BANK_ENCRYPTION_KEY es obligatoria al arrancar. Sólo se permite el fallback si NODE_ENV=development|test y BANK_ENCRYPTION_ALLOW_INSECURE_DEV_KEY=true. Genere una clave con "openssl rand -hex 32".',
      );
    }

    if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
      return Buffer.from(rawKey, 'hex');
    }

    if (/^[A-Za-z0-9+/]{43}=?$/.test(rawKey)) {
      const decoded = Buffer.from(rawKey, 'base64');
      if (decoded.length === 32) return decoded;
    }

    throw new Error(
      'BANK_ENCRYPTION_KEY inválida: debe ser de 32 bytes (64 hex o base64 de 32 bytes).',
    );
  }

  /**
   * Cifra un texto en claro (como access_token) usando AES-256-GCM con un vector de inicialización
   * aleatorio (IV de 12 bytes) y etiqueta de autenticación (AuthTag de 16 bytes).
   * NUNCA genera logs del secreto.
   */
  async encrypt(plaintext: string): Promise<{ ciphertext: string; keyVersion: string }> {
    try {
      const iv = randomBytes(12);
      const cipher = createCipheriv(this.algorithm, this.key, iv);

      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();

      const ciphertext = `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;

      return { ciphertext, keyVersion: this.keyVersion };
    } catch {
      throw new InternalServerErrorException('Error al cifrar el secreto bancario.');
    }
  }

  /**
   * Descifra el ciphertext usando AES-256-GCM.
   * Valida la integridad criptográfica mediante el authTag.
   * NUNCA genera logs del secreto descifrado.
   */
  async decrypt(ciphertext: string, keyVersion?: string): Promise<string> {
    try {
      const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':');
      if (!ivHex || !authTagHex || !encryptedHex) {
        throw new Error('Formato de ciphertext inválido.');
      }

      const version = keyVersion || this.keyVersion;
      const decryptionKey =
        this.keyRing.get(version) || (version === this.keyVersion ? this.key : undefined);
      if (!decryptionKey) {
        throw new Error(`Clave no disponible para versión: ${version}`);
      }

      const decipher = createDecipheriv(this.algorithm, decryptionKey, Buffer.from(ivHex, 'hex'));
      decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(encryptedHex, 'hex')),
        decipher.final(),
      ]);
      return decrypted.toString('utf8');
    } catch {
      throw new InternalServerErrorException('Error al descifrar el secreto bancario.');
    }
  }
}
