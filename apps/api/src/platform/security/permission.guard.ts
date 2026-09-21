import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { can, type Action, type Resource } from '@daysheet/domain';
import type { RequestWithActor } from './actor';

export const REQUIRES = 'requires';

export interface Requirement {
  action: Action;
  resource: Resource;
}

/** Declares what a route needs; the matrix in @daysheet/domain decides. */
export const Requires = (action: Action, resource: Resource): MethodDecorator =>
  SetMetadata(REQUIRES, { action, resource } satisfies Requirement);

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requirement = this.reflector.get<Requirement | undefined>(REQUIRES, context.getHandler());
    if (!requirement) return true;
    const { actor } = context.switchToHttp().getRequest<RequestWithActor>();
    if (!actor) return false;
    if (!can(actor, requirement.action, requirement.resource)) {
      throw new ForbiddenException(`${actor.role} may not ${requirement.action} ${requirement.resource}`);
    }
    return true;
  }
}
