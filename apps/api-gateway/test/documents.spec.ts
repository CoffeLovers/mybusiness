import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Readable } from 'node:stream';
import { of } from 'rxjs';
import {
  DocumentPatterns,
  MAX_DOCUMENT_SIZE_BYTES,
  UserRole,
  type SearchDocumentsQuery,
  type UserContext,
} from '@mybusiness/contracts';
import { DocumentsController } from '../src/documents/documents.controller';
import { DocumentsService } from '../src/documents/documents.service';

const VALID_DOCUMENT_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

const user: UserContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  tenantId: '22222222-2222-4222-8222-222222222222',
  email: 'user@example.com',
  role: UserRole.ACCOUNTANT,
};

/** Archivo en memoria equivalente al que produce `memoryStorage()` de multer. */
function uploadedFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  const buffer = Buffer.from('%PDF-1.7 documento de prueba');

  return {
    fieldname: 'file',
    originalname: 'factura.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    size: buffer.length,
    buffer,
    destination: '',
    filename: '',
    path: '',
    stream: Readable.from([buffer]),
    ...overrides,
  };
}

describe('Documents Gateway Unit Tests', () => {
  let send: ReturnType<typeof vi.fn>;
  let controller: DocumentsController;
  let documentsService: DocumentsService;

  beforeEach(() => {
    send = vi.fn().mockReturnValue(of({}));
    const client = { send } as unknown as ClientProxy;
    documentsService = new DocumentsService(client);
    controller = new DocumentsController(documentsService);
  });

  describe('create', () => {
    it('propaga el contexto autenticado y el buffer en base64', () => {
      const file = uploadedFile();

      controller.create(user, file);

      expect(send).toHaveBeenCalledTimes(1);

      const [pattern, payload] = send.mock.calls[0] as [string, Record<string, unknown>];

      expect(pattern).toBe(DocumentPatterns.CREATE);
      expect(payload).toMatchObject({
        originalName: 'factura.pdf',
        mimeType: 'application/pdf',
        sizeBytes: file.size,
        buffer: file.buffer.toString('base64'),
        checksumSha256: '',
        userId: user.userId,
        tenantId: user.tenantId,
        role: user.role,
      });
      // El tenant sólo puede venir del token: el controlador no expone body.
      expect(payload.tenantId).toBe(user.tenantId);
    });

    it('rechaza MIME no permitido con BadRequestException', () => {
      const file = uploadedFile({ mimetype: 'text/plain' });

      expect(() => controller.create(user, file)).toThrow(BadRequestException);
      expect(send).not.toHaveBeenCalled();
    });

    it('rechaza la petición cuando no llega archivo', () => {
      expect(() => controller.create(user, undefined)).toThrow(BadRequestException);
      expect(send).not.toHaveBeenCalled();
    });

    // Un archivo por encima de 10 MiB se rechaza con 413. En HTTP lo aborta
    // multer (`fileSize`) antes del handler; esta comprobación mantiene el
    // mismo contrato cuando el archivo ya está materializado.
    it('rechaza archivos de más de 10 MiB con PayloadTooLargeException', () => {
      const file = uploadedFile({ size: MAX_DOCUMENT_SIZE_BYTES + 1 });

      expect(() => controller.create(user, file)).toThrow(PayloadTooLargeException);
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('get', () => {
    // La validación del UUID vive en `ParseUUIDPipe`; aquí se verifica que el
    // servicio delega el id recibido sin transformarlo.
    it('delega el id del documento al finance-service', () => {
      controller.get(user, VALID_DOCUMENT_ID);

      expect(send).toHaveBeenCalledWith(
        DocumentPatterns.GET,
        expect.objectContaining({
          documentId: VALID_DOCUMENT_ID,
          tenantId: user.tenantId,
          userId: user.userId,
        }),
      );
    });
  });

  describe('search', () => {
    it('delega q y limit al finance-service', () => {
      const query: SearchDocumentsQuery = { q: 'factura luz', limit: 5 };

      controller.search(user, query);

      expect(send).toHaveBeenCalledWith(
        DocumentPatterns.SEARCH,
        expect.objectContaining({
          q: 'factura luz',
          limit: 5,
          tenantId: user.tenantId,
        }),
      );
    });
  });

  describe('download', () => {
    it('responde 404 cuando la URL firmada no está disponible', async () => {
      send.mockReturnValue(of({ url: null }));

      const promise = controller.download(user, VALID_DOCUMENT_ID);

      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
      await expect(promise).rejects.toMatchObject({
        response: { error: 'download_unavailable' },
        status: 404,
      });
    });

    it('devuelve la URL firmada cuando existe', async () => {
      send.mockReturnValue(of({ url: 'https://storage.example/signed' }));

      await expect(controller.download(user, VALID_DOCUMENT_ID)).resolves.toEqual({
        url: 'https://storage.example/signed',
      });
    });
  });
});
