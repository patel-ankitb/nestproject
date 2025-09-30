import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { DatabaseService } from '../databases/database.service'; // Hypothetical MongoDB service
import { SaveConfigDto } from './save-config.dto';

@Injectable()
export class SaveConfigurationsService {
  constructor(private readonly mongoDBService: DatabaseService) {}

  async saveConfigurations(appName: string, { type, config }: SaveConfigDto) {
    const appDb = await this.mongoDBService.getAppDB(appName);

    if (type === 'sidebar') {
      await appDb.collection('schema').updateOne(
        { code: 'SIDEBAR_CONFIG' },
        { $set: config },
        { upsert: true }, // Added upsert to match common behavior
      );
    } else if (type === 'routes') {
      await appDb.collection('schema').updateOne(
        { code: 'ROUTES_CONFIG' },
        { $set: config },
        { upsert: true }, // Added upsert to match common behavior
      );
    } else {
      throw new HttpException({success:false, message:'Invalid configuration type', statusCode:HttpStatus.UNAUTHORIZED}, HttpStatus.BAD_REQUEST);
    }
  }
}