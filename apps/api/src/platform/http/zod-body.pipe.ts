import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/** Validate a request body against a Zod schema; failures surface via HttpExceptionFilter. */
@Injectable()
export class ZodBodyPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    return this.schema.parse(value);
  }
}
