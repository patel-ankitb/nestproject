import { Injectable } from '@nestjs/common';
import { verify } from 'jsonwebtoken';
import { RedisService } from './redis.service';

@Injectable()
export class JwtService {
  constructor(private readonly redisService: RedisService) {}

  async verifyAccessToken(token: string): Promise<any> {
    try {
      const decoded = verify(token, process.env.JWT_SECRET || 'secret_che');
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