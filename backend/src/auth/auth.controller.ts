import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { LoginDto } from './dto/login.dto.js';
import { AuthService, type AuthenticatedRequest } from './auth.service.js';
import { Public } from './auth.guard.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!this.auth.isConfigured) {
      throw new ServiceUnavailableException('Administrator authentication is not configured on the server.');
    }
    const valid = await this.auth.verifyCredentials(body.username, body.password);
    if (!valid) {
      throw new UnauthorizedException('Invalid username or password.');
    }
    const session = await this.auth.signSession(body.username);
    this.auth.attachSession(res, session.token, session.expiresAt);
    return {
      ok: true,
      user: { username: body.username },
      expiresAt: new Date(session.expiresAt).toISOString(),
    };
  }

  @Get('me')
  me(@Req() req: AuthenticatedRequest) {
    return { user: { username: req.session!.username } };
  }

  @Public()
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    this.auth.clearSession(res);
    return { ok: true };
  }
}