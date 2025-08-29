import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import mongoose, { Connection } from 'mongoose';
import { ObjectId } from 'mongodb';
import * as bcrypt from 'bcryptjs';
import * as winston from 'winston';

@Injectable()
export class MFindService {
  private readonly JWT_SECRET: string = process.env.JWT_SECRET || 'myStaticSecretKey';
  private readonly JWT_REFRESH_SECRET: string = process.env.JWT_REFRESH_SECRET || 'myStaticRefreshKey';
  private connections: Map<string, Connection> = new Map();
  private readonly logger: winston.Logger;

  constructor() {
    // Initialize Winston logger with IST timezone
    this.logger = winston.createLogger({
      level: 'error',
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss Z' }), // IST is UTC+5:30
        winston.format.json(),
      ),
      transports: [
        new winston.transports.File({ filename: 'logs/error.log' }),
      ],
    });
  }

  //------------------------- Log error to file with IST timestamp --------------------------------
  private logError(functionName: string, error: any, requestBody?: any) {
    const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
    const istTime = new Date(Date.now() + istOffset);
    this.logger.error({
      functionName,
      errorMessage: error.message || 'Unknown error',
      stack: error.stack || 'No stack trace',
      requestBody: requestBody ? JSON.stringify(requestBody, null, 2) : 'No request body',
      timestamp: istTime.toISOString(), // Adjusted to IST
    });
  }

  //------------------------- Get or create a DB connection--------------------------------
  private async getConnection(cn_str: string, dbName: string): Promise<Connection> {
    const cacheKey = `${cn_str}_${dbName}`;
    if (this.connections.has(cacheKey)) {
      return this.connections.get(cacheKey)!;
    }

    try {
      const connection = await mongoose.createConnection(cn_str, { dbName }).asPromise();
      this.connections.set(cacheKey, connection);
      return connection;
    } catch (error: any) {
      this.logError('getConnection', error, { cn_str, dbName });
      throw new BadRequestException(`Failed to establish connection: ${error.message}`);
    }
  }

  //===================== Resolve app configuration from central DB============================================
  private async resolveAppConfig(appName: string): Promise<{ cn_str: string; dbName: string }> {
    const baseUri = process.env.MONGO_URI;
    if (!baseUri) {
      const error = new Error('MONGO_URI not defined in .env');
      this.logError('resolveAppConfig', error, { appName });
      throw error;
    }

    let centralConn: Connection;
    try {
      centralConn = await this.getConnection(baseUri, 'customize');
    } catch (error: any) {
      this.logError('resolveAppConfig', error, { appName, baseUri });
      throw error;
    }

    const AppConfigSchema = new mongoose.Schema(
      {
        appnm: String,
        info: {
          cn_str: String,
          db: String,
        },
      },
      { strict: false },
    );

    const AppConfig = centralConn.model('custom_apps', AppConfigSchema, 'custom_apps');

    try {
      const config = await AppConfig.findOne({ appnm: appName }).lean();
      if (!config?.info?.cn_str || !config?.info?.db) {
        const error = new BadRequestException(`App config not found for appName: ${appName}`);
        this.logError('resolveAppConfig', error, { appName });
        throw error;
      }

      console.log(`[resolveAppConfig] Resolved for ${appName}:`, config.info);
      return { cn_str: config.info.cn_str, dbName: config.info.db };
    } catch (error: any) {
      this.logError('resolveAppConfig', error, { appName });
      throw error;
    }
  }

  //=================================Get the database name for a given appName======================================
  private async getDbName(appName: string): Promise<string> {
    try {
      const { dbName } = await this.resolveAppConfig(appName);
      return dbName;
    } catch (error: any) {
      this.logError('getDbName', error, { appName });
      throw new BadRequestException(`Failed to get database name for appName: ${appName}. Error: ${error.message}`);
    }
  }

  //=======================================Get dynamic tenant DB connection===========================================
  private async getDynamicDb(appName: string): Promise<{ db: any; cn_str: string; dbName: string }> {
    try {
      const { cn_str, dbName } = await this.resolveAppConfig(appName);
      const conn = await this.getConnection(cn_str, dbName);
      return { db: conn.db, cn_str, dbName };
    } catch (error: any) {
      this.logError('getDynamicDb', error, { appName });
      throw error;
    }
  }

  //=================================Register a new user=========================================================
  async registerUser(appName: string, name: string, password: string, roleId: string, companyId?: string) {
    if (!name || !password || !roleId) {
      const error = new BadRequestException('Name, password, and roleId are required');
      this.logError('registerUser', error, { appName, name, roleId, companyId });
      throw error;
    }

    let db: any;
    try {
      const dynamicDb = await this.getDynamicDb(appName);
      db = dynamicDb.db;
    } catch (error: any) {
      this.logError('registerUser', error, { appName, name, roleId, companyId });
      throw error;
    }

    try {
      const hashedPassword = await bcrypt.hash(password, 10);

      const newUser = {
        _id: new ObjectId(),
        sectionData: {
          appuser: {
            name,
            password: hashedPassword,
            role: roleId,
            companyId: companyId || null,
          },
        },
        createdAt: new Date(),
      };

      const result = await db.collection('appuser').insertOne(newUser);

      console.log(`[registerUser] New user inserted in ${appName}:`, result.insertedId);

      return {
        message: 'User registered successfully',
        userId: result.insertedId.toString(),
      };
    } catch (error: any) {
      this.logError('registerUser', error, { appName, name, roleId, companyId });
      throw error;
    }
  }

  //=================================User login===========================================
  async login(body: { appName: string; name: string; password: string }) {
    const { appName, name, password } = body;
    console.log(`[login] Attempting login for ${name} in app ${appName} at ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);

    if (!appName || !name || !password) {
      const error = new BadRequestException('appName, name, and password are required');
      this.logError('login', error, body);
      throw error;
    }

    let db: any;
    try {
      const dynamicDb = await this.getDynamicDb(appName);
      db = dynamicDb.db;
    } catch (error: any) {
      this.logError('login', error, body);
      throw error;
    }

    let userDoc: any;
    try {
      userDoc = await db.collection('appuser').findOne({
        $or: [
          { 'sectionData.appuser.name': name },
          { 'sectionData.data.name': name },
        ],
      });
      console.log('[login] User document found:', userDoc ? 'Yes' : 'No');
    } catch (error: any) {
      this.logError('login', error, body);
      throw error;
    }

    if (!userDoc) {
      const error = new UnauthorizedException('Invalid name or password');
      this.logError('login', error, body);
      throw error;
    }

    let appUserData: any;
    try {
      if (userDoc.sectionData?.appuser) {
        appUserData = userDoc.sectionData.appuser;
      } else if (Array.isArray(userDoc.sectionData)) {
        const appUserSection = userDoc.sectionData.find((s: any) => s.sectionName === 'appuser');
        appUserData = appUserSection?.data;
      }
        } catch (error: any) {
      this.logError('login', error, body);
      throw error;
    }

    if (!appUserData) {
      const error = new BadRequestException('User data not found');
      this.logError('login', error, body);
      throw error;
    }

    let matchedUser: any = null;
    try {
      if (Array.isArray(appUserData)) {
        matchedUser = appUserData.find((u: any) => u.name === name);
      } else if (appUserData.name === name) {
        matchedUser = appUserData;
      }
      console.log('[login] Matched user:', matchedUser);
    } catch (error: any) {
      this.logError('login', error, body);
      throw error;
    }

    if (!matchedUser) {
      const error = new UnauthorizedException('Invalid name or password');
      this.logError('login', error, body);
      throw error;
    }

    try {
      const isMatch = await bcrypt.compare(password, matchedUser.password);
      console.log('[login] Password match:', isMatch);
      if (!isMatch) {
        const error = new UnauthorizedException('Invalid name or password');
        this.logError('login', error, body);
        throw error;
      }
    } catch (error: any) {
      this.logError('login', error, body);
      throw error;
    }

    const userId = userDoc._id;

    let roleObj: any;
    try {
      roleObj =
        typeof matchedUser.role === 'object' && matchedUser.role !== null
          ? matchedUser.role
          : { role: matchedUser.role ? matchedUser.role.toString() : '' };
    } catch (error: any) {
      this.logError('login', error, body);
      throw error;
    }

    let accessToken: string, refreshToken: string;
    try {
      accessToken = jwt.sign(
        { userId: userId.toString(), roleId: matchedUser.role?.toString() || '' },
        this.JWT_SECRET,
        { expiresIn: '2h' },
      );

      refreshToken = jwt.sign(
        { userId: userId.toString(), roleId: matchedUser.role?.toString() || '' },
        this.JWT_REFRESH_SECRET,
        { expiresIn: '7d' },
      );
    } catch (error: any) {
      this.logError('login', error, body);
      throw error;
    }

    let roleDoc: any = null;
    try {
      const roleCollection = db.collection('approle');
      const roleIdForLookup = matchedUser?.role;
      roleDoc = await roleCollection.findOne({ _id: this.convertToId(roleIdForLookup) });
      console.log('[login] Role document:', roleDoc);
    } catch (err: any) {
      this.logError('login', err, { ...body, roleId: matchedUser?.role });
      console.warn('[login] Could not fetch role document:', err?.message || err);
    }

    let userResponse: any;
    try {
      userResponse = {
        _id: userDoc && userDoc._id ? userDoc._id.toString() : '',
        docId: userDoc?.docId || (userDoc && userDoc._id ? userDoc._id.toString() : ''),
        companyId: matchedUser?.companyId || userDoc?.companyId || null,
        username: matchedUser?.name || '',
        legalname: matchedUser?.legalname || '',
        role: {
          role: roleDoc?.sectionData?.approle?.role || (matchedUser?.role ? matchedUser.role.toString() : ''),
          route: roleDoc?.sectionData?.approle?.route || '',
          issaasrole: roleDoc?.sectionData?.issaasrole || false,
          sidebarmenu: roleDoc?.sectionData?.sidebarmenu || [],
          modules: roleDoc?.sectionData?.approle?.modules || [],
        },
        email: matchedUser?.email || '',
      };
    } catch (error: any) {
      this.logError('login', error, body);
      throw error;
    }

    try {
      if (userResponse.role.role === 'superadmin') {
        return {
          success: true,
          message: 'Login successful',
          accessToken,
          refreshToken,
          attendance: null,
          user: {
            _id: userResponse._id,
            docId: '',
            companyId: '',
            username: matchedUser?.name || '',
            role: {
              role: 'superadmin',
            },
          },
        };
      }

      return {
        success: true,
        message: 'Login successful',
        accessToken,
        refreshToken,
        attendance: null,
        user: userResponse,
      };
    } catch (error: any) {
      this.logError('login', error, body);
      throw error;
    }
  }

  //=========================Verify JWT token safely=====================================
  private verifyToken(token: string) {
    try {
      if (token.startsWith('Bearer ')) {
        token = token.split(' ')[1];
      }
      const decoded = jwt.verify(token, this.JWT_SECRET);
      console.log('[verifyToken] Decoded token:', decoded);
      return decoded;
    } catch (err: any) {
      this.logError('verifyToken', err, { token });
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  //=========Convert to MongoDB ObjectId (safe)========================
  private convertToId(id: any): any {
    try {
      if (!id) {
        const error = new Error('Invalid id');
        this.logError('convertToId', error, { id });
        throw error;
      }
      if (id instanceof ObjectId) return id;
      if (typeof id === 'string' && /^[a-fA-F0-9]{24}$/.test(id)) {
        return new ObjectId(id);
      }
      if (typeof id === 'number' || (typeof id === 'string' && /^\d+$/.test(id))) {
        return id;
      }

      const error = new Error(`Invalid ID format: ${id}`);
      this.logError('convertToId', error, { id });
      throw error;
    } catch (err: any) {
      this.logError('convertToId', err, { id });
      return id;
    }
  }

  private deepConvertToObjectId(value: any): any {
    try {
      if (Array.isArray(value)) {
        return value.map((v) => this.deepConvertToObjectId(v));
      }
      if (value && typeof value === 'object') {
        const out: any = {};
        for (const [k, v] of Object.entries(value)) {
          if (
            (typeof v === 'string' && /^[a-fA-F0-9]{24}$/.test(v)) ||
            k === '_id' ||
            k.endsWith('Id')
          ) {
            try {
              out[k] = new ObjectId(v as string);
              continue;
            } catch (err: any) {
              this.logError('deepConvertToObjectId', err, { key: k, value: v });
            }
          }
          out[k] = this.deepConvertToObjectId(v);
        }
        return out;
      }
      if (typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value)) {
        try {
          return new ObjectId(value);
        } catch (err: any) {
          this.logError('deepConvertToObjectId', err, { value });
          return value;
        }
      }
      return value;
    } catch (error: any) {
      this.logError('deepConvertToObjectId', error, { value });
      return value;
    }
  }

  private async collectionExists(connection: mongoose.Connection, collectionName: string): Promise<boolean> {
    try {
      const collections = await connection.db?.listCollections().toArray();
      return collections?.some(c => c.name.toLowerCase() === collectionName.toLowerCase()) ?? false;
    } catch (error: any) {
      this.logError('collectionExists', error, { collectionName });
      return false;
    }
  }

  async runAggregation(body: any, token: string, req: any) {
    let decoded: any;
    try {
      decoded = this.verifyToken(token);
      console.log('Decoded token for aggregation:', decoded);
    } catch (err: any) {
      this.logError('runAggregation', err, { token });
      return {
        error: true,
        message: err.message || 'Invalid or expired authorization token',
        data: [],
      };
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
      const error = new Error('appName and moduleName are required');
      this.logError('runAggregation', error, body);
      return {
        error: true,
        message: 'appName and moduleName are required',
        data: []
      };
    }

    let cn_str: string, dbName: string, connection: Connection;
    try {
      const config = await this.resolveAppConfig(appName);
      cn_str = config.cn_str;
      dbName = config.dbName;
      connection = await this.getConnection(cn_str, dbName);
    } catch (error: any) {
      this.logError('runAggregation', error, body);
      return { error: true, message: error.message || 'Failed to resolve database configuration', data: [] };
    }

    try {
      console.log(`Using dynamic DB: ${appName} -> ${dbName}`);

      const collectionExists = await this.collectionExists(connection, moduleName);
      if (!collectionExists && moduleName.toLowerCase() !== 'modules') {
        const error = new Error(`No data: collection ${moduleName} not found in database ${dbName}`);
        this.logError('runAggregation', error, body);
        return {
          error: false,
          message: `No data: collection ${moduleName} not found in database ${dbName}`,
          data: []
        };
      }

      const collection = connection.collection(moduleName);

      const userId = decoded.userId;
      const roleId = decoded.roleId;

      let user;
      try {
        const userCollection = connection.collection('appuser');
        user = await userCollection.findOne({ _id: this.convertToId(userId) });

        if (!user) {
          user = await userCollection.findOne({ _id: userId });
        }
      } catch (err: any) {
        this.logError('runAggregation', err, { ...body, userId });
        return { error: true, message: `Error querying user: ${err.message}`, data: [] };
      }

      let role;
      try {
        const roleCollection = connection.collection('approle');
        role = await roleCollection.findOne({ _id: this.convertToId(roleId) });

        if (!role) {
          role = await roleCollection.findOne({ _id: roleId });
        }
      } catch (err: any) {
        this.logError('runAggregation', err, { ...body, roleId });
        return { error: true, message: `Error querying role: ${err.message}`, data: [] };
      }

      const isSuperAdmin = role?.sectionData?.approle?.role?.toLowerCase() === 'superadmin';
      const assignedModules =
        role?.sectionData?.approle?.modules?.map((m: any) => m.module.toLowerCase()) || [];
      const requestedModule = moduleName.toLowerCase();

      if (!isSuperAdmin && !assignedModules.includes(requestedModule)) {
        const error = new Error(`Access denied for module: ${moduleName}`);
        this.logError('runAggregation', error, body);
        return { error: true, message: `Access denied for module: ${moduleName}`, data: [] };
      }

      let reqQuery: any;
      try {
        reqQuery = this.deepConvertToObjectId(query);
      } catch (error: any) {
        this.logError('runAggregation', error, { ...body, query });
        return { error: true, message: `Error processing query: ${error.message}`, data: [] };
      }

      try {
        if (
          await this.collectionExists(connection, 'company') &&
          !isSuperAdmin &&
          moduleName !== 'company' &&
          role?.sectionData?.approle?.issaasrole !== true
        ) {
          if (!companyId) {
            const error = new Error('companyId is required for this operation');
            this.logError('runAggregation', error, body);
            return { error: true, message: 'companyId is required for this operation', data: [] };
          }
          const condition =
            role?.sectionData?.approle?.modules?.find(
              (mdl: any) => mdl.module.toLowerCase() === moduleName.toLowerCase(),
            )?.condition || "or";

          const assignedFields =
            role?.sectionData?.approle?.modules?.find(
              (mdl: any) => mdl.module.toLowerCase() === moduleName.toLowerCase(),
            )?.assignedField || [];

          let userFilter = {};

          if (Array.isArray(assignedFields) && assignedFields.length > 0) {
            const assignedFieldConditions = assignedFields.map((field: string) => {
              switch (condition) {
                case "or":
                  return {
                    $or: [
                      {
                        companyId: Array.isArray(companyId)
                          ? { $in: companyId }
                          : companyId,
                      },
                      {
                        [field]: Array.isArray(userId) ? { $in: userId } : userId,
                      },
                      {
                        [field]: Array.isArray(user && user._id)
                          ? { $in: (user && user._id) }
                          : (user && user._id),
                      },
                    ],
                  };

                case "and":
                  const andConditions: any[] = [
                    {
                      companyId: Array.isArray(companyId)
                        ? { $in: companyId }
                        : companyId,
                    },
                  ];

                  if (userId && (user && user._id)) {
                    andConditions.push(
                      { [field]: Array.isArray(userId) ? { $in: userId } : userId },
                      {
                        [field]: Array.isArray(user && user._id)
                          ? { $in: (user && user._id) }
                          : (user && user._id),
                      },
                    );
                  } else if (user && user._id) {
                    andConditions.push({
                      [field]: Array.isArray(user && user._id) ? { $in: (user && user._id) } : (user && user._id),
                    });
                  } else if (userId) {
                    andConditions.push({
                      [field]: Array.isArray(userId) ? { $in: userId } : userId,
                    });
                  }

                  return { $and: andConditions };

                default:
                  return {};
              }
            });

            userFilter = {
              $or: [...assignedFieldConditions],
            };
          }

          reqQuery = { ...reqQuery, ...userFilter };

          if (assignedFields.length > 0) {
            const userFilter = {
              $or: assignedFields.map((field: string) => ({
                $or: [{ companyId }, { [field]: userId }],
              })),
            };
            reqQuery = { ...reqQuery, ...userFilter };
          }
        }
      } catch (error: any) {
        this.logError('runAggregation', error, body);
        return { error: true, message: `Error applying user filter: ${error.message}`, data: [] };
      }

      const pipeline: any[] = [];
      try {
        if (Object.keys(reqQuery).length) pipeline.push({ $match: reqQuery });
        for (const lookup of lookups) pipeline.push(this.deepConvertToObjectId(lookup));
        if (Object.keys(projection).length) pipeline.push({ $project: projection });
        pipeline.push({ $sort: { [sortBy]: order === 'descending' ? -1 : 1 } });
        if (skip > 0) pipeline.push({ $skip: skip });
        if (limit > 0) pipeline.push({ $limit: limit });
      } catch (error: any) {
        this.logError('runAggregation', error, body);
        return { error: true, message: `Error building pipeline: ${error.message}`, data: [] };
      }

      let documents: any[];
      try {
        documents = await collection.aggregate(pipeline).toArray();
      } catch (error: any) {
        this.logError('runAggregation', error, body);
        return { error: true, message: `Error executing aggregation: ${error.message}`, data: [] };
      }

      let totalCount = 0;
      try {
        const needsAggCount = Array.isArray(lookups) && lookups.length > 0;
        if (needsAggCount) {
          const countPipeline: any[] = [];
          if (Object.keys(reqQuery).length) countPipeline.push({ $match: reqQuery });
          for (const lookup of lookups) countPipeline.push(this.deepConvertToObjectId(lookup));
          countPipeline.push({ $count: 'total' });
          const countResult = await collection.aggregate(countPipeline).toArray();
          totalCount = (countResult[0] && countResult[0].total) ? countResult[0].total : documents.length;
        } else {
          totalCount = await collection.countDocuments(reqQuery);
        }
      } catch (err: any) {
        this.logError('runAggregation', err, body);
        console.warn('[runAggregation] Failed to compute totalCount, falling back to returned length:', err.message);
        totalCount = documents.length;
      }

      return {
        success: true,
        message: 'Data retrieved successfully',
        count: documents.length,
        totalCount,
        data: documents,
        dbInfo: { appName, dbName },
      };
    } catch (err: any) {
      this.logError('runAggregation', err, body);
      return { error: true, message: err.message || 'Internal server error', data: [] };
    }
  }

  //================================Get role by ID========================================
  async getRoleById(appName: string, roleId: string) {
    if (!appName || !roleId) {
      const error = new BadRequestException('appName and roleId are required');
      this.logError('getRoleById', error, { appName, roleId });
      throw error;
    }

    let dbName: string, connection: Connection;
    try {
      dbName = await this.resolveAppConfig(appName).then(config => config.dbName);
      connection = await this.getConnection(process.env.MONGO_URI!, dbName);
    } catch (error: any) {
      this.logError('getRoleById', error, { appName, roleId });
      return { error: true, message: error.message || 'Failed to resolve database configuration', data: null };
    }

    try {
      let role;
      try {
        role = await connection.collection('approle').findOne({ _id: this.convertToId(roleId) });
      } catch (err: any) {
        this.logError('getRoleById', err, { appName, roleId });
        return { error: true, message: `Error querying role: ${err.message}`, data: null };
      }
      if (!role) {
        const error = new Error('Role not found');
        this.logError('getRoleById', error, { appName, roleId });
        return { error: true, message: 'Role not found', data: null };
      }

      return {
        error: false,
        message: 'Role retrieved successfully',
        data: {
          roleId: role._id,
          roleName: role?.sectionData?.approle?.role ?? 'Unknown',
          modules: role?.sectionData?.approle?.modules || [],
        },
        dbInfo: { appName, dbName },
      };
    } catch (err: any) {
      this.logError('getRoleById', err, { appName, roleId });
      return { error: true, message: err.message || 'Failed to get role', data: null };
    }
  }

  //===================== Check user access for a module===========================
  async checkUserAccess(appName: string, roleId: string, moduleName: string) {
    if (!appName || !roleId || !moduleName) {
      const error = new BadRequestException('appName, roleId, and moduleName are required');
      this.logError('checkUserAccess', error, { appName, roleId, moduleName });
      throw error;
    }

    try {
      const roleResult = await this.getRoleById(appName, roleId);
      if (roleResult?.error) {
        this.logError('checkUserAccess', new Error(roleResult.message), { appName, roleId, moduleName });
        return { moduleName, roleId, hasAccess: false, message: roleResult.message || 'Role lookup failed' };
      }

      let modules: any[];
      try {
        modules = roleResult?.data?.modules || [];
      } catch (error: any) {
        this.logError('checkUserAccess', error, { appName, roleId, moduleName });
        return { moduleName, roleId, hasAccess: false, message: `Error processing modules: ${error.message}` };
      }

      let hasAccess: boolean;
      try {
        hasAccess = Array.isArray(modules)
          ? modules.some((m: any) => {
              const modName = (m?.module || m?.moduleName || '').toString().toLowerCase();
              return modName === moduleName.toLowerCase();
            })
          : false;
      } catch (error: any) {
        this.logError('checkUserAccess', error, { appName, roleId, moduleName });
        return { moduleName, roleId, hasAccess: false, message: `Error checking access: ${error.message}` };
      }

      return { moduleName, roleId, hasAccess };
    } catch (error: any) {
      this.logError('checkUserAccess', error, { appName, roleId, moduleName });
      return { moduleName, roleId, hasAccess: false, message: error.message || 'Internal server error' };
    }
  }
}