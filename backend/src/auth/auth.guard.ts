import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService, type AuthenticatedRequest, type SessionPayload } from './auth.service.js';

export const IS_PUBLIC_KEY = 'isPublic';
/** Marks a route as publicly reachable (bypasses the global auth guard). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.auth.readSessionToken(request as Request);
    const session: SessionPayload | null = this.auth.parseSession(token);
    if (!session) {
      throw new UnauthorizedException('Authentication required.');
    }
    request.session = session;
    return true;
  }
}