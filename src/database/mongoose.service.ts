import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseOptionsFactory, MongooseModuleOptions } from '@nestjs/mongoose';

@Injectable()
export class MongooseService implements MongooseOptionsFactory {
  constructor(private readonly config: ConfigService) {}

  createMongooseOptions(): MongooseModuleOptions {
    const envtype = this.config.get<string>('NODE_ENV');

    if (envtype === 'Local') {
      console.log('Local Environment');
      return {
        uri: 'mongodb://localhost:27017/dataproject',
      };
    }

    const dbUser = this.config.get<string>('DATABASE_USER');
    const dbPassword = this.config.get<string>('DATABASE_PASSWORD');
    const dbHost = this.config.get<string>('DATABASE_HOST');
    const dbName = this.config.get<string>('DATABASE_NAME');

    return {
      uri: `mongodb+srv://${dbUser}:${dbPassword}@${dbHost}/${dbName}?retryWrites=true&w=majority&appName=Ankitpatel`,
    };
  }
}
