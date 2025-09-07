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
// helper: flatten object to dot-notation (skip add/remove keys)
function flattenObject(obj: any, parentKey = '', res: any = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const newKey = parentKey ? `${parentKey}.${key}` : key;

    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !('add' in value) &&
      !('remove' in value)
    ) {
      flattenObject(value, newKey, res); // recurse deeper
    } else {
      res[newKey] = value;
    }
  }
  return res;
}

// 🟢 EDIT flow
if (isEdit || body.docId) {
  const docIdFromBody = body.docId;
  if (!docIdFromBody) {
    throw new BadRequestException('docId is required for edit operation');
  }

  const filter: any = { _id: String(docIdFromBody) };

  // ✅ take only "body"
  const updateData = body.body ?? body;

  delete updateData._id;
  delete updateData.docId;

  const flatData = flattenObject(updateData);

  const setData: any = {};
  const pushData: any = {};
  const pullData: any = {};
  const unsetData: any = {};

  for (const [field, value] of Object.entries(flatData)) {
    if (typeof value === 'object' && value !== null) {
      const v: any = value;

      if (v.add && Array.isArray(v.add)) {
        pushData[field] = { $each: v.add }; // ✅ add to array
        continue; // 🚨 skip $set
      }

      if (v.remove && Array.isArray(v.remove)) {
        // ✅ primitive values → use $in
        if (typeof v.remove[0] !== 'object') {
          pullData[field] = { $in: v.remove };
        } else {
          // ✅ objects → need multiple $pull operations
          pullData[field] = v.remove;
        }
        continue; // 🚨 skip $set
      }
    }

    // 🚀 Support deleting a field/array with null
    if (value === null) {
      unsetData[field] = "";
    } else {
      setData[field] = value; // ✅ normal overwrite
    }
  }

  // ✅ build update object safely
  const updateOps: any = {};
  if (Object.keys(setData).length) updateOps.$set = setData;
  if (Object.keys(pushData).length) updateOps.$push = pushData;
  if (Object.keys(unsetData).length) updateOps.$unset = unsetData;

  // ✅ handle pull properly
  if (Object.keys(pullData).length) {
    updateOps.$pull = {};
    for (const [field, val] of Object.entries(pullData)) {
      if (Array.isArray(val)) {
        // multiple objects remove → each one with $or
        updateOps.$pull[field] = { $or: val };
      } else {
        updateOps.$pull[field] = val;
      }
    }
  }

  const result = await collection.updateOne(filter, updateOps);

  return {
    success: true,
    action: 'edit',
    updateOps,
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