import { Injectable, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../databases/database.service'; // import service

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
      order = "ascending",
      sortBy = "_id",
      lookups = [],   // <-- add lookups support
    } = body;

    if (!appName) throw new BadRequestException("appName is required in body");
    if (!moduleName) throw new BadRequestException("moduleName is required in body");

    const key = headers['x-api-key'];
    if (!key) throw new BadRequestException("Key must be provided in headers");

    const config = await this.dbService.getDbConfigFromKey(key);
    const conn = await this.dbService.getConnection(
      process.env.MONGO_URI || "mongodb://127.0.0.1:27017",
      config.db
    );
    const db = conn.db;
    if (!db) throw new BadRequestException('Database connection failed');

    const moduleConfig = await this.dbService.getModuleByName(key, moduleName);
    const cleanModuleName = moduleName.trim();
    if (!moduleConfig) throw new BadRequestException(`Module '${cleanModuleName}' not allowed`);

    const collections = await db.listCollections().toArray();
    if (!collections.some((c: any) => c.name === cleanModuleName)) {
      await db.createCollection(cleanModuleName);
    }
    const collection = db.collection(cleanModuleName);

    // ===== Build pipeline properly =====
    const pipeline: any[] = [];

    if (query && Object.keys(query).length > 0) {
      pipeline.push({ $match: query });
    }

    // ✅ Add lookups dynamically
    if (lookups && Array.isArray(lookups)) {
      for (const lookup of lookups) {
        if (!lookup.from || !lookup.localField || !lookup.foreignField || !lookup.as) {
          throw new BadRequestException("Each lookup must contain from, localField, foreignField, and as");
        }
        pipeline.push({
          $lookup: {
            from: lookup.from,
            localField: lookup.localField,
            foreignField: lookup.foreignField,
            as: lookup.as,
          },
        });

        // optional $unwind support
        if (lookup.unwind) {
          pipeline.push({
            $unwind: {
              path: `$${lookup.as}`,
              preserveNullAndEmptyArrays: lookup.preserveNullAndEmptyArrays ?? true,
            },
          });
        }
      }
    }

    if (projection && Object.keys(projection).length > 0) {
      pipeline.push({ $project: projection });
    }

    pipeline.push({ $sort: { [sortBy]: order === "descending" ? -1 : 1 } });

    if (skip > 0) {
      pipeline.push({ $skip: skip });
    }

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
