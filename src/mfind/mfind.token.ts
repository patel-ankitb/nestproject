import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class TokenGuard implements CanActivate {
  private readonly API_TOKEN = process.env.API_TOKEN || 'mySecretToken123';

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }

    const token = authHeader.replace('Bearer ', '').trim();

    if (token !== this.API_TOKEN) {
      throw new UnauthorizedException('Invalid token');
    }

    return true;
  }
}
