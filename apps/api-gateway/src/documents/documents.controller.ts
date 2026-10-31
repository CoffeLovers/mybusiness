import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  PayloadTooLargeException,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { firstValueFrom } from 'rxjs';
import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  MAX_DOCUMENT_SIZE_BYTES,
  SearchDocumentsQuery,
  type UserContext,
} from '@mybusiness/contracts';
import { CurrentUser } from '@mybusiness/common';
import { DocumentsService } from './documents.service';

const mimetypes: readonly string[] = ALLOWED_DOCUMENT_MIME_TYPES;

@ApiTags('Documents')
@ApiBearerAuth()
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  /**
   * Subida multipart. El binario se mantiene en memoria (límite 10 MiB, un
   * único archivo) y se serializa en base64 para el RPC.
   *
   * El límite de multer aborta antes de llegar al handler; la comprobación
   * explícita de `size` mantiene el mismo contrato cuando el archivo ya está
   * materializado (por ejemplo, en tests o con otro adaptador HTTP).
   */
  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_DOCUMENT_SIZE_BYTES, files: 1 },
      fileFilter: (_req, file, cb) => cb(null, mimetypes.includes(file.mimetype)),
    }),
  )
  create(@CurrentUser() user: UserContext, @UploadedFile() file?: Express.Multer.File) {
    if (!file || !mimetypes.includes(file.mimetype)) {
      throw new BadRequestException('Archivo no permitido');
    }

    if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
      throw new PayloadTooLargeException('El archivo supera el límite de 10 MiB');
    }

    return this.documentsService.create(user, {
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      buffer: file.buffer.toString('base64'),
      checksumSha256: '',
    });
  }

  @Get('search')
  search(
    @CurrentUser() user: UserContext,
    @Query(new ValidationPipe({ transform: true, whitelist: true })) query: SearchDocumentsQuery,
  ) {
    return this.documentsService.search(user, query);
  }

  @Get(':id')
  get(@CurrentUser() user: UserContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.documentsService.get(user, id);
  }

  @Get(':id/download')
  async download(@CurrentUser() user: UserContext, @Param('id', ParseUUIDPipe) id: string) {
    const { url } = await firstValueFrom(this.documentsService.getDownloadUrl(user, id));

    if (!url) {
      throw new NotFoundException({ error: 'download_unavailable' });
    }

    return { url };
  }
}
