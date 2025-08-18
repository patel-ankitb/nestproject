import { Injectable } from '@nestjs/common';
import { MongooseOptionsFactory, MongooseModuleOptions } from '@nestjs/mongoose';

@Injectable()
export class MongooseService implements MongooseOptionsFactory {
  createMongooseOptions(): MongooseModuleOptions {
    const dbUser = 'root';
    const dbPassword = 'root';
    const dbHost = 'ankitpatel.qi65bl0.mongodb.net';
    const dbName = process.env.DB_NAME || 'dataproject';

    console.log(`✅ Connecting to Mongo Atlas DB: ${dbName}`);
    
    return {
      uri: `mongodb+srv://${dbUser}:${dbPassword}@${dbHost}/${dbName}?retryWrites=true&w=majority&appName=Ankitpatel`,
    };
  }
}
