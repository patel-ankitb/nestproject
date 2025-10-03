import { Injectable } from '@nestjs/common';
import { verify } from 'jsonwebtoken';
import { RedisService } from './redis.service';

@Injectable()
export class JwtService {
  private readonly JWT_SECRET: string = process.env.JWT_SECRET || 'secret_che';

  constructor(private readonly redisService: RedisService) {}

  async verifyAccessToken(token: string): Promise<any> {
    try {

      const decoded = verify(token, this.JWT_SECRET);

      const isBlacklisted = await this.redisService.isTokenBlacklisted(token);

      if (isBlacklisted) {
        return null;
      }

      return decoded;
    } catch (err) {
      return null;
    }
  }
}