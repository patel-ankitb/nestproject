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
import { CreateModuleController } from './create-module.controller';
import { CreateModuleService } from './create-module.service';
import { AddModuleService } from './add-module.service';
import { JwtService } from '../utils/jwt.service';
import { RedisService } from '../utils/redis.service';


@Module({
  controllers: [
    AppConfigController, 
    ConfigurationsController, 
    SaveConfigurationsController,
    BasicModulesController,
    CreateModuleController
  ],
  providers: [
    AppConfigService,
    ConfigurationsService,
    SaveConfigurationsService,
    BasicModulesService,
    CreateModuleService,
    AddModuleService,
    DatabaseService,
    JwtService,
    RedisService,
  ],
  exports: [
    AddModuleService, // Export AddModuleService if used in other modules
    DatabaseService,   // Export MongoDBService if used elsewhere
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
        { path: 'api/build-hana-module/:appName', method: RequestMethod.POST },
      );
  }
}