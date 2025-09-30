import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly redisClient: RedisClientType;
  private readonly logger = new Logger(RedisService.name);

  constructor() {
    const redisUrl = `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`;
    const redisPassword = process.env.REDIS_PASSWORD || undefined;

    // Validate environment variables
    if (!process.env.REDIS_HOST || !process.env.REDIS_PORT) {
      this.logger.warn('Redis host or port not provided, using default values.');
    }

    this.redisClient = createClient({
      url: redisUrl,
      password: redisPassword,
    });

    // Handle Redis client errors
    this.redisClient.on('error', (err) => {
      this.logger.error('Redis client error', err);
    });

    this.redisClient.on('connect', () => {
      this.logger.log('Connected to Redis');
    });

    this.redisClient.on('reconnecting', () => {
      this.logger.warn('Reconnecting to Redis');
    });

    this.redisClient.on('end', () => {
      this.logger.warn('Redis connection closed');
    });
  }

  async onModuleInit() {
    try {
      await this.redisClient.connect();
      this.logger.log('Redis client initialized successfully');
    } catch (err) {
      this.logger.error('Failed to connect to Redis', err);
      throw new Error('Redis connection failed');
    }
  }

  async onModuleDestroy() {
    try {
      if (this.redisClient.isOpen) {
        await this.redisClient.quit();
        this.logger.log('Redis connection closed gracefully');
      }
    } catch (err) {
      this.logger.error('Error closing Redis connection', err);
    }
  }

  async isTokenBlacklisted(token: string): Promise<boolean> {
    try {
      if (!this.redisClient.isOpen) {
        throw new Error('Redis client is not connected');
      }
      const result = await this.redisClient.get(token);
      return result === 'blacklisted';
    } catch (err) {
      this.logger.error(`Failed to check token ${token}`, err);
      throw new Error('Failed to check token in Redis');
    }
  }
}