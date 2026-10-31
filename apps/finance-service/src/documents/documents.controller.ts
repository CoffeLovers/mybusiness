import { BadRequestException, Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  DocumentPatterns,
  type CreateDocumentDto,
  type DocumentOcrJobData,
  type DocumentSearchRpcPayload,
  type DocumentUploadRpcPayload,
  type GetDocumentRpcPayload,
} from '@mybusiness/contracts';
import { extractRpcContext, stripRpcContext } from '@mybusiness/common';
import { DocumentsService } from './documents.service';

/** El binario llega ya serializado desde el gateway (Buffer o base64). */
type DocumentCreatePayload = DocumentUploadRpcPayload & { buffer?: Buffer | string };

type DocumentDownloadUrlPayload = GetDocumentRpcPayload & { expiresInSeconds?: number };

@Controller()
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @MessagePattern(DocumentPatterns.CREATE)
  create(@Payload() data: DocumentCreatePayload) {
    const ctx = extractRpcContext(data);
    const { buffer, ...rest } = stripRpcContext(data);

    const bytes = typeof buffer === 'string' ? Buffer.from(buffer, 'base64') : buffer;
    if (!bytes) {
      throw new BadRequestException('El documento requiere un buffer');
    }

    return this.documentsService.create(ctx, {
      ...(rest as CreateDocumentDto),
      buffer: bytes,
    });
  }

  @MessagePattern(DocumentPatterns.GET)
  get(@Payload() data: GetDocumentRpcPayload) {
    const ctx = extractRpcContext(data);
    const { documentId } = stripRpcContext(data);
    return this.documentsService.get(ctx, documentId);
  }

  @MessagePattern(DocumentPatterns.SEARCH)
  search(@Payload() data: DocumentSearchRpcPayload) {
    const ctx = extractRpcContext(data);
    const { q, limit } = stripRpcContext(data);
    return this.documentsService.search(ctx, q, limit);
  }

  @MessagePattern(DocumentPatterns.DOWNLOAD_URL)
  getDownloadUrl(@Payload() data: DocumentDownloadUrlPayload) {
    const ctx = extractRpcContext(data);
    const { documentId, expiresInSeconds } = stripRpcContext(data);
    return this.documentsService.getDownloadUrl(ctx, documentId, expiresInSeconds);
  }

  /** Permite disparar el OCR manualmente en pruebas; en producción lo hace el worker. */
  @MessagePattern(DocumentPatterns.PROCESS_OCR)
  processOcr(@Payload() data: DocumentOcrJobData) {
    return this.documentsService.processOcr(data);
  }
}
