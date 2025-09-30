import { Module, NestModule, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { AppConfigController } from './app-config.controller';
import { AppConfigService } from './app-config.service';
import { DatabaseService } from '../databases/database.service'; // Hypothetical MongoDB service
import { ConfigurationsController } from './configurations.controller';
import { ConfigurationsService } from './configurations.service';
import { SaveConfigurationsController } from './save-configurations.controller';
import { SaveConfigurationsService } from './save-configurations.service';
import { AccessControlMiddleware } from '../middleware/access-control.middleware';
import { JwtService } from '../utils/jwt.service';
import { RedisService } from '../utils/redis.service';


@Module({
  controllers: [AppConfigController, ConfigurationsController, SaveConfigurationsController],
  providers: [
    AppConfigService,
    ConfigurationsService,
    SaveConfigurationsService,
    DatabaseService,
    JwtService,
    RedisService,
  ],
})
export class AppConfigModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AccessControlMiddleware)
      .forRoutes(
        { path: 'api/getConfigurations/:appName', method: RequestMethod.GET },
        { path: 'api/saveConfigurations/:appName', method: RequestMethod.POST },
      );
  }
}