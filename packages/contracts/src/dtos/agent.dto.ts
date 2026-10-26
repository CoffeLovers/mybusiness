import { IsArray, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { ContextType } from '../enums';

export class StoreAgentMemoryDto {
  @IsString()
  @IsNotEmpty()
  content!: string;

  @IsEnum(ContextType)
  contextType!: ContextType;

  @IsArray()
  @IsOptional()
  embedding?: number[];

  @IsOptional()
  metadata?: Record<string, any>;
}

export class QueryAgentMemoryDto {
  @IsString()
  @IsNotEmpty()
  queryText!: string;

  @IsArray()
  @IsOptional()
  queryEmbedding?: number[];

  @IsNumber()
  @IsOptional()
  topK?: number;
}
