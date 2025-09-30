import { Injectable, Logger } from '@nestjs/common';
import { createClient } from 'redis';

@Injectable()
export class RedisService {
  private readonly redisClient: ReturnType<typeof createClient>;
  private readonly logger = new Logger(RedisService.name);

  constructor() {
  console.log("RedisService 1");

    this.redisClient = createClient({
      url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`,
      password: process.env.REDIS_PASSWORD || undefined,
    });
    console.log("RedisService 2");

    this.redisClient.connect().catch((err) => {
      this.logger.error('Failed to connect to Redis', err);
    });
  }

  async isTokenBlacklisted(token: string): Promise<boolean> {
  console.log("RedisService 3");

    const result = await this.redisClient.get(token);
  console.log("RedisService 4");

    return result === 'blacklisted';
  }

  async onModuleDestroy() {
    if (this.redisClient.isOpen) {
      await this.redisClient.quit();
    }
  }
}