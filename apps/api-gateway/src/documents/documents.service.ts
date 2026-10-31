import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import type { Observable } from 'rxjs';
import {
  DocumentPatterns,
  type DocumentResponse,
  type DocumentSearchResult,
  type SearchDocumentsQuery,
  type UserContext,
} from '@mybusiness/contracts';
import { rpcSend } from '@mybusiness/common';

/** Payload de subida que el gateway envía al finance-service (binario en base64). */
export interface CreateDocumentPayload {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  buffer: string;
  checksumSha256: string;
}

/**
 * Proxy RPC hacia el dominio de documentos del finance-service.
 *
 * La identidad se toma siempre del `UserContext` autenticado: ningún método
 * acepta `tenantId`/`userId` provenientes del cuerpo de la petición.
 */
@Injectable()
export class DocumentsService {
  constructor(@Inject('FINANCE_SERVICE') private readonly financeClient: ClientProxy) {}

  create(user: UserContext, payload: CreateDocumentPayload): Observable<DocumentResponse> {
    return rpcSend<DocumentResponse>(this.financeClient, DocumentPatterns.CREATE, {
      ...payload,
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  }

  get(user: UserContext, documentId: string): Observable<DocumentResponse> {
    return rpcSend<DocumentResponse>(this.financeClient, DocumentPatterns.GET, {
      documentId,
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  }

  search(user: UserContext, query: SearchDocumentsQuery): Observable<DocumentSearchResult[]> {
    return rpcSend<DocumentSearchResult[]>(this.financeClient, DocumentPatterns.SEARCH, {
      q: query.q,
      limit: query.limit,
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  }

  getDownloadUrl(user: UserContext, documentId: string): Observable<{ url: string | null }> {
    return rpcSend<{ url: string | null }>(this.financeClient, DocumentPatterns.DOWNLOAD_URL, {
      documentId,
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });
  }
}
