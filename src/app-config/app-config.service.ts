import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
// import { MongoDBService } from './mongodb.service'; // Hypothetical MongoDB service
import { DatabaseService } from '../databases/database.service'; // Hypothetical MongoDB service


@Injectable()

export class AppConfigService {
  constructor(private readonly mongoDBService: DatabaseService) {}

  async getAppConfig(appName: string) {
    const mainDb = this.mongoDBService.getDB('customize');
    const appConfig = await mainDb.collection('custom_apps').findOne({ appnm: appName });

    if (!appConfig) {
      throw new NotFoundException({success:false, message:'App configuration not found in apps. Register the app!'});
    }

    if (!appConfig.isSub) {
      throw new ForbiddenException({success:false, message:'App subscription is inactive.'});
    }

    const appDb = await this.mongoDBService.getAppDB(appName);

    const routesConfig = await appDb.collection('schema').findOne({ code: 'ROUTES_CONFIG' });
    const sidebarConfig = await appDb.collection('schema').findOne({ code: 'SIDEBAR_CONFIG' });

    if (!routesConfig || !sidebarConfig) {
      throw new NotFoundException({success:false, message:'Routes or Sidebar configuration not found'});
    }

    return {
      appName,
      routesConfig,
      sidebarConfig,
      defaultRoute: routesConfig.defaultRoute || '/',
    };
  }
}