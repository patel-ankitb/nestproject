import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { ObjectId } from 'mongodb';
import * as fs from 'fs';

@Injectable()
export class MFindService {
  private readonly JWT_SECRET: string = process.env.JWT_SECRET || 'myStaticSecretKey';
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
      console.warn('Failed to load app-db-map.json, using default map');
    }
    this.AppDbMap = defaultMap;
  }

  private getDbName(appName: string): string {
    if (!appName) throw new BadRequestException('appName is required');
    const dbName = this.AppDbMap[appName.toLowerCase()];
    if (!dbName) throw new BadRequestException(`App config not found for appName: ${appName}`);
    return dbName;
  }

  // ---------------- LOGIN ----------------
  async login(body: { appName: string; name: string; password: string }) {
    const { appName, name, password } = body;
    if (!name || !password) throw new BadRequestException('name and password are required');

    const dbName = this.getDbName(appName);
    const connection = mongoose.connection.useDb(dbName);

    const appUser = await connection.collection('appuser').findOne(
      {
        'sectionData.appuser.name': name,
        'sectionData.appuser.password': password,
      },
      { collation: { locale: 'en', strength: 2 } }
    );

    if (!appUser) throw new UnauthorizedException('Invalid name or password');

    const roleId = appUser?.sectionData?.appuser?.role;
    if (!roleId) throw new BadRequestException('User role not configured');

    if (!appUser._id) throw new BadRequestException('User _id is missing or invalid');

    const payload = {
      userId: appUser._id.toString(),
      roleId: roleId.toString(),
      name: appUser.sectionData?.appuser?.name ?? name,
      companyId: appUser.sectionData?.appuser?.companyId,
    };

    console.log('Login payload:', payload); // Debug log, remove in production

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
    if (!authHeader.toLowerCase().startsWith('bearer '))
      throw new UnauthorizedException('Authorization header must start with "Bearer "');
    const token = authHeader.slice(7).trim();
    if (!token) throw new UnauthorizedException('Token is missing');

    try {
      const decoded = jwt.verify(token, this.JWT_SECRET);
      if (!decoded || typeof decoded !== 'object' || !decoded.userId || !decoded.roleId) {
        throw new UnauthorizedException('Invalid token payload: userId or roleId missing');
      }
      if (typeof decoded.userId !== 'string' || decoded.userId.trim() === '') {
        throw new UnauthorizedException('Invalid token payload: userId must be a non-empty string');
      }
      if (typeof decoded.roleId !== 'string' || decoded.roleId.trim() === '') {
        throw new UnauthorizedException('Invalid token payload: roleId must be a non-empty string');
      }
      console.log('Decoded token by bhumi:', decoded);

      return decoded;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private deepConvertToObjectId(obj: any): any {
    if (Array.isArray(obj)) return obj.map((item) => this.deepConvertToObjectId(item));
    if (obj && typeof obj === 'object') {
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
      console.log('Decoded token:', decoded); // Debug log, remove in production
    } catch (err: any) {
      return { error: true, message: err.message || 'Invalid or expired authorization token', data: [] };
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

    if (!appName || !moduleName) throw new BadRequestException('appName and moduleName are required');

    try {
      const dbName = this.getDbName(appName);
      const connection = mongoose.connection.useDb(dbName);

      const collections = (await connection.db?.listCollections().toArray()) ?? [];
      const collectionInfo = collections.find((c) => c.name.toLowerCase() === moduleName.toLowerCase());

      if (!collectionInfo && moduleName.toLowerCase() !== 'modules')
        return { error: true, message: `Collection ${moduleName} not found`, data: [] };

      const collection = connection.collection(collectionInfo?.name || moduleName);

      // ---- User & Role check ----
      const userId = decoded.userId;
      const roleId = decoded.roleId;

      console.log('Querying appuser with userId:', userId, 'Type:', typeof userId); // Debug log
      let user;
      try {
        user = await connection.collection('appuser').findOne(
          { _id: this.convertToId(userId) },
          // No collation for _id, as it's binary for ObjectId or exact match for strings
        );
      } catch (err: any) {
        console.error('Error querying appuser:', err);
        return { error: true, message: `Error querying user: ${err.message}`, data: [] };
      }
      if (!user) return { error: true, message: 'User not found', data: [] };

      console.log('Querying approle with roleId:', roleId, 'Type:', typeof roleId); // Debug log
      let role;
      try {
        role = await connection.collection('approle').findOne(
          { _id: this.convertToId(roleId) },
          // No collation for _id
        );
      } catch (err: any) {
        console.error('Error querying approle:', err);
        return { error: true, message: `Error querying role: ${err.message}`, data: [] };
      }
      if (!role) return { error: true, message: 'Role not found', data: [] };

      const isSuperAdmin = role?.sectionData?.approle?.role?.toLowerCase() === 'superadmin';
      const assignedModules = role?.sectionData?.approle?.modules?.map((m) => m.module.toLowerCase()) || [];
      const requestedModule = moduleName.toLowerCase();

      if (!isSuperAdmin && !assignedModules.includes(requestedModule)) {
        return { error: true, message: `Access denied for module: ${moduleName}`, data: [] };
      }

      // ---- Query & Company filter ----
      let reqQuery: any = this.deepConvertToObjectId(query);
      if (
        collections.some((c) => c.name === 'company') &&
        !isSuperAdmin &&
        moduleName !== 'company' &&
        role?.sectionData?.approle?.issaasrole !== true
      ) {
        if (!companyId) return { error: true, message: 'companyId is required for this operation', data: [] };
        const assignedFields =
          role?.sectionData?.approle?.modules?.find(
            (mdl) => mdl.module.toLowerCase() === moduleName.toLowerCase(),
          )?.assignedField || [];
        if (assignedFields.length > 0) {
          const userFilter = {
            $or: assignedFields.map((field) => ({
              $or: [{ companyId }, { [field]: userId }],
            })),
          };
          reqQuery = { ...reqQuery, ...userFilter };
        }
      }

      // ---- Aggregation pipeline ----
      const pipeline: any[] = [];
      if (Object.keys(reqQuery).length) pipeline.push({ $match: reqQuery });
      for (const lookup of lookups) pipeline.push(this.deepConvertToObjectId(lookup));
      if (Object.keys(projection).length) pipeline.push({ $project: projection });
      pipeline.push({ $sort: { [sortBy]: order === 'descending' ? -1 : 1 } });
      if (skip > 0) pipeline.push({ $skip: skip });
      if (limit > 0) pipeline.push({ $limit: limit });

      const documents = await collection.aggregate(pipeline).toArray();
      return { error: false, message: 'Data retrieved successfully', count: documents.length, data: documents };
    } catch (err: any) {
      console.error('runAggregation error:', err);
      return { error: true, message: err.message || 'Internal server error', data: [] };
    }
  }

  // ---------------- GET ROLE BY ID ----------------
  async getRoleById(appName: string, roleId: string) {
    if (!appName || !roleId) throw new BadRequestException('appName and roleId are required');

    const dbName = this.getDbName(appName);
    const connection = mongoose.connection.useDb(dbName);

    console.log('Querying approle with roleId:', roleId, 'Type:', typeof roleId); // Debug log
    let role;
    try {
      role = await connection.collection('approle').findOne(
        { _id: this.convertToId(roleId) },
        // No collation for _id
      );
    } catch (err: any) {
      console.error('Error querying approle:', err);
      return { error: true, message: `Error querying role: ${err.message}`, data: null };
    }
    if (!role) return { error: true, message: 'Role not found', data: null };

    return {
      error: false,
      message: 'Role retrieved successfully',
      data: {
        roleId: role._id,
        roleName: role?.sectionData?.approle?.role ?? 'Unknown',
        modules: role?.sectionData?.approle?.modules || [],
      },
    };
  }

  // ---------------- GET MODULE COUNT PER ROLE ----------------
  async getRoleModulesCount(appName: string) {
    if (!appName) throw new BadRequestException('appName is required');

    const dbName = this.getDbName(appName);
    const connection = mongoose.connection.useDb(dbName);

    const roles = await connection.collection('approle').find({}, {
      collation: { locale: 'en', strength: 2 },
    }).toArray();
    const result = roles.map((role) => ({
      roleId: role._id,
      roleName: role?.sectionData?.approle?.role || 'Unknown',
      moduleCount: role?.sectionData?.approle?.modules?.length || 0,
      modules: role?.sectionData?.approle?.modules?.map((m) => m.module) || [],
    }));

    return { error: false, message: 'Module count per role retrieved successfully', data: result };
  }

  // ---------------- CHECK USER ACCESS ----------------
  async checkUserAccess(userId: string, moduleName: string, appName: string) {
    if (!userId || !moduleName || !appName) {
      throw new BadRequestException('userId, moduleName, and appName are required');
    }

    const dbName = this.getDbName(appName);
    const connection = mongoose.connection.useDb(dbName);

    console.log('Querying appuser with userId:', userId, 'Type:', typeof userId); // Debug log
    let user;
    try {
      user = await connection.collection('appuser').findOne(
        { _id: this.convertToId(userId) },
        // No collation for _id
      );
    } catch (err: any) {
      console.error('Error querying appuser:', err);
      return { error: true, message: `Error querying user: ${err.message}`, access: false };
    }
    if (!user) return { error: true, message: 'User not found', access: false };

    const roleId = user?.sectionData?.appuser?.role;
    if (!roleId) {
      return { error: true, message: 'Invalid or missing roleId for user', access: false };
    }

    console.log('Querying approle with roleId:', roleId, 'Type:', typeof roleId); // Debug log
    let role;
    try {
      role = await connection.collection('approle').findOne(
        { _id: roleId },
        // No collation for _id
      );
    } catch (err: any) {
      console.error('Error querying approle:', err);
      return { error: true, message: `Error querying role: ${err.message}`, access: false };
    }
    if (!role) return { error: true, message: 'Role not found', access: false };

    const modules = role?.sectionData?.approle?.modules?.map((m) => m.module.toLowerCase()) || [];
    const hasAccess = modules.includes(moduleName.toLowerCase());

    return {
      error: false,
      access: hasAccess,
      roleName: role?.sectionData?.approle?.role ?? 'Unknown',
    };
  }

  private convertToId(id: string): any {
    return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id;
  }
}