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
    if (rawKey.length === 64 && /^[0-9a-fA-F]{64}$/.test(rawKey)) {
      return Buffer.from(rawKey, 'hex');
    }
    if (/^[A-Za-z0-9+/=_-]{43,44}$/.test(rawKey)) {
      const b64Buf = Buffer.from(rawKey, 'base64');
      if (b64Buf.length === 32) {
        return b64Buf;
      }
    }
    throw new Error('Clave inválida: debe ser de 32 bytes (64 hex o base64).');
  }

  private resolveAndValidateKey(): Buffer {
    const rawKey = this.configService.get<string>('BANK_ENCRYPTION_KEY');
    const allowInsecureDevKey =
      this.configService.get<string>('BANK_ENCRYPTION_ALLOW_INSECURE_DEV_KEY') === 'true';
    const nodeEnv = (this.configService.get<string>('NODE_ENV') || 'development').toLowerCase();
    const forbiddenEnvs = ['production', 'staging', 'prod', 'preprod'];

    if (!rawKey) {
      if (allowInsecureDevKey && !forbiddenEnvs.includes(nodeEnv)) {
        this.logger.warn(
          '⚠️ ALERTA DE SEGURIDAD: BANK_ENCRYPTION_KEY no configurada. Usando clave de desarrollo insegura porque BANK_ENCRYPTION_ALLOW_INSECURE_DEV_KEY=true en entorno no productivo.',
        );
        return Buffer.from(
          '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          'hex',
        );
      }

      throw new Error(
        'BANK_ENCRYPTION_KEY es obligatoria al arrancar la aplicación. Configure una clave de 32 bytes (64 caracteres hex con "openssl rand -hex 32").',
      );
    }

    if (rawKey.length === 64 && /^[0-9a-fA-F]{64}$/.test(rawKey)) {
      return Buffer.from(rawKey, 'hex');
    }

    if (/^[A-Za-z0-9+/=_-]{43,44}$/.test(rawKey)) {
      const b64Buf = Buffer.from(rawKey, 'base64');
      if (b64Buf.length === 32) {
        return b64Buf;
      }
    }

    throw new Error(
      'BANK_ENCRYPTION_KEY inválida: debe ser exactamente de 32 bytes (64 caracteres hexadecimales o base64 de 32 bytes). Derivación por hash o claves de longitud incorrecta no están permitidas.',
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
      const parts = ciphertext.split(':');
      if (parts.length !== 3) {
        throw new Error('Formato de ciphertext inválido.');
      }

      const version = keyVersion || this.keyVersion;
      const decryptionKey =
        this.keyRing.get(version) || (version === this.keyVersion ? this.key : undefined);
      if (!decryptionKey) {
        throw new Error(`Clave no disponible para versión: ${version}`);
      }

      const [ivHex, authTagHex, encryptedHex] = parts;
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      const encrypted = Buffer.from(encryptedHex, 'hex');

      const decipher = createDecipheriv(this.algorithm, decryptionKey, iv);
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      return decrypted.toString('utf8');
    } catch {
      throw new InternalServerErrorException('Error al descifrar el secreto bancario.');
    }
  }
}
