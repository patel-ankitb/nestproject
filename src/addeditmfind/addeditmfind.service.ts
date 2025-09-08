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

  private async getDbConfigFromKey(
    key: string,
  ): Promise<{ db: string; modules: any[] }> {
    const configConnection = await this.getConnection('configdb');
    const configCollection = configConnection.collection('appconfigs');

    const config = await configCollection.findOne({
      'sectionData.appconfigs.key': key,
    });

    if (!config || !config.sectionData?.appconfigs?.db) {
      throw new BadRequestException(`No database found for key '${key}'`);
    }

    return {
      db: config.sectionData.appconfigs.db,
      modules: config.sectionData.appconfigs.modules || [],
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
      isAdd,
      isEdit,
    } = body;

    const key = headers['x-api-key'];
    if (!key) throw new BadRequestException('Key must be provided in headers');
    if (!moduleName) {
      throw new BadRequestException('moduleName is required in body');
    }

    const { db, modules } = await this.getDbConfigFromKey(key);

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

    const collections = await connection.db!.listCollections().toArray();
    const exists = collections.some((c) => c.name === moduleName);
    if (!exists) {
      throw new BadRequestException(
        `Collection '${moduleName}' does not exist in database '${db}'`,
      );
    }

    const collection = connection.collection(moduleName);

    // Helper: flatten object but skip special keywords
    function flattenObject(obj: any, parentKey = '', res: any = {}) {
      for (const [key, value] of Object.entries(obj)) {
        const newKey = parentKey ? `${parentKey}.${key}` : key;

        if (
          value &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          !('add' in value) &&
          !('remove' in value) &&
          !('removeField' in value) &&
          !('addFields' in value)
        ) {
          flattenObject(value, newKey, res);
        } else {
          res[newKey] = value;
        }
      }
      return res;
    }

    // 🟢 EDIT flow
    if (isEdit || body.docId) {
      const docIdFromBody = String(body.docId || '');
      if (!docIdFromBody) {
        throw new BadRequestException('docId is required for edit operation');
      }

      const filter: any = { _id: docIdFromBody };

      const updateData =
        body.body ?? body.update ?? body.payload ?? null;

      if (!updateData || typeof updateData !== 'object') {
        throw new BadRequestException(
          'Provide fields to update in body.body / body.update / body.payload',
        );
      }

      const flatData = flattenObject(updateData);

      const setData: Record<string, any> = {};
      const pushData: Record<string, any> = {};
      const pullData: Record<string, any> = {};
      const unsetData: Record<string, ''> = {};
      const arrayFilters: any[] = [];

      for (const [field, value] of Object.entries(flatData)) {
        if (typeof value === 'object' && value !== null) {
          const v: any = value;

          // handle add to array
          if (v.add && Array.isArray(v.add)) {
            pushData[field] = { $each: v.add };
            continue;
          }

          // handle remove whole objects from array
          if (v.remove && Array.isArray(v.remove)) {
            const first = v.remove[0];
            if (
              first === null ||
              ['string', 'number', 'boolean'].includes(typeof first)
            ) {
              pullData[field] = { $in: v.remove };
            } else if (typeof first === 'object') {
              if (v.remove.length === 1) {
                pullData[field] = v.remove[0];
              } else {
                pullData[field] = { $or: v.remove };
              }
            }
            continue;
          }

          // ✅ handle removeField + addFields together safely
          if (v.matchField && v.matchValue !== undefined) {
            // removeField only if it's NOT also being re-added
            if (
              v.removeField &&
              (!v.addFields || !(v.removeField in v.addFields))
            ) {
              unsetData[`${field}.$[elem].${v.removeField}`] = '';
            }

            // add/overwrite fields if provided
            if (v.addFields && typeof v.addFields === 'object') {
              for (const [k, val] of Object.entries(v.addFields)) {
                setData[`${field}.$[elem].${k}`] = val;
              }
            }

            // filter for matching element
            arrayFilters.push({ [`elem.${v.matchField}`]: v.matchValue });
            continue;
          }
        }

        // null values → unset scalar
        if (value === null) {
          unsetData[field] = '';
        } else {
          setData[field] = value;
        }
      }

      const updateOps: any = {};
      if (Object.keys(setData).length) updateOps.$set = setData;
      if (Object.keys(pushData).length) updateOps.$push = pushData;
      if (Object.keys(unsetData).length) updateOps.$unset = unsetData;
      if (Object.keys(pullData).length) updateOps.$pull = pullData;

      if (!Object.keys(updateOps).length) {
        throw new BadRequestException('No valid fields found to update');
      }

      const options = arrayFilters.length ? { arrayFilters } : {};
      const result = await collection.updateOne(filter, updateOps, options);

      return {
        success: true,
        action: 'edit',
        updateOps,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
      };
    }

    // 🟢 ADD flow
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

      const payload = body.payload ?? {};
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
