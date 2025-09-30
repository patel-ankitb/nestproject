import { Injectable, NotFoundException } from '@nestjs/common';
// import { MongoDBService } from './mongodb.service';
import { DatabaseService } from '../databases/database.service'; // Hypothetical MongoDB service


@Injectable()
export class ConfigurationsService {
  constructor(private readonly mongoDBService: DatabaseService) {}

  async getConfigurations(appName: string) {
    const appDb = await this.mongoDBService.getAppDB(appName);

    const sidebarConfig = await appDb.collection('schema').findOne({ code: 'SIDEBAR_CONFIG' });
    const routesConfig = await appDb.collection('schema').findOne({ code: 'ROUTES_CONFIG' });

    if (!sidebarConfig || !routesConfig) {
      throw new NotFoundException('Configuration not found.');
    }

    return {
      sidebarConfig,
      routesConfig,
    };
  }
}