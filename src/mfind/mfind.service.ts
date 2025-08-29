import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import mongoose, { Connection } from 'mongoose';
import { ObjectId } from 'mongodb';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class MFindService {
  private readonly JWT_SECRET: string = process.env.JWT_SECRET || 'myStaticSecretKey';
  private connections: Map<string, Connection> = new Map();

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
    } catch (error) {
      throw new BadRequestException(`Failed to establish connection: ${error.message}`);
    }
  }

  
//===================== Resolve app configuration from central DB============================================
   
  private async resolveAppConfig(appName: string): Promise<{ cn_str: string; dbName: string }> {
    const baseUri = process.env.MONGO_URI;
    if (!baseUri) throw new Error('MONGO_URI not defined in .env');

    const centralConn = await this.getConnection(baseUri, 'customize');

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

    const config = await AppConfig.findOne({ appnm: appName }).lean();
    if (!config?.info?.cn_str || !config?.info?.db) {
      throw new BadRequestException(`App config not found for appName: ${appName}`);
    }

    console.log(`[resolveAppConfig] Resolved for ${appName}:`, config.info);
    return { cn_str: config.info.cn_str, dbName: config.info.db };
  }

  
 //=================================Get the database name for a given appName======================================
   
  private async getDbName(appName: string): Promise<string> {
    try {
      const { dbName } = await this.resolveAppConfig(appName);
      return dbName;
    } catch (error: any) {
      throw new BadRequestException(`Failed to get database name for appName: ${appName}. Error: ${error.message}`);
    }
  }

  
//=======================================Get dynamic tenant DB connection===========================================
   
  private async getDynamicDb(appName: string): Promise<{ db: any; cn_str: string; dbName: string }> {
    const { cn_str, dbName } = await this.resolveAppConfig(appName);
    const conn = await this.getConnection(cn_str, dbName);
    return { db: conn.db, cn_str, dbName };
  }

  
//=================================Register a new user=========================================================
   
  async registerUser(appName: string, name: string, password: string, roleId: string, companyId?: string) {
    if (!name || !password || !roleId) {
      throw new BadRequestException('Name, password, and roleId are required');
    }

    const { db } = await this.getDynamicDb(appName);

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
  }

