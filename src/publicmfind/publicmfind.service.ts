import { Injectable, BadRequestException } from '@nestjs/common';
import mongoose, { Connection } from 'mongoose';

@Injectable()
export class PublicMFindService {
  private connections: Map<string, Connection> = new Map();
  private readonly MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017";

  private async getConnection(dbName: string): Promise<Connection> {
    if (this.connections.has(dbName)) {
      return this.connections.get(dbName)!;
    }
    const connection = await mongoose.createConnection(this.MONGO_URI, { dbName }).asPromise();
    this.connections.set(dbName, connection);
    return connection;
  }

  // 🔑 fetch dbName + allowed modules dynamically
  private async getDbConfigFromKey(key: string): Promise<{ db: string, modules: string[] }> {
    const configConnection = await this.getConnection("configdb");
    const configCollection = configConnection.collection("appconfigs");

    const config = await configCollection.findOne({ "sectiondata.appconfigs.key": key });

    if (!config || !config.sectiondata?.appconfigs?.db) {
      throw new BadRequestException(`No database found for key '${key}'`);
    }

    return {
      db: config.sectiondata.appconfigs.db,
      modules: config.sectiondata.appconfigs.modules || []
    };
  }

  async getModuleData(headers: any, body: any) {
    const {
      moduleName,
      query = {},
      projection = {},
      limit = 10,
      skip = 0,
      order = "ascending",
      sortBy = "_id",
    } = body;

    const key =  headers['x-api-key']; 
    if (!key) throw new BadRequestException("Key must be provided in headers");
    if (!moduleName) throw new BadRequestException("moduleName is required in body");

    const { db, modules } = await this.getDbConfigFromKey(key);

    // ✅ Check if module is allowed
    if (!modules.includes(moduleName)) {
      throw new BadRequestException(`Module '${moduleName}' not allowed for key '${key}'`);
    }

    const connection = await this.getConnection(db);

    // ✅ Collection check
    const collections = await connection.db!.listCollections().toArray();
    const exists = collections.some(c => c.name === moduleName);
    if (!exists) {
      throw new BadRequestException(`Collection '${moduleName}' does not exist in database '${db}'`);
    }

    const collection = connection.collection(moduleName);

    // ✅ Pipeline build
    const pipeline: any[] = [];
    if (Object.keys(query).length) pipeline.push({ $match: query });
    if (Object.keys(projection).length) pipeline.push({ $project: projection });
    pipeline.push({ $sort: { [sortBy]: order === "descending" ? -1 : 1 } });
    if (skip > 0) pipeline.push({ $skip: skip });
    if (limit > 0) pipeline.push({ $limit: limit });

    const documents = await collection.aggregate(pipeline).toArray();
    const totalCount = await collection.countDocuments(query);

    return {
      success: true,
      appconfigs: db,
      moduleName,
      count: documents.length,
      totalCount,
      data: documents,
    };
  }
}
