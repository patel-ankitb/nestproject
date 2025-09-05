import { Injectable, BadRequestException } from '@nestjs/common';
import mongoose, { Connection } from 'mongoose';

@Injectable()
export class AddEditMFindService {
  private connections: Map<string, Connection> = new Map();
  private readonly MONGO_URI =
    process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';

  private async getConnection(dbName: string): Promise<Connection> {
    if (this.connections.has(dbName)) {
      return this.connections.get(dbName)!;
    }
    const connection = await mongoose
      .createConnection(this.MONGO_URI, { dbName })
      .asPromise();
    this.connections.set(dbName, connection);
    return connection;
  }

  // 🔑 fetch dbName + allowed modules dynamically
  private async getDbConfigFromKey(
    key: string,
  ): Promise<{ db: string; modules: any[] }> {
    const configConnection = await this.getConnection('configdb');
    const configCollection = configConnection.collection('appconfigs');

    const config = await configCollection.findOne({
      'sectiondata.appconfigs.key': key,
    });

    if (!config || !config.sectiondata?.appconfigs?.db) {
      throw new BadRequestException(`No database found for key '${key}'`);
    }

    return {
      db: config.sectiondata.appconfigs.db,
      modules: config.sectiondata.appconfigs.modules || [],
    };
  }

  async getModuleData(headers: any, body: any) {
    const {
      moduleName,
      query = {},
      projection = {},
      limit = 10,
      skip = 0,
      order = 'ascending',
      sortBy = '_id',
      docId,
      payload = {},
      isAdd,
      isEdit,
    } = body;

    const key = headers['x-api-key'];
    if (!key) throw new BadRequestException('Key must be provided in headers');
    if (!moduleName) {
      throw new BadRequestException('moduleName is required in body');
    }

    // ✅ Find DB + modules from config
    const { db, modules } = await this.getDbConfigFromKey(key);

    // ✅ Match correct module config
    const moduleConfig = modules.find((m: any) => {
      if (typeof m === 'string') return m === moduleName;
      if (m && typeof m === 'object') {
        return (
          m.moduleName === moduleName ||
          m.name === moduleName ||
          m.module === moduleName
        );
      }
      return false;
    });

    if (!moduleConfig) {
      throw new BadRequestException(
        `Module '${moduleName}' not allowed for key '${key}'`,
      );
    }

    const connection = await this.getConnection(db);

    // ✅ Ensure collection exists
    const collections = await connection.db!.listCollections().toArray();
    const exists = collections.some((c) => c.name === moduleName);
    if (!exists) {
      throw new BadRequestException(
        `Collection '${moduleName}' does not exist in database '${db}'`,
      );
    }

    const collection = connection.collection(moduleName);
// 🟢 EDIT flow
// 🟢 EDIT flow
// 🟢 EDIT flow
if (isEdit || body.docId) {
  let canEdit = false;

  if (typeof moduleConfig === 'string') {
    canEdit = true;
  } else if (moduleConfig) {
    canEdit = !!(moduleConfig.isedit ?? moduleConfig.canEdit ?? true);
  }

  if (!canEdit) {
    throw new BadRequestException(
      `Editing not allowed for modules   '${moduleName}'`,
    );
  }

  const docIdFromBody = body.docId;
  if (!docIdFromBody) {
    throw new BadRequestException('docId is required for edit operation');
  }

  const filter: any = { _id: String(docIdFromBody) };

  // ✅ extract data from body[moduleName]
  const updateData =
    body[moduleName] && typeof body[moduleName] === 'object'
      ? body[moduleName]
      : body;

  // ❌ remove reserved keys
  delete updateData._id;
  delete updateData.docId;

  // ✅ build nested $set => sectiondata.moduleName.key
  const setData: any = {};
  for (const [field, value] of Object.entries(updateData)) {
    setData[`sectiondata.${moduleName}.${field}`] = value;
  }

  const result = await collection.updateOne(filter, { $set: body.body });

  if (result.matchedCount === 0) {
    throw new BadRequestException(
      `No document found with docId '${docIdFromBody}' in '${moduleName}'`,
    );
  }

  return {
    success: true,
    action: 'edit',
    message:
      result.modifiedCount > 0
        ? 'Document updated successfully'
        : `No changes provided for docId '${docIdFromBody}'`,
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
  };
}



    // 🟢 ADD flow (only when no docId is passed)
    if (isAdd) {
      let canAdd = false;

      if (typeof moduleConfig === 'string') {
        canAdd = true;
      } else if (moduleConfig) {
        canAdd = !!(moduleConfig.isadd ?? moduleConfig.canAdd ?? true);
      }

      if (!canAdd) {
        throw new BadRequestException(
          `Adding not allowed for module '${moduleName}'`,
        );
      }

      // ✅ always assign string _id
      if (!payload._id) {
        payload._id = Date.now().toString();
      } else {
        payload._id = String(payload._id);
      }

      const result = await collection.insertOne(payload);

      return {
        success: true,
        action: 'add',
        message: 'Document added successfully',
        insertedId: result.insertedId,
      };
    }

    // 🟢 FETCH flow
    const pipeline: any[] = [];
    if (Object.keys(query).length) pipeline.push({ $match: query });
    if (Object.keys(projection).length) pipeline.push({ $project: projection });
    pipeline.push({ $sort: { [sortBy]: order === 'descending' ? -1 : 1 } });
    if (skip > 0) pipeline.push({ $skip: skip });
    if (limit > 0) pipeline.push({ $limit: limit });

    const documents = await collection.aggregate(pipeline).toArray();
    const totalCount = await collection.countDocuments(query);

    return {
      success: true,
      action: 'fetch',
      db,
      moduleName,
      count: documents.length,
      totalCount,
      data: documents,
    };
  }
}