import { Injectable, BadRequestException } from '@nestjs/common';
import mongoose, { Connection } from 'mongoose';

@Injectable()
export class PublicMFindService {
  private connections: Map<string, Connection> = new Map();
  private readonly BASE_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017";

  private async getConnection(cn_str: string, dbName: string): Promise<Connection> {
    const cacheKey = `${cn_str}_${dbName}`;
    if (this.connections.has(cacheKey)) return this.connections.get(cacheKey)!;
    const connection = await mongoose.createConnection(cn_str, { dbName }).asPromise();
    this.connections.set(cacheKey, connection);
    return connection;
  }

  private async getDbConfigFromKey(key: string) {
    const configConn = await this.getConnection(this.BASE_URI, 'configdb');
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

  private async getModuleByName(key: string, moduleName: string) {
    const configConn = await this.getConnection(this.BASE_URI, 'configdb');
    const config = await configConn.collection('appconfigs').findOne({
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

  async getModuleData(headers: any, body: any) {
    const {
      appName,
      moduleName,
      query = {},
      projection = {},
      limit = 0,
      skip = 0,
      order = "ascending",
      sortBy = "_id",
    } = body;

    if (!appName) throw new BadRequestException("appName is required in body");
    if (!moduleName) throw new BadRequestException("moduleName is required in body");

    const key = headers['x-api-key'];
    if (!key) throw new BadRequestException("Key must be provided in headers");

    const config = await this.getDbConfigFromKey(key);
    const conn = await this.getConnection(this.BASE_URI, config.db);
    const db = conn.db;
    if (!db) throw new BadRequestException('Database connection failed');

    const moduleConfig = await this.getModuleByName(key, moduleName);
    const cleanModuleName = moduleName.trim();
    if (!moduleConfig) throw new BadRequestException(`Module '${cleanModuleName}' not allowed`);

    const collections = await db.listCollections().toArray();
    if (!collections.some((c: any) => c.name === cleanModuleName)) {
      await db.createCollection(cleanModuleName);
    }
    const collection = db.collection(cleanModuleName);

    // ===== Build pipeline properly =====
    const pipeline: any[] = [];

    // Apply query if provided
    if (query && Object.keys(query).length > 0) {
      pipeline.push({ $match: query });
    }

    // Apply projection if provided
    if (projection && Object.keys(projection).length > 0) {
      pipeline.push({ $project: projection });
    }

    // Apply sorting
    pipeline.push({ $sort: { [sortBy]: order === "descending" ? -1 : 1 } });

    // Apply skip
    if (skip > 0) {
      pipeline.push({ $skip: skip });
    }

    // Apply limit
    if (limit > 0) {
      pipeline.push({ $limit: limit });
    }

    const documents = await collection.aggregate(pipeline).toArray();
    const totalCountdb = await collection.countDocuments({});
    const queryCount = await collection.countDocuments(query);

    return {
      success: true,
      appName,
      moduleName,
      count: documents.length,
      querycount: queryCount,
      totalCountdb,
      data: documents,
    };
  }
}
