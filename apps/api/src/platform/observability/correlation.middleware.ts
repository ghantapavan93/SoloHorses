import type { NextFunction, Request, Response } from 'express';
import * as Sentry from '@sentry/nestjs';
import { acceptCorrelationId, newCorrelationId, withCorrelation } from './correlation';

/**
 * Every request runs inside a correlation context. The web app sends `x-correlation-id`
 * (one per page render or server action); anything else gets a fresh id. The id is echoed
 * back in the response so a person reading an error toast can quote it to support.
 */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const correlationId = acceptCorrelationId(req.header('x-correlation-id'));
  const requestId = newCorrelationId('req');
  res.setHeader('x-correlation-id', correlationId);
  res.setHeader('x-request-id', requestId);
  Sentry.getCurrentScope().setTag('correlation_id', correlationId);
  withCorrelation({ correlationId, requestId, causationId: requestId }, () => next());
}
