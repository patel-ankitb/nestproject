import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import mongoose, { Connection } from 'mongoose';
import { MongoClient, Db } from 'mongodb';

@Injectable()
export class DatabaseService {
  private mongooseConnections: Map<string, Connection> = new Map();
  private readonly BASE_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
  private readonly CONFIG_DB = process.env.CONFIG_DB || 'configdb';
  private readonly appConnectionsCache: Record<string, Db> = {};
  private client: MongoClient;

  constructor() {
    this.client = new MongoClient(this.BASE_URI);
    this.client.connect().catch(err => console.error('Main MongoDB connection failed:', err));
  }

  // -------------------- Mongoose Connections --------------------
  async getConnection(cn_str: string, dbName: string): Promise<Connection> {
    const cacheKey = `${cn_str}_${dbName}`;
    if (this.mongooseConnections.has(cacheKey)) return this.mongooseConnections.get(cacheKey)!;

    try {
      const connection = await mongoose.createConnection(cn_str, { dbName }).asPromise();
      this.mongooseConnections.set(cacheKey, connection);
      return connection;
    } catch (err) {
      throw new InternalServerErrorException(`Failed to connect to MongoDB at ${cn_str}: ${err.message}`);
    }
  }

  // -------------------- App Config / Modules --------------------
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

  // -------------------- Dynamic App DB (Native Mongo) --------------------
  async getAppDB(appName: string): Promise<Db> {
    if (!appName) {
      throw new BadRequestException('appName is required');
    }

    console.log('Fetching DB for appName:', appName);

    // 1. Check cache
    if (this.appConnectionsCache[appName]) return this.appConnectionsCache[appName];

    // 2. Ensure main client connected (MongoDB v4+)
    await this.client.connect().catch(err => {
      throw new InternalServerErrorException(`Failed to connect main MongoDB: ${err.message}`);
    });

    // 3. Fetch app configuration from "customize.custom_apps"
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

    // 4. Connect to the app DB (cache per appName)
    const appDb = await this.connectToAppDB(cn_str, db);
    console.log('Connected to app DB ..............',appDb);
    this.appConnectionsCache[appName] = appDb;

    return appDb;
  }

  private async connectToAppDB(connectionString: string, dbName: string): Promise<Db> {
    console.log('Connecting to app DB ..............', dbName);
    try {
      const appClient = new MongoClient(connectionString);
      await appClient.connect();
      return appClient.db(dbName);
    } catch (err) {
      throw new InternalServerErrorException(`Failed to connect to app DB '${dbName}': ${err.message}`);
    }
  }
}
