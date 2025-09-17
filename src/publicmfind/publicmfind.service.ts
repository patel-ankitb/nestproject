import { Injectable, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../databases/database.service';

@Injectable()
export class PublicMFindService {
  constructor(private readonly dbService: DatabaseService) {}

  async getModuleData(headers: any, body: any) {
    const {
      appName,
      moduleName,
      query = {},
      projection = {},
      limit = 0,
      skip = 0,
      order = 'ascending',
      sortBy = '_id',
      lookups = [],
    } = body;

    if (!appName) throw new BadRequestException('appName is required in body');
    if (!moduleName) throw new BadRequestException('moduleName is required in body');

    const key = headers['x-api-key'];
    if (!key) throw new BadRequestException('Key must be provided in headers');

    const config = await this.dbService.getDbConfigFromKey(key);
    const conn = await this.dbService.getConnection(
      process.env.MONGO_URI || 'mongodb://127.0.0.1:27017',
      config.db,
    );
    const db = conn.db;
    if (!db) throw new BadRequestException('Database connection failed');

    const moduleConfig = await this.dbService.getModuleByName(key, moduleName);
    if (!moduleConfig) throw new BadRequestException(`Module '${moduleName}' not allowed`);

    // Ensure collection exists
    const collections = await db.listCollections().toArray();
    if (!collections.some((c: any) => c.name === moduleName)) {
      await db.createCollection(moduleName);
    }
    const collection = db.collection(moduleName);

    // Construct pipeline with explicit typing
    let pipeline: Array<Record<string, any>> = [];

    // Match stage
    if (Object.keys(query).length > 0) {
      pipeline.push({ $match: query });
    }

    // Lookup stages
    if (lookups.length > 0) {
      lookups.forEach((lookup) => {
        pipeline.push(lookup);
      });
    }

    // Projection stage
    if (Object.keys(projection).length > 0) {
      pipeline.push({ $project: projection });
    }

    // Sort stage
    if (sortBy) {
      const sortDirection = order === 'descending' ? -1 : 1;
      pipeline.push({ $sort: { [sortBy]: sortDirection } });
    }

    // Execute aggregation to get total count and documents
    const totalCount = await collection.aggregate(pipeline).toArray();
    const totalCountdb = await collection.countDocuments({});
    const queryCount = await collection.countDocuments(query);

    // Add pagination if specified
    if (skip > 0) pipeline.push({ $skip: skip });
    if (limit > 0) pipeline.push({ $limit: limit });

    // Execute final aggregation with pagination
    const documents = await collection.aggregate(pipeline).toArray();

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