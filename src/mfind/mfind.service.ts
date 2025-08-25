import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import * as fs from 'fs';

@Injectable()
export class MFindService {
  private readonly JWT_SECRET = 'myStaticSecretKey';

  // 🔹 AppName → DB Name mapping
  private AppDbMap: Record<string, string> = {};
  
  constructor() {
    this.loadAppDbMap();
  }

  /**
   * Load appName → dbName mapping from a JSON file (by default 'app-db-map.json')
   * You can override file path with APP_DB_MAP_FILE env var.
   * Falls back to built-in default mapping if file not found or invalid.
   */
  private loadAppDbMap(): void {
    const defaultMap: Record<string, string> = {
      'app6716866755631': 'dataproject',
      // add more defaults if needed
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
    } catch (e) {
      // ignore and fall back to defaults
    }

    this.AppDbMap = defaultMap;
  }

  private getDbName(appName: string): string {
    const dbName = this.AppDbMap[appName];
    if (!dbName) {
      throw new BadRequestException(`App config not found for appName: ${appName}`);
    }
    return dbName;
  }

  // ---------------- LOGIN ----------------
  async login(body: any) {
    const { username, password } = body;

    if (username !== 'admin' || password !== 'admin1234') {
      throw new UnauthorizedException('Invalid username or password');
    }

    const token = jwt.sign({ username }, this.JWT_SECRET, { expiresIn: '1h' });
    return { access_token: token };
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

  // ---------------- RUN AGGREGATION ----------------
  async runAggregation(body: any, headers: any, reqUserAuth?: any) {
    const authHeader = Object.keys(headers).find((k) => k.toLowerCase() === 'authorization');
    const token = authHeader ? headers[authHeader] : undefined;

    if (!token) return { error: true, message: 'Authorization token required', data: [] };

    try {
      this.verifyToken(token);
    } catch {
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
      tableType,
    } = body;

    if (!appName || !moduleName) {
      throw new BadRequestException('appName (DB) and moduleName (Collection) are required');
    }

    try {
      // 🔹 Map appName → dbName
      const dbName = this.getDbName(appName);

      // 1️ Connect to DB
      const connection = mongoose.connection.useDb(dbName);
      console.log(`Connected to database: ${dbName} (from appName: ${appName})`);

      //  Safe null check
      const collections = connection?.db
        ? await connection.db.listCollections().toArray()
        : [];
      const collectionExists = collections.some((c) => c.name === moduleName);
      if (!collectionExists && moduleName.toLowerCase() !== 'modules') {
        return { error: true, message: `Collection ${moduleName} not found`, data: [] };
      }

      const collection = connection.collection(moduleName);

      // 🔹 Special cases
      if (
        ['chat', 'mobileappdesign', 'mobileappdesign1', 'mobileappdesign2', 'mobileappdesign3']
          .includes(moduleName.toLowerCase())
      ) {
        const documents = await collection
          .find(query, { projection })
          .sort({ [sortBy]: order === 'descending' ? -1 : 1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        const count = await collection.countDocuments(query);
        const totalCount = await collection.countDocuments();

        return { error: false, message: 'Data retrieved successfully', count, totalCount, data: documents };
      }

      if (moduleName.toLowerCase() === 'modules') {
        const filtered = collections
          .map((c) => c.name)
          .filter((n) => !['schema', 'approle', 'appuser'].includes(n.toLowerCase()));
        return { error: false, message: 'Module collections retrieved successfully', data: filtered };
      }

      if (moduleName.toLowerCase() === 'approle') {
        const exclusionQuery = { ...query, 'sectionData.approle.role': { $ne: 'superadmin' } };
        const documents = await collection
          .find(exclusionQuery, { projection })
          .sort({ [sortBy]: order === 'descending' ? -1 : 1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        const count = await collection.countDocuments(exclusionQuery);
        const totalCount = await collection.countDocuments();
        return { error: false, message: 'Data retrieved successfully', count, totalCount, data: documents };
      }

      // 🔹 Normal collections
      let reqQuery: any = { ...query };

      const hasCompany = collections.some((c) => c.name === 'company');
      const { userId, userDocId, roleObject, isSuperAdmin } = reqUserAuth || {};

      if (hasCompany && !isSuperAdmin && moduleName !== 'company') {
        if (!companyId) throw new BadRequestException('companyId is required for this operation');
        reqQuery.companyId = companyId;
      }

      if (!isSuperAdmin && roleObject) {
        const assignedFields = roleObject.sectionData.approle.modules
          .find((mdl) => mdl.module === moduleName)?.assignedField || [];

        if (assignedFields.length > 0) {
          const userFilter = {
            $or: assignedFields.map((field) => ({
              $or: [
                { companyId },
                { [field]: userId },
                { [field]: userDocId },
              ],
            })),
          };
          reqQuery = { ...reqQuery, ...userFilter };
        }
      }

      // 🔹 Build pipeline
      const pipeline: any[] = [];
      if (Object.keys(reqQuery).length) pipeline.push({ $match: reqQuery });

      for (const lookup of lookups) pipeline.push(lookup);

      if (Object.keys(projection).length) pipeline.push({ $project: projection });

      pipeline.push({ $sort: { [sortBy]: order === 'descending' ? -1 : 1 } });

      const totalDocs = await collection.aggregate([...pipeline]).toArray();
      const totalCount = totalDocs.length;

      if (skip > 0) pipeline.push({ $skip: skip });
      if (limit > 0) pipeline.push({ $limit: limit });

      const documents = await collection.aggregate(pipeline).toArray();
      const count = documents.length;

      return { error: false, message: 'Data retrieved successfully', count, totalCount, data: documents };

    } catch (err) {
      const logMessage = `[${new Date().toISOString()}] Error in runAggregation\n${err.stack || err.message}\nBody: ${JSON.stringify(body)}\n`;

      if (!fs.existsSync('logs')) fs.mkdirSync('logs');
      fs.appendFileSync('logs/dynamicController.log', logMessage);

      return { error: true, message: 'Internal server error', data: [] };
    }
  }
}
