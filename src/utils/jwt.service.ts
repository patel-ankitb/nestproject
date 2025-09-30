import { Injectable } from '@nestjs/common';
import { verify } from 'jsonwebtoken';
import { RedisService } from './redis.service';

@Injectable()
export class JwtService {
  private readonly JWT_SECRET: string = process.env.JWT_SECRET || 'secret_che';

  constructor(private readonly redisService: RedisService) {}

  async verifyAccessToken(token: string): Promise<any> {
    try {
      console.log("verifyAccessToken 1");

      const decoded = verify(token, this.JWT_SECRET);
      console.log("verifyAccessToken 2");

      // const isBlacklisted = await this.redisService.isTokenBlacklisted(token);
      console.log("verifyAccessToken 3");

      if (isBlacklisted) {
        return null;
      }
      console.log("verifyAccessToken 4");

      return decoded;
    } catch (err) {
      console.log(err,"err");
      return null;
    }
  }
}