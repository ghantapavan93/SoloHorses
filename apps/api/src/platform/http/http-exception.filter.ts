import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { currentCorrelationId } from '../observability/correlation';

/**
 * One error shape for the UI: { status, code, message, details? }.
 * Zod validation failures become 400s with field paths; everything unexpected is a 500 with
 * no internals leaked.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Every error carries the correlation id so a person can quote it and support can find the trace.
    const correlationId =
      currentCorrelationId() ?? (response.getHeader('x-correlation-id') as string | undefined) ?? null;

    if (exception instanceof ZodError) {
      response.status(HttpStatus.BAD_REQUEST).json({
        status: 400,
        code: 'VALIDATION',
        message: 'Request did not match the expected shape.',
        details: exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        path: request.url,
        correlationId,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const shaped =
        typeof body === 'object' && body !== null
          ? (body as { message?: string | string[]; code?: string; evidenceIds?: string[] })
          : null;
      const message = typeof body === 'string' ? body : (shaped?.message ?? exception.message);
      // A rule's own code (SETTLEMENT_PROCESSING, INVALID_PAYMENT_TRANSITION…) outranks the HTTP class name.
      const code =
        shaped?.code ?? (status === 429 ? 'RATE_LIMITED' : exception.name.replace(/Exception$/, '').toUpperCase());
      response.status(status).json({
        status,
        code,
        message,
        ...(shaped?.evidenceIds ? { evidenceIds: shaped.evidenceIds } : {}),
        path: request.url,
        correlationId,
      });
      return;
    }

    // Unknown errors are logged here with their stack; clients get a reference-free 500.
    this.logger.error(
      `${request.method} ${request.url} [${correlationId ?? '-'}] → ${(exception as Error).message}`,
      (exception as Error).stack,
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      status: 500,
      code: 'INTERNAL',
      message: 'Something went wrong on our side.',
      path: request.url,
      correlationId,
    });
  }
}
