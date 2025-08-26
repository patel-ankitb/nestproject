import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { ObjectId } from 'mongodb';
import * as fs from 'fs';

@Injectable()
export class MFindService {
  private readonly JWT_SECRET = 'myStaticSecretKey';
  private AppDbMap: Record<string, string> = {};

  constructor() {
    this.loadAppDbMap();
  }

  private loadAppDbMap(): void {
    const defaultMap: Record<string, string> = {
      'app6716866755631': 'dataproject',
    };
    const mapFile = process.env.APP_DB_MAP_FILE || 'app-db-map.json';
    try {
      if (fs.existsSync(mapFile)) {
        const raw = fs.readFileSync(mapFile, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          this.AppDbMap = { ...defaultMap, ...parsed };
          return;
        }
      }
    } catch {
      // ignore errors and fall back
    }
    this.AppDbMap = defaultMap;
  }

  private getDbName(appName: string): string {
    const dbName = this.AppDbMap[appName];
    if (!dbName) throw new BadRequestException(`App config not found for appName: ${appName}`);
    return dbName;
  }

  // ---------------- LOGIN ----------------
  async login(body: { appName: string; name: string; password: string }) {
    const { appName, name, password } = body;
    if (!name || !password) {
      throw new BadRequestException('name and password are required');
    }

    const dbName = this.getDbName(appName);
    const connection = mongoose.connection.useDb(dbName);

    const appUser = await connection.collection('appuser').findOne({
      'sectionData.appuser.name': name,
      'sectionData.appuser.password': password, // ⚠️ plain text for now
    });

    if (!appUser) {
      throw new UnauthorizedException('Invalid name or password');
    }

    const roleId = appUser.sectionData.appuser.selectedUser;
    const payload = {
      userId: appUser._id.toString(),
      roleId,
      name: appUser.sectionData.appuser.name,
      companyId: appUser.sectionData.appuser.companyId,
    };

    const token = jwt.sign(payload, this.JWT_SECRET, { expiresIn: '1h' });

    return {
      message: 'Login successful',
      access_token: token,
      user: payload,
    };
  }

