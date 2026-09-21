import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Actor, Role } from '@daysheet/domain';
import { EnvService } from '../config/env.module';
import type { RequestWithActor } from './actor';
import { JwtVerifyError, verifyHs256 } from './hs256';

export const IS_PUBLIC = 'isPublic';
/** Marks a route that needs no session — health, webhooks (which verify their own signatures). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

const ROLES: readonly Role[] = ['ADMIN', 'STALLION_OFFICE', 'RECIPS', 'VET', 'BILLING', 'CUSTOMER'];

/**
 * The web app is the only client. For each request it mints a short-lived HS256 token signed
 * with the shared AUTH_SECRET carrying the session's user id, role and customer scope.
 * The browser never holds this token.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly secret: string;

  constructor(
    private readonly reflector: Reflector,
    envService: EnvService,
  ) {
    this.secret = envService.env.AUTH_SECRET;
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithActor>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('missing bearer token');

    let payload;
    try {
      payload = verifyHs256(header.slice(7), this.secret, { issuer: 'daysheet-web', audience: 'daysheet-api' });
    } catch (error) {
      throw new UnauthorizedException(error instanceof JwtVerifyError ? error.message : 'invalid token');
    }
    const role = payload['role'];
    if (typeof role !== 'string' || !ROLES.includes(role as Role)) throw new UnauthorizedException('malformed token');
    const customerId = payload['customerId'];
    const actor: Actor = {
      userId: payload.sub,
      role: role as Role,
      customerId: typeof customerId === 'string' ? customerId : null,
    };
    request.actor = actor;
    return true;
  }
}
