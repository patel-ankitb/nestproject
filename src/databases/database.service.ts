import { Injectable, BadRequestException } from '@nestjs/common';
import mongoose, { Connection } from 'mongoose';

@Injectable()
export class DatabaseService {
  private connections: Map<string, Connection> = new Map();
  private readonly BASE_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017";
  private readonly CONFIG_DB = "configdb";
  private readonly CONFIG_COLLECTION = process.env.COLLECTION || "appconfigs";

  async getConnection(cn_str: string, dbName: string): Promise<Connection> {
    const cacheKey = `${cn_str}_${dbName}`;
    if (this.connections.has(cacheKey)) return this.connections.get(cacheKey)!;

    const connection = await mongoose.createConnection(cn_str, { dbName }).asPromise();
    this.connections.set(cacheKey, connection);
    return connection;
  }

  async getDbConfigFromKey(key: string) {
    const configConn = await this.getConnection(this.BASE_URI, this.CONFIG_DB);
    const config = await configConn.collection(this.CONFIG_COLLECTION).findOne({
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
    const config = await configConn.collection(this.CONFIG_COLLECTION).findOne({
      'sectionData.appconfigs.key': key,
    });

    if (!config?.sectionData?.appconfigs?.modules) {
      throw new BadRequestException(`Modules not found for key '${key}'`);
    }

    const cleanModuleName = moduleName.trim();
    const moduleObj = config.sectionData.appconfigs.modules.find((m: any) => {
      if (typeof m === 'string') return m.trim() === cleanModuleName;
      if (m && typeof m === 'object') {
        const names = [m.moduleName, m.name, m.module].filter(Boolean).map((n: string) => n.trim());
        return names.includes(cleanModuleName);
      }
      return false;
    });

    if (!moduleObj) {
      throw new BadRequestException(`Module '${cleanModuleName}' not found for key '${key}'`);
    }

    return moduleObj;
  }
}
