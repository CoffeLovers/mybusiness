import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

@Injectable()
export class BankingEncryptionService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly defaultKeyVersion = 'v1';

  constructor(private readonly configService: ConfigService) {}

  private getEncryptionKey(): Buffer {
    const rawKey = this.configService.get<string>('BANK_ENCRYPTION_KEY');
    if (!rawKey) {
      // En desarrollo / sandbox si no está configurada, derivamos una clave reproducible local
      const isProd = this.configService.get<string>('NODE_ENV') === 'production';
      if (isProd) {
        throw new InternalServerErrorException(
          'BANK_ENCRYPTION_KEY es obligatoria en entornos productivos.',
        );
      }
      return createHash('sha256').update('mybusiness_dev_banking_encryption_fallback_key').digest();
    }

    if (rawKey.length === 64 && /^[0-9a-fA-F]+$/.test(rawKey)) {
      return Buffer.from(rawKey, 'hex');
    }

    return createHash('sha256').update(rawKey, 'utf8').digest();
  }

  private getKeyVersion(): string {
    return this.configService.get<string>('BANK_ENCRYPTION_KEY_VERSION', this.defaultKeyVersion);
  }

  /**
   * Cifra un texto en claro (como access_token) usando AES-256-GCM con un vector de inicialización
   * aleatorio (IV de 12 bytes) y etiqueta de autenticación (AuthTag de 16 bytes).
   * NUNCA genera logs del secreto.
   */
  async encrypt(plaintext: string): Promise<{ ciphertext: string; keyVersion: string }> {
    try {
      const key = this.getEncryptionKey();
      const iv = randomBytes(12);
      const cipher = createCipheriv(this.algorithm, key, iv);

      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();

      const ciphertext = `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
      const keyVersion = this.getKeyVersion();

      return { ciphertext, keyVersion };
    } catch {
      throw new InternalServerErrorException('Error al cifrar el secreto bancario.');
    }
  }

  /**
   * Descifra el ciphertext usando AES-256-GCM.
   * Valida la integridad criptográfica mediante el authTag.
   * NUNCA genera logs del secreto descifrado.
   */
  async decrypt(ciphertext: string, _keyVersion?: string): Promise<string> {
    try {
      const parts = ciphertext.split(':');
      if (parts.length !== 3) {
        throw new Error('Formato de ciphertext inválido.');
      }

      const [ivHex, authTagHex, encryptedHex] = parts;
      const key = this.getEncryptionKey();
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      const encrypted = Buffer.from(encryptedHex, 'hex');

      const decipher = createDecipheriv(this.algorithm, key, iv);
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      return decrypted.toString('utf8');
    } catch {
      throw new InternalServerErrorException('Error al descifrar el secreto bancario.');
    }
  }
}
