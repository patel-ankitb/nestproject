import { Module, NestModule, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { AppConfigController } from './app-config.controller';
import { AppConfigService } from './app-config.service';
import { DatabaseService } from '../databases/database.service'; // Hypothetical MongoDB service
import { ConfigurationsController } from './configurations.controller';
import { ConfigurationsService } from './configurations.service';
import { SaveConfigurationsController } from './save-configurations.controller';
import { SaveConfigurationsService } from './save-configurations.service';
import { AccessControlMiddleware } from '../middleware/access-control.middleware';
import { BasicModulesController } from './basic-modules.controller';
import { BasicModulesService } from './basic-modules.service';
import { JwtService } from '../utils/jwt.service';
import { RedisService } from '../utils/redis.service';


@Module({
  controllers: [AppConfigController, ConfigurationsController, SaveConfigurationsController, BasicModulesController],
  providers: [
    AppConfigService,
    ConfigurationsService,
    SaveConfigurationsService,
    DatabaseService,
    JwtService,
    BasicModulesService,
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
        { path: 'api/get-basic-modules/:appName', method: RequestMethod.POST },
      );
  }
}