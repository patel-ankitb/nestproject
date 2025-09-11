import { Injectable, BadRequestException } from '@nestjs/common';
import mongoose, { Connection } from 'mongoose';

@Injectable()
export class AddEditMFindService {
  private connections: Map<string, Connection> = new Map();
  private readonly BASE_URI =
    process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';

  // ===== Connection Pool =====
  private async getConnection(cn_str: string, dbName: string): Promise<Connection> {
    const cacheKey = `${cn_str}_${dbName}`;
    if (this.connections.has(cacheKey)) return this.connections.get(cacheKey)!;
    const connection = await mongoose.createConnection(cn_str, { dbName }).asPromise();
    this.connections.set(cacheKey, connection);
    return connection;
  }

  // ===== Get DB config from header key =====
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

  // ===== Flatten helper =====
  private flattenObject(obj: any, parentKey = '', res: any = {}) {
    for (const [key, value] of Object.entries(obj)) {
      const newKey = parentKey ? `${parentKey}.${key}` : key;
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        !('add' in (value as any)) &&
        !('remove' in (value as any)) &&
        !('removeField' in (value as any)) &&
        !('addFields' in (value as any))
      ) {
        this.flattenObject(value, newKey, res);
      } else {
        res[newKey] = value;
      }
    }
    return res;
  }

  // ===== Fetch modules by docId =====
  private async getModuleByName(docId: string, moduleName: string) {
    const configConn = await this.getConnection(this.BASE_URI, 'configdb');
    console.log('Fetching module by name:', { docId, moduleName });

    const filter: any = mongoose.isValidObjectId(docId)
      ? { _id: new mongoose.Types.ObjectId(docId) }
      : { _id: docId };

    let config: any = await configConn.collection('appconfigs').findOne(filter);
    if (!config) {
      const cleanModuleName = moduleName?.trim();
      if (cleanModuleName) {
        const altFilter = {
          $or: [
            { 'sectionData.appconfigs.modules': cleanModuleName },
            { 'sectionData.appconfigs.modules.moduleName': cleanModuleName },
            { 'sectionData.appconfigs.modules.name': cleanModuleName },
            { 'sectionData.appconfigs.modules.module': cleanModuleName },
          ],
        };
        const altConfig = await configConn.collection('appconfigs').findOne(altFilter);
        if (altConfig) config = altConfig;
      }
    }

    console.log('Config fetched for getModuleByName:', config);
    if (!config?.sectionData?.appconfigs?.modules) {
      throw new BadRequestException(`Modules not found for docId '${docId}'`);
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
      throw new BadRequestException(`Module '${cleanModuleName}' not found in docId '${docId}'`);
    }

    return moduleObj;
  }

  // ===== Main Entry =====
  async getModuleData(headers: any, body: any) {
    const {
      moduleName,
      docId,
      payload = {},
      body: updateBody,
      isAdd,
      isEdit,
      appName,
      query = {},
      projection = {},
      limit = 10,
      skip = 0,
      sortBy = '_id',
      order = 'ascending',
    } = body;

    if (!moduleName) throw new BadRequestException('moduleName is required');
    if (!appName) throw new BadRequestException('appName is required');

    const key = headers['x-api-key'];
    if (!key) throw new BadRequestException('x-api-key header is required');

    // ===== DB connection =====
    const config = await this.getDbConfigFromKey(key);
    const conn = await this.getConnection(this.BASE_URI, config.db);
    const db = conn.db;
    if (!db) throw new BadRequestException('Database connection failed');

    // ===== Module config =====
    const moduleConfig = await this.getModuleByName(docId, moduleName);
    const cleanModuleName = moduleName.trim();
    if (!moduleConfig) throw new BadRequestException(`Module '${cleanModuleName}' not allowed`);

    // ensure collection exists
    const collections = await db.listCollections().toArray();
    if (!collections.some((c: any) => c.name === cleanModuleName)) {
      await db.createCollection(cleanModuleName);
    }
    const collection = db.collection(cleanModuleName);

    // 🟢 EDIT flow
    if (isEdit || body.docId) {
      console.log('Edit operation initiated', docId, body);
      const docIdFromBody = String(body.docId || '');
      if (!docIdFromBody) {
        throw new BadRequestException('docId is required for edit operation');
      }

      const filter: any = { _id: docIdFromBody };
      const updateData = body.body ?? body.update ?? body.payload ?? null;

      if (!updateData || typeof updateData !== 'object') {
        throw new BadRequestException('Provide fields to update in body.body / body.update / body.payload');
      }

      const flatData = this.flattenObject(updateData);

      const setData: Record<string, any> = {};
      const pushData: Record<string, any> = {};
      const pullData: Record<string, any> = {};
      const unsetData: Record<string, ''> = {};
      const arrayFilters: any[] = [];

      for (const [field, value] of Object.entries(flatData)) {
        if (typeof value === 'object' && value !== null) {
          const v: any = value;

          if (v.add && Array.isArray(v.add)) {
            pushData[field] = { $each: v.add };
            continue;
          }

          if (v.remove && Array.isArray(v.remove)) {
            const first = v.remove[0];
            if (first === null || ['string', 'number', 'boolean'].includes(typeof first)) {
              pullData[field] = { $in: v.remove };
            } else if (typeof first === 'object') {
              pullData[field] = v.remove.length === 1 ? v.remove[0] : { $or: v.remove };
            }
            continue;
          }

          if (v.matchField && v.matchValue !== undefined) {
            if (v.removeField) {
              unsetData[`${field}.$[elem].${v.removeField}`] = '';
            }
            if (v.addFields) {
              for (const [k, val] of Object.entries(v.addFields)) {
                setData[`${field}.$[elem].${k}`] = val;
              }
            }
            arrayFilters.push({ ['elem.' + v.matchField]: v.matchValue });
            continue;
          }


        }

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


      const lookupFilter: any = mongoose.isValidObjectId(docIdFromBody)
        ? { _id: new mongoose.Types.ObjectId(docIdFromBody) }
        : { _id: docIdFromBody };

      if (result.matchedCount === 0) {
        throw new BadRequestException(`Document with id '${docIdFromBody}' not found`);
      }

      const updatedDoc = await collection.findOne(lookupFilter);

      return {
        success: true,
        action: 'edit',
        message: 'Document updated successfully',
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        upsertedId: result.upsertedId ?? null,
        data: updatedDoc,
      };
    }

    // ===== ADD =====
    if (isAdd) {
      let canAdd = true;
      if (moduleConfig && typeof moduleConfig === 'object') {
        canAdd = !!(moduleConfig.isadd ?? moduleConfig.canAdd ?? true);
      }
      if (!canAdd) throw new BadRequestException(`Adding not allowed for module '${cleanModuleName}'`);

      if (!payload._id) payload._id = Date.now().toString();
      else payload._id = String(payload._id);

      const resultAdd = await collection.insertOne(payload);
      return { success: true, action: 'add', message: 'new Add the data Successfully...!!', insertedId: resultAdd.insertedId };
    }

    // ===== FETCH =====
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
      moduleName: cleanModuleName,
      count: documents.length,
      totalCount,
      data: documents,
    };
  }
}
