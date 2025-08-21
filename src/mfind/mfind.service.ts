import { Injectable } from '@nestjs/common';
import mongoose from 'mongoose';

@Injectable()
export class MFindService {
  async runAggregation(body: any) {
    const {
      appName,
      moduleName,
      query = {},
      projection = {},
      limit = 10,
      skip = 0,
      order = 'descending',
      sortBy = '_id',
      lookups = [],
        companyId,
        tableType
    } = body;

    if (!appName || !moduleName) {
      throw new Error('appName and moduleName are required');
    }

    // ✅ Connect to correct DB
    const connection = mongoose.connection.useDb(appName);

    // ✅ Verify database exists
    if (!connection.db) {
      throw new Error(`Database ${appName} is not available`);
    }
    const collections = await connection.db.listCollections().toArray();
    const collectionExists = collections.some((col) => col.name === moduleName);
    if (!collectionExists) {
      console.error(`❌ Collection ${moduleName} does not exist in database ${appName}`);
      throw new Error(`Collection ${moduleName} does not exist`);
    }

    const collection = connection.collection(moduleName);

    // ✅ Verify collection has documents
    const docCount = await collection.countDocuments();
    console.log(`📜 Collection ${moduleName} has ${docCount} documents`);
    if (docCount === 0) {
      console.warn('⚠️ Collection is empty');
      return [];
    }

    // ✅ Verify registrationrto field exists
    const sampleDoc = await collection.findOne({ registrationrto: { $exists: true } });
    if (!sampleDoc && query.registrationrto) {
      console.warn('⚠️ Field registrationrto does not exist in collection');
    } else if (sampleDoc && query.registrationrto) {
      console.log('🔍 Sample registrationrto value:', sampleDoc.registrationrto);
    }

    // ✅ Safe query build
    const mongoQuery: any = {};

    if (query.registrationrto) {
      if (typeof query.registrationrto === 'object' && query.registrationrto.$regex) {
        // already in regex format
        mongoQuery.registrationrto = query.registrationrto;
      } else {
        // string → convert into regex, trim and normalize input
        const normalizedInput = query.registrationrto.trim();
        mongoQuery.registrationrto = { $regex: normalizedInput, $options: 'i' };
      }
    }

    // ✅ Log query for debugging
    console.log('🔍 Input Query:', JSON.stringify(query, null, 2));
    console.log('🔍 Mongo Query:', JSON.stringify(mongoQuery, null, 2));

    // ✅ Pipeline
    const pipeline: any[] = [{ $match: mongoQuery }];

    if (lookups.length > 0) {
      for (const lookup of lookups) {
        // ✅ Validate lookup collection exists
        const lookupCollection = lookup.$lookup.from;
        const lookupExists = collections.some((col) => col.name === lookupCollection);
        if (!lookupExists) {
          console.warn(`⚠️ Lookup collection ${lookupCollection} does not exist`);
        }
        pipeline.push({ $lookup: lookup.$lookup });
      }
    }

    if (Object.keys(projection).length > 0) {
      pipeline.push({ $project: projection });
    }

    pipeline.push({
      $sort: { [sortBy]: order === 'descending' ? -1 : 1 },
    });

    pipeline.push({ $skip: Number(skip) });
    pipeline.push({ $limit: Number(limit) });

    console.log('🚀 Final Pipeline:', JSON.stringify(pipeline, null, 2));

    const result = await collection.aggregate(pipeline).toArray();
    console.log('📊 Aggregation Result:', JSON.stringify(result, null, 2));

    return result;
  }
}