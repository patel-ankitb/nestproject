import { Injectable, BadRequestException } from '@nestjs/common';
import mongoose from 'mongoose';
import { DatabaseService } from '../databases/database.service';

@Injectable()
export class AddEditMFindService {
  constructor(private readonly dbService: DatabaseService) {}

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

    // ===== DB + Module config from DatabaseService =====
    const config = await this.dbService.getDbConfigFromKey(key);
    const conn = await this.dbService.getConnection(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017', config.db);
    const db = conn.db;

    if (!db) throw new BadRequestException('Database connection failed');

    const moduleConfig = await this.dbService.getModuleByName(key, moduleName);
    const cleanModuleName = moduleName.trim();

    // ensure collection exists
    const collections = await db.listCollections().toArray();
    if (!collections.some((c: any) => c.name === cleanModuleName)) {
      await db.createCollection(cleanModuleName);
    }
    const collection = db.collection(cleanModuleName);

    // 🟢 EDIT flow
    if (isEdit || body.docId) {
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

   // 🟢 ADD flow
if (isAdd) {
  let canAdd = true;
  if (moduleConfig && typeof moduleConfig === 'object') {
    canAdd = !!(moduleConfig.isadd ?? moduleConfig.canAdd ?? true);
  }
  if (!canAdd) throw new BadRequestException(`Adding not allowed for module '${cleanModuleName}'`);

  let addDataArray: any[] = [];
  if (Array.isArray(body.body)) {
    addDataArray = body.body;
  } else if (body.body && typeof body.body === 'object') {
    addDataArray = [body.body];
  } else {
    throw new BadRequestException('No valid data provided to add');
  }

  const insertedDocs: any[] = [];

  for (const item of addDataArray) {
    const id = item._id ? String(item._id) : Date.now().toString() + Math.floor(Math.random() * 1000);

    const sectionData: any = {};

    // ✅ support nested `sectionData` object directly
    if (item.sectionData && typeof item.sectionData === 'object') {
      Object.assign(sectionData, item.sectionData);
    }

    // ✅ support dot-path keys like "sectionData.xxx.yyy"
    for (const [key, value] of Object.entries(item)) {
      if (key === '_id' || key === 'sectionData') continue;

      if (!key.startsWith('sectionData.')) {
        throw new BadRequestException(`All fields must belong to 'sectionData', invalid key: ${key}`);
      }

      const parts = key.split('.');
      if (parts.length > 1) {
        let current = sectionData;
        for (let i = 1; i < parts.length; i++) {
          const part = parts[i];
          if (i === parts.length - 1) {
            current[part] = value;
          } else {
            if (!current[part]) {
              current[part] = {};
            }
            current = current[part];
          }
        }
      }
    }

    const doc = {
      _id: id,
      sectionData: sectionData,
      createdAt: new Date(),
    };

    await collection.insertOne(doc as any);
    const insertedDoc = await collection.findOne({ _id: id } as any);
    insertedDocs.push(insertedDoc);
  }

  return {
    success: true,
    action: 'add',
    message: 'Data added successfully',
    data: insertedDocs,
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
      moduleName: cleanModuleName,
      count: documents.length,
      totalCount,
      data: documents,
    };
  }
}