  // ---------------- VERIFY TOKEN ----------------
  verifyToken(authHeader: string | undefined) {
    if (!authHeader) throw new UnauthorizedException('Authorization header is missing');
    if (!authHeader.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException('Authorization header must start with "Bearer "');
    }

    const token = authHeader.slice(7).trim();
    if (!token) throw new UnauthorizedException('Token is missing');

    try {
      return jwt.verify(token, this.JWT_SECRET);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  // ✅ Helper to safely convert any string IDs to ObjectId
  private deepConvertToObjectId(obj: any): any {
    if (Array.isArray(obj)) {
      return obj.map((item) => this.deepConvertToObjectId(item));
    } else if (obj && typeof obj === 'object') {
      const newObj: any = {};
      for (const key of Object.keys(obj)) {
        const value = obj[key];
        if (
          (key.toLowerCase() === '_id' || key.toLowerCase().endsWith('id')) &&
          typeof value === 'string' &&
          ObjectId.isValid(value)
        ) {
          newObj[key] = new ObjectId(value);
        } else {
          newObj[key] = this.deepConvertToObjectId(value);
        }
      }
      return newObj;
    }
    return obj;
  }

  // ---------------- RUN AGGREGATION ----------------
  async runAggregation(body: any, token: string, req: any) {
    let decoded: any;
    try {
      decoded = this.verifyToken(token);
    } catch (err) {
      return { error: true, message: 'Invalid or expired authorization token', data: [] };
    }

    const {
      appName,
      moduleName,
      query = {},
      projection = {},
      limit = 10,
      skip = 0,
      order = 'ascending',
      sortBy = '_id',
      lookups = [],
      companyId,
    } = body;

    if (!appName || !moduleName) {
      throw new BadRequestException('appName (DB) and moduleName (Collection) are required');
    }

    try {
      const dbName = this.getDbName(appName);
      const connection = mongoose.connection.useDb(dbName);

      const rawCollections = await (connection.db?.listCollections().toArray() ?? []);
      const collections = Array.isArray(rawCollections) ? rawCollections : [];
      const collectionExists = collections.some((c) => c.name === moduleName);
      if (!collectionExists && moduleName.toLowerCase() !== 'modules') {
        return { error: true, message: `Collection ${moduleName} not found`, data: [] };
      }

      const collection = connection.collection(moduleName);

      // 🔹 Special modules
      if (['chat', 'mobileappdesign', 'mobileappdesign1', 'mobileappdesign2', 'mobileappdesign3'].includes(moduleName.toLowerCase())) {
        const documents = await collection.find(this.deepConvertToObjectId(query), { projection })
          .sort({ [sortBy]: order === 'descending' ? -1 : 1 })
          .skip(skip)
          .limit(limit)
          .toArray();
        const count = await collection.countDocuments(this.deepConvertToObjectId(query));
        return { error: false, message: 'Data retrieved successfully', count, data: documents };
      }

      if (moduleName.toLowerCase() === 'modules') {
        const filtered = collections.map((c) => c.name)
          .filter((n) => !['schema', 'approle', 'appuser'].includes(n.toLowerCase()));
        return { error: false, message: 'Module collections retrieved successfully', data: filtered };
      }

      if (moduleName.toLowerCase() === 'approle') {
        const exclusionQuery = { ...query, 'sectionData.approle.role': { $ne: 'superadmin' } };
        const documents = await collection.find(this.deepConvertToObjectId(exclusionQuery), { projection })
          .sort({ [sortBy]: order === 'descending' ? -1 : 1 })
          .skip(skip)
          .limit(limit)
          .toArray();
        const count = await collection.countDocuments(this.deepConvertToObjectId(exclusionQuery));
        return { error: false, message: 'Data retrieved successfully', count, data: documents };
      }

      // 🔹 Normal collections
      let reqQuery: any = this.deepConvertToObjectId(query);
      const hasCompany = collections.some((c) => c.name === 'company');

      // ✅ FIXED: safe ObjectId conversion for user/role
      const userId = decoded.userId && mongoose.Types.ObjectId.isValid(decoded.userId)
        ? new mongoose.Types.ObjectId(decoded.userId)
        : decoded.userId;

      const roleId = decoded.roleId && mongoose.Types.ObjectId.isValid(decoded.roleId)
        ? new mongoose.Types.ObjectId(decoded.roleId)
        : decoded.roleId;

      const user = await connection.collection('appuser').findOne({ _id: userId });
      const role = await connection.collection('approle').findOne({ _id: roleId });

      const isSuperAdmin = role?.sectionData?.approle?.role === 'superadmin';

      if (hasCompany && !isSuperAdmin && moduleName !== 'company' && role?.sectionData?.approle?.issaasrole !== true) {
        if (!companyId) {
          return { error: true, message: 'companyId is required for this operation', data: [] };
        }

        const assignedFields = role?.sectionData?.approle?.modules
          ?.find((mdl) => mdl.module === moduleName)?.assignedField || [];

        if (assignedFields.length > 0) {
          const userFilter = {
            $or: assignedFields.map((field) => ({
              $or: [
                { companyId },
                { [field]: decoded.userId },
              ],
            })),
          };
          reqQuery = { ...reqQuery, ...userFilter };
        }
      }

      // Build pipeline
      const pipeline: any[] = [];
      if (Object.keys(reqQuery).length) pipeline.push({ $match: reqQuery });
      for (const lookup of lookups) pipeline.push(this.deepConvertToObjectId(lookup));
      if (Object.keys(projection).length) pipeline.push({ $project: projection });
      pipeline.push({ $sort: { [sortBy]: order === 'descending' ? -1 : 1 } });

      const totalDocs = await collection.aggregate([...pipeline]).toArray();

      if (skip > 0) pipeline.push({ $skip: skip });
      if (limit > 0) pipeline.push({ $limit: limit });

      const documents = await collection.aggregate(pipeline).toArray();
      const count = documents.length;

      return { error: false, message: 'Data retrieved successfully', count, data: documents };
    } catch (err: any) {
      console.error('runAggregation error:', err);
      return { error: true, message: err.message || 'Internal server error', data: [] };
    }
  }
}