//=================================User login===========================================
  async login(body: { appName: string; name: string; password: string }) {
    const { appName, name, password } = body;
    console.log(`[login] Attempting login for ${name} in app ${appName}`);

    if (!appName || !name || !password) {
      throw new BadRequestException('appName, name, and password are required');
    }

    const { db } = await this.getDynamicDb(appName);

    const userDoc = await db.collection('appuser').findOne({
      $or: [
        { 'sectionData.appuser.name': name },
        { 'sectionData.data.name': name },
      ],
    });

    if (!userDoc) throw new UnauthorizedException('Invalid name or password');

    let appUserData: any;
    if (userDoc.sectionData?.appuser) {
      appUserData = userDoc.sectionData.appuser;
    } else if (Array.isArray(userDoc.sectionData)) {
      const appUserSection = userDoc.sectionData.find((s: any) => s.sectionName === 'appuser');
      appUserData = appUserSection?.data;
    }

    if (!appUserData) throw new BadRequestException('User data not found');

    let matchedUser: any = null;
    if (Array.isArray(appUserData)) {
      matchedUser = appUserData.find((u: any) => u.name === name);
    } else if (appUserData.name === name) {
      matchedUser = appUserData;
    }

    if (!matchedUser) throw new UnauthorizedException('Invalid name or password');

    const isMatch = await bcrypt.compare(password, matchedUser.password);
    if (!isMatch) throw new UnauthorizedException('Invalid name or password');

    
    const userId = userDoc._id;
    console.log(`User ID format: ${userId} (type: ${typeof userId})`);

    const payload = {
      userId: userId.toString(), 
      roleId: matchedUser.role?.toString() || '',
      name: matchedUser.name,
      companyId: matchedUser.companyId,
      appName,
    };

    const token = jwt.sign(payload, this.JWT_SECRET, { expiresIn: '2h' });

    return {
      message: 'Login successful',
      access_token: token,
      user: payload,
    };
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
      console.error('[verifyToken] JWT error:', err.message);
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

//=========Convert to MongoDB ObjectId (safe)========================

  private convertToId(id: any): any {
    try {
      if (!id) throw new Error('Invalid id');
      if (id instanceof ObjectId) return id;
      if (typeof id === 'string' && /^[a-fA-F0-9]{24}$/.test(id)) {
        return new ObjectId(id);
      }
      if (typeof id === 'number' || (typeof id === 'string' && /^\d+$/.test(id))) {
        return id; 
      }

      throw new Error(`Invalid ID format: ${id}`);
    } catch (err: any) {
      
      console.warn(`Could not convert ID ${id} to ObjectId, using as-is:`, err.message);
      return id;
    }
  }


 

  private deepConvertToObjectId(value: any): any {
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
          } catch {
            
          }
        }
        out[k] = this.deepConvertToObjectId(v);
      }
      return out;
    }
    if (typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value)) {
      try {
        return new ObjectId(value);
      } catch {
        return value;
      }
    }
    return value;
  }

 
  private async collectionExists(connection: mongoose.Connection, collectionName: string): Promise<boolean> {
    try {
      const collections = await connection.db?.listCollections().toArray();
      return collections?.some(c => c.name.toLowerCase() === collectionName.toLowerCase()) ?? false;
    } catch (error) {
      console.error(`[collectionExists] Error checking collection ${collectionName}:`, error);
      return false;
    }
  }

  async runAggregation(body: any, token: string, req: any) {
    let decoded: any;
    try {
      decoded = this.verifyToken(token);
      console.log('Decoded token for aggregation:', decoded);
    } catch (err: any) {
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
      return {
        error: true,
        message: 'appName and moduleName are required',
        data: []
      };
    }

    try {
      const { cn_str, dbName } = await this.resolveAppConfig(appName);
      const connection = await this.getConnection(cn_str, dbName);

      console.log(`Using dynamic DB: ${appName} -> ${dbName}`);

      // Check if collection exists
      const collectionExists = await this.collectionExists(connection, moduleName);
      if (!collectionExists && moduleName.toLowerCase() !== 'modules') {
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

        user = await userCollection.findOne({
          _id: this.convertToId(userId)
        });

        if (!user) {
          user = await userCollection.findOne({ _id: userId });
        }

      } catch (err: any) {
        return { error: true, message: `Error querying user: ${err.message}`, data: [] };
      }
     
      let role;
      try {
        const roleCollection = connection.collection('approle');

        
        role = await roleCollection.findOne({
          _id: this.convertToId(roleId)
        });

       
        if (!role) {
          role = await roleCollection.findOne({ _id: roleId });
        }

      } catch (err: any) {
        return { error: true, message: `Error querying role: ${err.message}`, data: [] };
      }

      const isSuperAdmin = role?.sectionData?.approle?.role?.toLowerCase() === 'superadmin';
      const assignedModules =
        role?.sectionData?.approle?.modules?.map((m) => m.module.toLowerCase()) || [];
      const requestedModule = moduleName.toLowerCase();

      if (!isSuperAdmin && !assignedModules.includes(requestedModule)) {
        return { error: true, message: `Access denied for module: ${moduleName}`, data: [] };
      }

      let reqQuery: any = this.deepConvertToObjectId(query);
      if (
        await this.collectionExists(connection, 'company') &&
        !isSuperAdmin &&
        moduleName !== 'company' &&
        role?.sectionData?.approle?.issaasrole !== true
      ) {
        if (!companyId)
          return { error: true, message: 'companyId is required for this operation', data: [] };
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

      const pipeline: any[] = [];
      if (Object.keys(reqQuery).length) pipeline.push({ $match: reqQuery });
      for (const lookup of lookups) pipeline.push(this.deepConvertToObjectId(lookup));
      if (Object.keys(projection).length) pipeline.push({ $project: projection });
      pipeline.push({ $sort: { [sortBy]: order === 'descending' ? -1 : 1 } });
      if (skip > 0) pipeline.push({ $skip: skip });
      if (limit > 0) pipeline.push({ $limit: limit });

      const documents = await collection.aggregate(pipeline).toArray();
      return {
        error: false,
        message: 'Data retrieved successfully',
        count: documents.length,
        data: documents,
        dbInfo: { appName, dbName },
      };
    } catch (err: any) {
      console.error('[runAggregation] Error:', err);
      return { error: true, message: err.message || 'Internal server error', data: [] };
    }
  }


//================================Get role by ID========================================
   
  async getRoleById(appName: string, roleId: string) {
    if (!appName || !roleId) throw new BadRequestException('appName and roleId are required');

    try {
      const { dbName } = await this.resolveAppConfig(appName);
      const connection = await this.getConnection(process.env.MONGO_URI!, dbName);

      let role;
      try {
        role = await connection.collection('approle').findOne({ _id: this.convertToId(roleId) });
      } catch (err: any) {
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
        dbInfo: { appName, dbName },
      };
    } catch (err: any) {
      return { error: true, message: err.message || 'Failed to get role', data: null };
    }
  }

  
//===================== Check user access for a module===========================
   
  async checkUserAccess(appName: string, roleId: string, moduleName: string) {
    if (!appName || !roleId || !moduleName) {
      throw new BadRequestException('appName, roleId, and moduleName are required');
    }

    const roleResult = await this.getRoleById(appName, roleId);
    if (roleResult?.error) {
      return { moduleName, roleId, hasAccess: false, message: roleResult.message || 'Role lookup failed' };
    }

    const modules = roleResult?.data?.modules || [];
    const hasAccess = Array.isArray(modules)
      ? modules.some((m: any) => {
        const modName = (m?.module || m?.moduleName || '').toString().toLowerCase();
        return modName === moduleName.toLowerCase();
      })
      : false;

    return { moduleName, roleId, hasAccess };
  }
}