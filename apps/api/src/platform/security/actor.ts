import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Actor } from '@daysheet/domain';
import type { Request } from 'express';

export interface RequestWithActor extends Request {
  actor?: Actor;
}

/** The authenticated actor, attached by JwtAuthGuard. Route handlers never touch the token. */
export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => {
  const request = ctx.switchToHttp().getRequest<RequestWithActor>();
  if (!request.actor) {
    throw new Error('CurrentActor used on a route without JwtAuthGuard');
  }
  return request.actor;
});
