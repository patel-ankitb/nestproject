import { Injectable, Logger } from '@nestjs/common';
import { createClient } from 'redis';

@Injectable()
export class RedisService {
  private readonly redisClient: ReturnType<typeof createClient>;
  private readonly logger = new Logger(RedisService.name);

  constructor() {
    this.redisClient = createClient({
      url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`,
      password: process.env.REDIS_PASSWORD || undefined,
    });

    this.redisClient.connect().catch((err) => {
      this.logger.error('Failed to connect to Redis', err);
    });
  }

  async isTokenBlacklisted(token: string): Promise<boolean> {
    const result = await this.redisClient.get(token);
    return result === 'blacklisted';
  }

  async onModuleDestroy() {
    if (this.redisClient.isOpen) {
      await this.redisClient.quit();
    }
  }
}