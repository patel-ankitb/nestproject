import { Injectable, BadRequestException, InternalServerErrorException, OnModuleDestroy } from '@nestjs/common';
import mongoose, { Connection } from 'mongoose';
import { MongoClient, Db } from 'mongodb';


@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private mongooseConnections: Map<string, Connection> = new Map();
  private appClients: Map<string, MongoClient> = new Map();
  private readonly BASE_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
  private readonly CONFIG_DB = process.env.CONFIG_DB || 'configdb';
  private readonly appConnectionsCache: Record<string, Db> = {};
  private client: MongoClient;


  constructor() {
    this.client = new MongoClient(this.BASE_URI);
    this.client.connect().catch(err => console.error('Main MongoDB connection failed:', err));
  }


  async onModuleDestroy() {
    for (const client of this.appClients.values()) {
      await client.close();
    }
    this.appClients.clear();
    for (const conn of this.mongooseConnections.values()) {
      await conn.close();
    }
    this.mongooseConnections.clear();
    await this.client.close();
  }


  async getConnection(cn_str: string, dbName: string): Promise<Connection> {
    const cacheKey = `${cn_str}_${dbName}`;
    if (this.mongooseConnections.has(cacheKey)) return this.mongooseConnections.get(cacheKey)!;


    try {
      const connection = await mongoose.createConnection(cn_str, {
        dbName,
        connectTimeoutMS: 60000,
        serverSelectionTimeoutMS: 60000,
        retryWrites: true,
        retryReads: true,
        maxPoolSize: 10,
        minPoolSize: 2,
      }).asPromise();
      this.mongooseConnections.set(cacheKey, connection);
      return connection;
    } catch (err) {
      throw new InternalServerErrorException(`Failed to connect to MongoDB at ${cn_str}: ${err.message}`);
    }
  }


  async getDbConfigFromKey(key: string) {
    const configConn = await this.getConnection(this.BASE_URI, this.CONFIG_DB);
    const config = await configConn.collection('appconfigs').findOne({
      'sectionData.appconfigs.key': key,
    });


    if (!config?.sectionData?.appconfigs?.db) {
      throw new BadRequestException(`No database found for key '${key}'`);
    }


    return {
      db: config.sectionData.appconfigs.db,
      modules: config.sectionData.appconfigs.modules || [],
    };
  }


  async getModuleByName(key: string, moduleName: string) {
    const configConn = await this.getConnection(this.BASE_URI, this.CONFIG_DB);
    const config = await configConn.collection('appconfigs').findOne({
      'sectionData.appconfigs.key': key,
    });


    if (!config?.sectionData?.appconfigs?.modules) {
      throw new BadRequestException(`Modules not found for key '${key}'`);
    }


    const cleanModuleName = moduleName.trim().toLowerCase();
    const moduleObj = config.sectionData.appconfigs.modules.find((m: any) => {
      if (typeof m === 'string') return m.trim().toLowerCase() === cleanModuleName;
      if (m && typeof m === 'object') {
        const names = [m.moduleName, m.name, m.module]
          .filter(Boolean)
          .map((n: string) => n.trim().toLowerCase());
        return names.includes(cleanModuleName);
      }
      return false;
    });


    if (!moduleObj) {
      throw new BadRequestException(`Module '${moduleName}' not found for key '${key}'`);
    }


    return moduleObj;
  }


  async getAppDB(appName: string): Promise<Db> {
    if (!appName) {
      throw new BadRequestException('appName is required');
    }


    console.log('Fetching DB for appName:', appName);


    if (this.appConnectionsCache[appName]) return this.appConnectionsCache[appName];


    await this.client.connect().catch(err => {
      throw new InternalServerErrorException(`Failed to connect main MongoDB: ${err.message}`);
    });


    const appConfig = await this.client.db('customize')
      .collection('custom_apps')
      .findOne({ appnm: appName });


    console.log('App Config:', appConfig);


    if (!appConfig) {
      throw new BadRequestException(`App configuration not found for appName: '${appName}'`);
    }


    const { cn_str, db } = appConfig.info || {};
    if (!cn_str || !db) {
      throw new BadRequestException(`Incomplete app configuration for appName: '${appName}'`);
    }


    const appDb = await this.connectToAppDB(cn_str, db);
    this.appConnectionsCache[appName] = appDb;
    return appDb;
  }


  private async connectToAppDB(connectionString: string, dbName: string, retries = 3): Promise<Db> {
    console.log('Connecting to app DB:', dbName);
    console.log('Connection String:', connectionString);
    const cacheKey = `${connectionString}_${dbName}`;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        let appClient = this.appClients.get(cacheKey);
        if (!appClient) {
          appClient = new MongoClient(connectionString, {
            connectTimeoutMS: 60000,
            serverSelectionTimeoutMS: 60000,
            retryWrites: true,
            retryReads: true,
            maxPoolSize: 10,
            minPoolSize: 2,
          });
          console.time('ConnectionTime');
          await appClient.connect();
          console.timeEnd('ConnectionTime');
          this.appClients.set(cacheKey, appClient);
        }
        return appClient.db(dbName);
      } catch (err) {
        console.error(`Attempt ${attempt} failed: ${JSON.stringify(err, null, 2)}`);
        if (attempt === retries) {
          throw new InternalServerErrorException(`Failed to connect to app DB '${dbName}' after ${retries} attempts: ${err.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
    // Ensure function always either returns a Db or throws, satisfy TypeScript control flow analysis.
    throw new InternalServerErrorException(`Failed to connect to app DB '${dbName}' after ${retries} attempts`);
  }
}



